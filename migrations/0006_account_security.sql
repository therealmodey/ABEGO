-- AURA — Authentication & Account security surface
-- Power the dedicated auth + account-management flow:
--   email verification (signup gate), password reset, change-password,
--   sign-out-everywhere (per-device sessions), export-data request, delete-account.
-- All tokens/codes are single-use, time-boxed, and rotate the user's token
-- version on use so every other device is signed out as designed.

-- Email verification state on the user row.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- One-time codes (email verification + password reset). Single row per
-- (user, purpose); (re)issued on demand, consumed or expired on use.
CREATE TABLE IF NOT EXISTS auth_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code        TEXT NOT NULL,
  token       TEXT NOT NULL,          -- opaque reset token embedded in the link
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, purpose)
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_token ON auth_codes(token);

-- Active login sessions, one per device/token. Lets "sign out everywhere"
-- enumerate and revoke other devices while keeping the current one.
CREATE TABLE IF NOT EXISTS sessions_registry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti         TEXT NOT NULL,            -- matches the JWT jti
  device      TEXT NOT NULL DEFAULT 'Unknown device',
  location    TEXT NOT NULL DEFAULT '',
  last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, jti)
);
CREATE INDEX IF NOT EXISTS idx_sessions_registry_user ON sessions_registry(user_id);

-- Data export requests (the app emails a link; we just record the request).
CREATE TABLE IF NOT EXISTS export_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'expired')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_export_requests_user ON export_requests(user_id);
