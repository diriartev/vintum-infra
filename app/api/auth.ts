import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/auth.js";
import { requireAuth, requireCsrf } from "../plugins/session.js";
import { getClientIp } from "../lib/clientIp.js";
import { avatarUrl, deleteAvatar } from "../lib/avatar.js";
import {
  mailEnabled,
  sendAccountExistsMail,
  sendOtpMail,
  sendPasswordResetMail,
} from "../lib/mailer.js";
import {
  MFA_TTL_MIN,
  clearMfaCookie,
  createChallenge,
  maskEmail,
  resendChallenge,
  setDecoyMfaCookie,
  tooManyChallenges,
  verifyChallenge,
} from "../lib/mfa.js";
import { config } from "../config.js";

const emailSchema = z.string().trim().toLowerCase().email().max(255);
// Longitud mínima 10 (lineamiento NIST 800-63B / práctica ISO 27001: priorizar
// longitud sobre reglas de composición forzadas). Tope alto por DoS de hashing.
const passwordSchema = z.string().min(10).max(256);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const forgotSchema = z.object({ email: emailSchema });

const verifySchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

// Hash de relleno para que el login tarde lo mismo exista o no la cuenta
// (si no, el tiempo de respuesta delataría qué correos están registrados).
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

const resetSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  password: passwordSchema,
});

// Recuperación de contraseña (OWASP Forgot Password Cheat Sheet): token
// aleatorio de 256 bits, de un solo uso, que caduca a los 30 minutos. En la
// base solo se guarda su SHA-256 -- quien lea la tabla no puede usar los
// enlaces pendientes. Máx. 3 correos por cuenta y hora.
const RESET_TTL_MIN = 30;
const RESET_MAX_PER_HOUR = 3;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function recentFailedAttempts(email: string, ip: string): Promise<number> {
  const [rows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE email = ? AND ip = ? AND success = 0 AND created_at > (NOW() - INTERVAL 15 MINUTE)`,
    [email, ip],
  );
  return rows[0]?.n ?? 0;
}

async function recordAttempt(email: string, ip: string, success: boolean): Promise<void> {
  await pool.execute(
    "INSERT INTO login_attempts (email, ip, success) VALUES (?, ?, ?)",
    [email, ip, success ? 1 : 0],
  );
  // Minimización de datos: no hace falta guardar intentos de login viejos
  // para siempre. ~5% de las veces, de paso, se podan los de hace más de 7
  // días (no crítico que sea exacto, por eso no se hace en cada insert).
  if (Math.random() < 0.05) {
    await pool.execute("DELETE FROM login_attempts WHERE created_at < (NOW() - INTERVAL 7 DAY)");
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { email, password, displayName } = parsed.data;

    if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
      return reply.code(400).send({ error: "password_too_weak" });
    }

    if (!mailEnabled) return reply.code(503).send({ error: "mail_unavailable" });
    const ip = getClientIp(req);
    const passwordHash = await hashPassword(password);
    // Respuesta idéntica en todos los casos (no revela si el correo ya
    // tiene cuenta). La cuenta solo queda activa al confirmar el código.
    const pending = { otpRequired: true, email: maskEmail(email) };

    const [rows] = await pool.execute<any[]>(
      "SELECT id, display_name, email_verified_at FROM users WHERE email = ?",
      [email],
    );
    const existing = rows[0];

    if (existing && existing.email_verified_at) {
      // Ya hay una cuenta confirmada: aviso al dueño, cookie señuelo y nada más.
      if (!(await tooManyChallenges(existing.id))) {
        await createChallenge(reply, existing.id, "notice", ip);
        sendAccountExistsMail(email, existing.display_name).catch((err) =>
          req.log.error({ event: "mail_failed", err }),
        );
      }
      setDecoyMfaCookie(reply);
      req.log.info({ event: "register_existing_email", ip, userId: existing.id });
      return reply.code(202).send(pending);
    }

    let userId: number;
    if (existing) {
      // Alta sin confirmar (abandonada): se reemplaza. El código va al buzón
      // real, así que solo su dueño puede terminarla.
      if (await tooManyChallenges(existing.id)) {
        setDecoyMfaCookie(reply);
        return reply.code(202).send(pending);
      }
      await pool.execute("UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?", [
        passwordHash,
        displayName,
        existing.id,
      ]);
      userId = existing.id;
    } else {
      try {
        const [result] = await pool.execute<any>(
          "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
          [email, passwordHash, displayName],
        );
        userId = result.insertId as number;
      } catch (err: any) {
        req.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    }

    const code = await createChallenge(reply, userId, "register", ip);
    sendOtpMail(email, displayName, code, "register", MFA_TTL_MIN).catch((err) =>
      req.log.error({ event: "otp_mail_failed", userId, err }),
    );
    req.log.info({ event: "register_pending", ip, userId });
    // Limpieza ocasional de altas nunca confirmadas.
    if (Math.random() < 0.05) {
      await pool.execute(
        "DELETE FROM users WHERE email_verified_at IS NULL AND created_at < (NOW() - INTERVAL 1 DAY)",
      );
    }
    return reply.code(202).send(pending);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { email, password } = parsed.data;
    const ip = getClientIp(req);

    if ((await recentFailedAttempts(email, ip)) >= 8) {
      return reply.code(429).send({ error: "too_many_attempts" });
    }

    const [rows] = await pool.execute<any[]>(
      "SELECT id, password_hash, display_name, avatar_version FROM users WHERE email = ?",
      [email],
    );
    const user = rows[0];

    // Mismo mensaje/forma de respuesta exista o no el usuario -- no revelar
    // si el email está registrado (evita enumeración de cuentas). Si no
    // existe se verifica contra un hash de relleno: mismo tiempo de respuesta.
    const ok = await verifyPassword(user ? user.password_hash : await getDummyHash(), password);
    await recordAttempt(email, ip, ok && !!user);
    if (!ok || !user) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    // Contraseña correcta: falta el segundo factor (código al correo).
    if (!mailEnabled) return reply.code(503).send({ error: "mail_unavailable" });
    if (await tooManyChallenges(user.id)) {
      return reply.code(429).send({ error: "too_many_attempts" });
    }
    const code = await createChallenge(reply, user.id, "login", ip);
    sendOtpMail(email, user.display_name, code, "login", MFA_TTL_MIN).catch((err) =>
      req.log.error({ event: "otp_mail_failed", userId: user.id, err }),
    );
    req.log.info({ event: "mfa_challenge_sent", ip, userId: user.id });
    return reply.code(202).send({ otpRequired: true, email: maskEmail(email) });
  });

  // Segundo factor: único sitio donde nace una sesión.
  app.post("/api/auth/verify", async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_code" });
    const ip = getClientIp(req);

    const result = await verifyChallenge(req, parsed.data.code);
    if (!result.ok) {
      req.log.warn({ event: "mfa_verify_failed", ip, reason: result.error });
      if (result.error !== "invalid_code") clearMfaCookie(reply);
      const status = result.error === "too_many_attempts" ? 429 : 400;
      return reply.code(status).send({ error: result.error, remaining: result.remaining });
    }

    const [rows] = await pool.execute<any[]>(
      "SELECT id, email, display_name, avatar_version, email_verified_at FROM users WHERE id = ?",
      [result.userId],
    );
    const user = rows[0];
    if (!user) return reply.code(400).send({ error: "code_expired" });
    if (!user.email_verified_at) {
      await pool.execute("UPDATE users SET email_verified_at = NOW() WHERE id = ?", [user.id]);
    }
    await pool.execute("DELETE FROM login_attempts WHERE email = ? AND success = 0", [user.email]);

    clearMfaCookie(reply);
    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    req.log.info({ event: "mfa_verified", ip, userId: user.id, purpose: result.purpose });
    return reply.code(result.purpose === "register" ? 201 : 200).send({
      csrfToken: session.csrfToken,
      displayName: user.display_name,
      email: user.email,
      imageURL: avatarUrl(user.id, user.avatar_version),
    });
  });

  app.post("/api/auth/resend", async (req, reply) => {
    const result = await resendChallenge(req);
    if (!result.ok) {
      return reply.code(result.error === "code_expired" ? 400 : 429).send({ error: result.error });
    }
    const [rows] = await pool.execute<any[]>(
      "SELECT email, display_name, email_verified_at FROM users WHERE id = ?",
      [result.userId],
    );
    const user = rows[0];
    if (user) {
      sendOtpMail(user.email, user.display_name, result.code, user.email_verified_at ? "login" : "register", MFA_TTL_MIN)
        .catch((err) => req.log.error({ event: "otp_mail_failed", userId: result.userId, err }));
    }
    return reply.send({ ok: true });
  });

  // Siempre la misma respuesta (200 {ok:true}) exista o no la cuenta, igual
  // que el login: no sirve para averiguar qué correos están registrados.
  // El envío del correo no se espera (no delata por tiempo de respuesta).
  app.post("/api/auth/forgot", async (req, reply) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    if (!mailEnabled) return reply.code(503).send({ error: "mail_unavailable" });
    const { email } = parsed.data;
    const ip = getClientIp(req);

    const [rows] = await pool.execute<any[]>(
      "SELECT id, display_name FROM users WHERE email = ?",
      [email],
    );
    const user = rows[0];
    if (!user) {
      req.log.info({ event: "password_reset_requested", ip, known: false });
      return reply.send({ ok: true });
    }

    const [recent] = await pool.execute<any[]>(
      "SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > (NOW() - INTERVAL 1 HOUR)",
      [user.id],
    );
    if ((recent[0]?.n ?? 0) >= RESET_MAX_PER_HOUR) {
      req.log.warn({ event: "password_reset_throttled", ip, userId: user.id });
      return reply.send({ ok: true });
    }

    const token = randomBytes(32).toString("hex");
    await pool.execute(
      `INSERT INTO password_resets (token_hash, user_id, ip, expires_at)
       VALUES (?, ?, ?, NOW() + INTERVAL ${RESET_TTL_MIN} MINUTE)`,
      [sha256(token), user.id, ip],
    );
    // El token va en el fragmento (#): el navegador no lo manda al servidor
    // ni en el Referer, así que no queda en logs de nginx/Cloudflare.
    const link = `${config.publicUrl}/#/reset-password?token=${token}`;
    req.log.info({ event: "password_reset_requested", ip, known: true, userId: user.id });
    sendPasswordResetMail(email, user.display_name, link, RESET_TTL_MIN).then(
      () => req.log.info({ event: "password_reset_mail_sent", userId: user.id }),
      (err) => req.log.error({ event: "password_reset_mail_failed", userId: user.id, err }),
    );
    return reply.send({ ok: true });
  });

  app.post("/api/auth/reset", async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { token, password } = parsed.data;
    const tokenHash = sha256(token);
    const ip = getClientIp(req);

    const [rows] = await pool.execute<any[]>(
      `SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW()`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      req.log.warn({ event: "password_reset_invalid_token", ip });
      return reply.code(400).send({ error: "invalid_token" });
    }
    if (password.toLowerCase().includes(row.email.split("@")[0].toLowerCase())) {
      return reply.code(400).send({ error: "password_too_weak" });
    }

    const passwordHash = await hashPassword(password);
    // "Reclamar" el token con un UPDATE condicional: si dos peticiones llegan
    // a la vez con el mismo enlace, solo una lo consigue (un solo uso real).
    const [claim] = await pool.execute<any>(
      "UPDATE password_resets SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()",
      [tokenHash],
    );
    if (claim.affectedRows !== 1) return reply.code(400).send({ error: "invalid_token" });

    await pool.execute(
      "UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?",
      [passwordHash, row.user_id],
    );
    // Tras cambiar la contraseña: se cierran todas las sesiones abiertas
    // (por si alguien más estaba dentro), se anulan los demás enlaces
    // pendientes y se limpia el bloqueo por intentos fallidos.
    await pool.execute("DELETE FROM sessions WHERE user_id = ?", [row.user_id]);
    await pool.execute(
      "UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [row.user_id],
    );
    await pool.execute("DELETE FROM login_attempts WHERE email = ? AND success = 0", [row.email]);
    req.log.info({ event: "password_reset_completed", ip, userId: row.user_id });
    return reply.send({ ok: true });
  });

  app.post("/api/auth/logout", { preHandler: [requireAuth, requireCsrf] }, async (req, reply) => {
    if (req.sessionId) await destroySession(req.sessionId);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: [requireAuth] }, async (req, reply) => {
    const [rows] = await pool.execute<any[]>(
      "SELECT email, display_name, avatar_version FROM users WHERE id = ?",
      [req.userId],
    );
    if (!rows[0]) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({
      email: rows[0].email,
      displayName: rows[0].display_name,
      imageURL: avatarUrl(req.userId!, rows[0].avatar_version),
      csrfToken: req.csrfToken,
    });
  });

  app.delete("/api/auth/me", { preHandler: [requireAuth, requireCsrf] }, async (req, reply) => {
    const [rows] = await pool.execute<any[]>(
      "SELECT avatar_version FROM users WHERE id = ?",
      [req.userId],
    );
    await pool.execute("DELETE FROM users WHERE id = ?", [req.userId]);
    if (rows[0]?.avatar_version) await deleteAvatar(req.userId!, rows[0].avatar_version);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });
};
