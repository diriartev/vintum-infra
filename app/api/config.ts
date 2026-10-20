import { readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_SSL_CA: z.string(),
  DB_SSL_CERT: z.string(),
  DB_SSL_KEY: z.string(),
  COOKIE_SECRET: z.string().min(32),
  NODE_ENV: z.enum(["production", "development"]).default("production"),
  // Correo saliente (recuperación de contraseña). Opcional: sin SMTP_PASS
  // la API arranca igual y /api/auth/forgot responde 503.
  PUBLIC_URL: z.string().url().default("https://web.vintum.example"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  isProd: env.NODE_ENV === "production",
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: {
      ca: readFileSync(env.DB_SSL_CA, "utf8"),
      cert: readFileSync(env.DB_SSL_CERT, "utf8"),
      key: readFileSync(env.DB_SSL_KEY, "utf8"),
      // mTLS: exigimos que el server presente un cert firmado por nuestra CA
      // (evita MITM), no solo que la conexión esté cifrada.
      rejectUnauthorized: true,
    },
  },
  cookieSecret: env.COOKIE_SECRET,
  publicUrl: env.PUBLIC_URL.replace(/\/+$/, ""),
  smtp:
    env.SMTP_USER && env.SMTP_PASS
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.SMTP_FROM ?? env.SMTP_USER,
        }
      : null,
};
