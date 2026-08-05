-- Token revocation.
--
-- JWTs are stateless: until this migration, a stolen 7-day token stayed valid
-- for its full lifetime and logout only deleted the cookie. Two mechanisms:
--
--  1. revoked_tokens  — kills exactly one token (logout), keyed by its jti,
--     so logging out on one device does not sign you out everywhere.
--  2. users.token_version — kills every token for a user at once (suspension,
--     role change, and password reset when that ships). Tokens carry `tv`;
--     a mismatch fails auth.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,          -- unix seconds; row is prunable after this
  revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lets expired rows be swept without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens (expires_at);

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
