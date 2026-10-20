import nodemailer from "nodemailer";
import { config } from "../config.js";

// Un solo transporte reutilizable. Gmail por 587 + STARTTLS obligatorio
// (requireTLS): si el servidor no ofrece TLS, no se manda nada en claro.
// La credencial es una "contraseña de aplicación" de la cuenta de envío --
// solo sirve para SMTP, no para entrar a la cuenta.
const transporter = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      requireTLS: true,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  : null;

export const mailEnabled = transporter != null;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendPasswordResetMail(to: string, displayName: string, link: string, minutes: number): Promise<void> {
  if (!transporter || !config.smtp) throw new Error("smtp_not_configured");
  const name = escapeHtml(displayName);
  await transporter.sendMail({
    from: `"Vintum" <${config.smtp.from}>`,
    to,
    subject: "Reset your Vintum password",
    text:
      `Hi ${displayName},\n\n` +
      `Someone (hopefully you) asked to reset the password of your Vintum account.\n` +
      `Open this link to choose a new one (valid for ${minutes} minutes, single use):\n\n${link}\n\n` +
      `If you didn't ask for this, ignore this email -- your password stays the same.\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1f2328">` +
      `<h2 style="margin:0 0 16px">Vintum</h2>` +
      `<p>Hi ${name},</p>` +
      `<p>Someone (hopefully you) asked to reset the password of your Vintum account.</p>` +
      `<p style="text-align:center;margin:28px 0"><a href="${link}" style="background:#0366d6;color:#fff;` +
      `padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a></p>` +
      `<p style="font-size:13px;color:#57606a">The link is valid for ${minutes} minutes and can be used once. ` +
      `If you didn't ask for this, ignore this email -- your password stays the same.</p></div>`,
  });
}

// Código del segundo factor. El código NO va en el asunto (se vería en la
// notificación del móvil con la pantalla bloqueada).
export async function sendOtpMail(
  to: string,
  displayName: string,
  code: string,
  purpose: "register" | "login",
  minutes: number,
): Promise<void> {
  if (!transporter || !config.smtp) throw new Error("smtp_not_configured");
  const name = escapeHtml(displayName);
  const action = purpose === "register" ? "finish creating your Vintum account" : "log in to Vintum";
  await transporter.sendMail({
    from: `"Vintum" <${config.smtp.from}>`,
    to,
    subject: purpose === "register" ? "Confirm your Vintum account" : "Your Vintum login code",
    text:
      `Hi ${displayName},\n\nUse this code to ${action}:\n\n    ${code}\n\n` +
      `It expires in ${minutes} minutes and can only be used once.\n` +
      `If it wasn't you, ignore this email${purpose === "login" ? " and change your password -- someone knows it" : ""}.\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1f2328">` +
      `<h2 style="margin:0 0 16px">Vintum</h2><p>Hi ${name},</p><p>Use this code to ${action}:</p>` +
      `<p style="text-align:center;margin:28px 0;font-size:32px;font-weight:700;letter-spacing:8px;` +
      `font-family:ui-monospace,monospace">${code}</p>` +
      `<p style="font-size:13px;color:#57606a">It expires in ${minutes} minutes and can only be used once. ` +
      `If it wasn't you, ignore this email${purpose === "login" ? " and <b>change your password</b> -- someone knows it" : ""}.</p></div>`,
  });
}

// Alguien intentó registrarse con un correo que ya tiene cuenta: al dueño se
// le avisa (la respuesta de la API es idéntica a la de un alta nueva, para
// no revelar qué correos están registrados).
export async function sendAccountExistsMail(to: string, displayName: string): Promise<void> {
  if (!transporter || !config.smtp) throw new Error("smtp_not_configured");
  const name = escapeHtml(displayName);
  await transporter.sendMail({
    from: `"Vintum" <${config.smtp.from}>`,
    to,
    subject: "Someone tried to sign up with your email",
    text:
      `Hi ${displayName},\n\nSomeone tried to create a Vintum account with this email, but you already have one.\n` +
      `If it was you, just log in (or use "Forgot your password?"). Otherwise you can ignore this email.\n`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1f2328">` +
      `<h2 style="margin:0 0 16px">Vintum</h2><p>Hi ${name},</p>` +
      `<p>Someone tried to create a Vintum account with this email, but you already have one.</p>` +
      `<p style="font-size:13px;color:#57606a">If it was you, just log in (or use "Forgot your password?"). ` +
      `Otherwise you can ignore this email.</p></div>`,
  });
}
