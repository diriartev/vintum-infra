CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  display_name   VARCHAR(80)  NOT NULL,
  -- 0 = sin avatar propio (se muestra la inicial). El nombre del archivo
  -- servido es <id>-<avatar_version>.webp -- nunca un nombre que haya
  -- mandado el cliente, y siempre el resultado de re-codificar la imagen
  -- desde cero (ver src/lib/avatar.ts), nunca los bytes originales subidos.
  avatar_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id          CHAR(64)        NOT NULL PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  csrf_token  CHAR(64)        NOT NULL,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Blob de preferencias del front (tarjetas/fuentes seguidas, layout, tema,
-- etc.), validado en forma y tamaño en la capa de aplicación antes de
-- llegar acá (ver src/lib/preferences.ts) -- nunca se interpreta ni se usa
-- para construir SQL, solo se guarda y se devuelve tal cual.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  data        JSON            NOT NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  ip          VARCHAR(45)  NOT NULL,
  success     TINYINT(1)   NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_login_attempts_lookup (email, ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Recuperación de contraseña: solo el SHA-256 del token (nunca el token),
-- un solo uso (used_at) y caducidad de 30 min (ver src/routes/auth.ts).
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  CHAR(64)        NOT NULL PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  ip          VARCHAR(45)     NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  used_at     DATETIME        NULL,
  KEY idx_password_resets_user (user_id, created_at),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Segundo factor por correo (registro y cada login; ver src/lib/mfa.ts).
-- email_verified_at: la cuenta solo queda activa al confirmar el código.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL;

-- Retos del segundo factor: solo hashes (del token de la cookie y HMAC del
-- código), intentos contados, caducidad y un solo uso.
CREATE TABLE IF NOT EXISTS auth_challenges (
  token_hash    CHAR(64)        NOT NULL PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  purpose       ENUM('register','login','notice') NOT NULL,
  code_hash     CHAR(64)        NOT NULL,
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sends         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ip            VARCHAR(45)     NOT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at  DATETIME        NOT NULL,
  expires_at    DATETIME        NOT NULL,
  used_at       DATETIME        NULL,
  KEY idx_auth_challenges_user (user_id, created_at),
  CONSTRAINT fk_auth_challenges_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
