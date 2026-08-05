#!/usr/bin/env node
// Create the first admin account without ever committing a credential.
//
//   node scripts/bootstrap-admin.mjs you@example.com 'a-strong-password'
//
// Prints SQL to stdout. Apply it with wrangler, e.g.:
//   node scripts/bootstrap-admin.mjs you@example.com 'pw' > /tmp/admin.sql
//   npx wrangler d1 execute webapp-production --local --file=/tmp/admin.sql
//   npx wrangler d1 execute webapp-production --remote --file=/tmp/admin.sql
//
// The hash format matches src/lib/auth.ts exactly: pbkdf2$<iters>$<salt>$<hash>
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERATIONS = 100000
const MIN_PASSWORD_LENGTH = 12

function hashPassword(password) {
  const salt = randomBytes(16)
  const bits = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  return `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${bits.toString('base64')}`
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''")
}

function main() {
  const [email, password] = process.argv.slice(2)

  if (!email || !password) {
    console.error("usage: node scripts/bootstrap-admin.mjs <email> '<password>'")
    process.exit(1)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`error: '${email}' is not a valid email address`)
    process.exit(1)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`error: choose a password of at least ${MIN_PASSWORD_LENGTH} characters`)
    process.exit(1)
  }

  const normalizedEmail = sqlEscape(email.trim().toLowerCase())
  const hash = hashPassword(password)

  process.stdout.write(`-- AURA admin bootstrap for ${normalizedEmail}
-- Generated ${new Date().toISOString()} — contains a password hash, do not commit.
INSERT OR IGNORE INTO users (email, password_hash, role, status) VALUES
  ('${normalizedEmail}', '${hash}', 'admin', 'active');

INSERT OR IGNORE INTO profiles (user_id, display_name, onboarded)
  SELECT id, 'AURA Admin', 1 FROM users WHERE email = '${normalizedEmail}';

INSERT OR IGNORE INTO subscriptions (user_id, plan, status)
  SELECT id, 'premium', 'active' FROM users WHERE email = '${normalizedEmail}';
`)
}

main()
