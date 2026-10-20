import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";
import { config } from "../config.js";

// Segundo factor obligatorio por correo (registro y CADA inicio de sesión).
//
// Flujo: la contraseña correcta (o el alta) NO da sesión; crea un "reto" y
// se envía un código de 6 dígitos al correo. La sesión solo nace en
// /api/auth/verify con el código correcto. Controles anti-bypass:
//  - el reto viaja en una cookie httpOnly + SameSite=Strict limitada a
//    /api/auth (JS no la puede leer y queda atada a ese navegador); en la
//    BD solo se guarda su SHA-256;
//  - el código se guarda como HMAC (clave del servidor), nunca en claro, y
//    se compara en tiempo constante;
//  - 10 min de validez, 5 intentos por reto, un solo uso (UPDATE atómico);
//  - reenvíos: 1 por minuto y máximo 5 por reto; máximo 5 retos por cuenta
//    cada 15 min (evita bombardear un buzón).
export const MFA_COOKIE = "vintum_mfa";
export const MFA_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const RESEND_COOLDOWN_S = 60;
const MAX_CHALLENGES_15M = 5;

export type MfaPurpose = "register" | "login" | "notice";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function codeHash(tokenHash: string, code: string): string {
  return createHmac("sha256", config.cookieSecret).update(`${tokenHash}:${code}`).digest("hex");
}

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  const visible = user.slice(0, Math.min(2, Math.max(1, user.length - 1)));
  return `${visible}${"*".repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}

export async function tooManyChallenges(userId: number): Promise<boolean> {
  const [rows] = await pool.execute<any[]>(
    "SELECT COUNT(*) AS n FROM auth_challenges WHERE user_id = ? AND created_at > (NOW() - INTERVAL 15 MINUTE)",
    [userId],
  );
  return (rows[0]?.n ?? 0) >= MAX_CHALLENGES_15M;
}

// Crea un reto nuevo (anula los pendientes de esa cuenta) y devuelve el
// código para enviarlo por correo. "notice" no lleva código utilizable: solo
// cuenta para el límite de correos (aviso de "ya tienes cuenta").
export async function createChallenge(
  reply: FastifyReply,
  userId: number,
  purpose: MfaPurpose,
  ip: string,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const code = newCode();
  await pool.execute(
    "UPDATE auth_challenges SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
    [userId],
  );
  await pool.execute(
    `INSERT INTO auth_challenges (token_hash, user_id, purpose, code_hash, ip, expires_at, last_sent_at, used_at)
     VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ${MFA_TTL_MIN} MINUTE, NOW(), ${purpose === "notice" ? "NOW()" : "NULL"})`,
    [tokenHash, userId, purpose, codeHash(tokenHash, code), ip],
  );
  setMfaCookie(reply, token);
  if (Math.random() < 0.05) {
    await pool.execute("DELETE FROM auth_challenges WHERE created_at < (NOW() - INTERVAL 7 DAY)");
  }
  return code;
}

// Cookie de reto "señuelo" (para respuestas idénticas cuando no se debe
// revelar si una cuenta existe): no corresponde a ningún reto en la BD.
export function setDecoyMfaCookie(reply: FastifyReply): void {
  setMfaCookie(reply, randomBytes(32).toString("hex"));
}

function setMfaCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(MFA_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: MFA_TTL_MIN * 60,
  });
}

export function clearMfaCookie(reply: FastifyReply): void {
  reply.clearCookie(MFA_COOKIE, { path: "/api/auth" });
}

function readToken(req: FastifyRequest): string | null {
  const token = req.cookies[MFA_COOKIE];
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export type VerifyResult =
  | { ok: true; userId: number; purpose: MfaPurpose }
  | { ok: false; error: "invalid_code" | "code_expired" | "too_many_attempts"; remaining?: number };

export async function verifyChallenge(req: FastifyRequest, code: string): Promise<VerifyResult> {
  const token = readToken(req);
  if (!token) return { ok: false, error: "code_expired" };
  const tokenHash = sha256(token);

  // Se cuenta el intento ANTES de comprobar el código (atómico): con
  // peticiones en paralelo tampoco se pueden hacer más de MAX_ATTEMPTS.
  const [counted] = await pool.execute<any>(
    `UPDATE auth_challenges SET attempts = attempts + 1
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() AND attempts < ?`,
    [tokenHash, MAX_ATTEMPTS],
  );
  if (counted.affectedRows !== 1) {
    const [rows] = await pool.execute<any[]>(
      "SELECT attempts, used_at, expires_at > NOW() AS vigente FROM auth_challenges WHERE token_hash = ?",
      [tokenHash],
    );
    const r = rows[0];
    if (r && !r.used_at && r.vigente && r.attempts >= MAX_ATTEMPTS) {
      await pool.execute("UPDATE auth_challenges SET used_at = NOW() WHERE token_hash = ?", [tokenHash]);
      return { ok: false, error: "too_many_attempts" };
    }
    return { ok: false, error: "code_expired" };
  }

  const [rows] = await pool.execute<any[]>(
    "SELECT user_id, purpose, code_hash, attempts FROM auth_challenges WHERE token_hash = ?",
    [tokenHash],
  );
  const ch = rows[0];
  if (!ch) return { ok: false, error: "code_expired" };

  const expected = Buffer.from(ch.code_hash, "hex");
  const given = Buffer.from(codeHash(tokenHash, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const remaining = MAX_ATTEMPTS - ch.attempts;
    if (remaining <= 0) {
      await pool.execute("UPDATE auth_challenges SET used_at = NOW() WHERE token_hash = ?", [tokenHash]);
      return { ok: false, error: "too_many_attempts" };
    }
    return { ok: false, error: "invalid_code", remaining };
  }

  // Un solo uso: si dos peticiones aciertan a la vez, solo una gana.
  const [claim] = await pool.execute<any>(
    "UPDATE auth_challenges SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL",
    [tokenHash],
  );
  if (claim.affectedRows !== 1) return { ok: false, error: "code_expired" };
  return { ok: true, userId: Number(ch.user_id), purpose: ch.purpose };
}

export type ResendResult =
  | { ok: true; userId: number; code: string }
  | { ok: false; error: "code_expired" | "resend_too_soon" | "too_many_resends" };

export async function resendChallenge(req: FastifyRequest): Promise<ResendResult> {
  const token = readToken(req);
  if (!token) return { ok: false, error: "code_expired" };
  const tokenHash = sha256(token);
  const [rows] = await pool.execute<any[]>(
    `SELECT user_id, sends, TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS desde
     FROM auth_challenges WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash],
  );
  const ch = rows[0];
  if (!ch) return { ok: false, error: "code_expired" };
  if (ch.sends >= MAX_SENDS) return { ok: false, error: "too_many_resends" };
  if (ch.desde < RESEND_COOLDOWN_S) return { ok: false, error: "resend_too_soon" };

  // Código nuevo, intentos a cero; condición en el UPDATE para que dos
  // reenvíos simultáneos no se cuelen a la vez.
  const code = newCode();
  const [upd] = await pool.execute<any>(
    `UPDATE auth_challenges
     SET code_hash = ?, attempts = 0, sends = sends + 1, last_sent_at = NOW(),
         expires_at = NOW() + INTERVAL ${MFA_TTL_MIN} MINUTE
     WHERE token_hash = ? AND used_at IS NULL AND sends < ? AND last_sent_at <= (NOW() - INTERVAL ${RESEND_COOLDOWN_S} SECOND)`,
    [codeHash(tokenHash, code), tokenHash, MAX_SENDS],
  );
  if (upd.affectedRows !== 1) return { ok: false, error: "resend_too_soon" };
  return { ok: true, userId: Number(ch.user_id), code };
}
