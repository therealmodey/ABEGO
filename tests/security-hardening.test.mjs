// ============================================================================
// AURA — session & transport hardening invariants (PR #2)
//
// TASK 1  CORS: no reflected-origin-with-credentials; explicit allowlist only
// TASK 2  Token revocation: per-token jti on logout, token_version for "kill all"
// TASK 3  Security headers applied globally (CSP deliberately excluded)
// TASK 4  Impersonation tokens are short-lived, not 7-day sessions
//
// Same style as security-critical.test.mjs: assertions run against the real
// source and schema, plus executable mirrors of the pure logic.
// ============================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const index = read('src/index.tsx')
const middleware = read('src/lib/middleware.ts')
const authLib = read('src/lib/auth.ts')
const authRoutes = read('src/routes/auth.ts')
const adminRoutes = read('src/routes/admin.ts')
const migration = read('migrations/0005_token_revocation.sql')

let passed = 0
const check = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`)
    process.exitCode = 1
  }
}

// ---------------------------------------------------------------- TASK 1 -----
console.log('\nTASK 1  CORS allowlist')

check('no reflected origin in the cors config', () => {
  assert.ok(!/origin:\s*\(o\)\s*=>\s*o/.test(index), 'cors still reflects any Origin back')
  assert.match(index, /corsOrigin\(c\.env\)/, 'cors does not use the allowlist resolver')
})

check('credentials are only granted alongside an allowlist', () => {
  assert.match(index, /credentials:\s*true/)
  assert.match(middleware, /export function corsOrigin/)
  assert.match(middleware, /ALLOWED_ORIGINS\?: string/, 'ALLOWED_ORIGINS is not typed on the bindings')
})

check('allowlist resolver logic is correct', () => {
  // Mirror of parseAllowedOrigins + corsOrigin.
  const parse = (raw) => (raw || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)
  const resolve = (raw) => {
    const allowed = parse(raw)
    return (origin) => (origin && allowed.includes(origin.replace(/\/$/, '')) ? origin : null)
  }

  const none = resolve(undefined)
  assert.equal(none('https://evil.example'), null, 'unset ALLOWED_ORIGINS must allow nothing')
  assert.equal(none(''), null)

  const one = resolve(' https://app.aura.test/ , https://staging.aura.test ')
  assert.equal(one('https://app.aura.test'), 'https://app.aura.test', 'listed origin rejected')
  assert.equal(one('https://staging.aura.test'), 'https://staging.aura.test', 'listed origin rejected')
  assert.equal(one('https://evil.example'), null, 'unlisted origin allowed')
  assert.equal(one('https://app.aura.test.evil.example'), null, 'suffix-matching origin allowed')
  assert.equal(one('http://app.aura.test'), null, 'scheme downgrade allowed')
})

check('committed config does not pre-authorise any origin', () => {
  assert.ok(!/ALLOWED_ORIGINS/.test(read('wrangler.jsonc')), 'wrangler.jsonc pre-authorises origins')
})

// ---------------------------------------------------------------- TASK 2 -----
console.log('\nTASK 2  token revocation')

check('tokens carry a jti and a token_version snapshot', () => {
  assert.match(authLib, /jti\?: string/)
  assert.match(authLib, /tv\?: number/)
  assert.match(authLib, /export function newJti/)
  const jti = authLib.slice(authLib.indexOf('export function newJti'))
  assert.match(jti.slice(0, 200), /crypto\.getRandomValues/, 'jti is not cryptographically random')

  const issued = authRoutes.match(/signJwt\(/g) || []
  assert.ok(issued.length >= 2, 'expected signup and login to issue tokens')
  for (const call of authRoutes.split('signJwt(').slice(1)) {
    assert.match(call.slice(0, 250), /jti: newJti\(\)/, 'a token is issued without a jti')
    assert.match(call.slice(0, 250), /tv:/, 'a token is issued without a token_version')
  }
})

check('logout revokes the token server-side, not just the cookie', () => {
  const logout = authRoutes.slice(authRoutes.indexOf("auth.post('/logout'"))
  const body = logout.slice(0, logout.indexOf('\n})'))
  assert.match(body, /revokeToken\(/, 'logout does not revoke the token')
  assert.match(body, /deleteCookie/, 'logout no longer clears the cookie')
  assert.match(body, /Authorization/, 'logout ignores bearer tokens')
})

check('requireAuth rejects revoked tokens and stale token_versions', () => {
  const guard = middleware.slice(middleware.indexOf('export async function requireAuth'))
  const body = guard.slice(0, guard.indexOf('export async function requireAdmin'))
  assert.match(body, /token_version/, 'requireAuth does not read token_version')
  assert.match(body, /isTokenRevoked\(/, 'requireAuth does not check the revocation list')
  assert.match(body, /payload\.tv \?\? 1\) !== \(row\.token_version \?\? 1\)/, 'token_version mismatch is not enforced')
  // Both checks must reject, and must happen before the request is served.
  assert.ok(body.indexOf('isTokenRevoked(') < body.indexOf('await next()'), 'revocation checked after handler ran')
  assert.equal((body.match(/401/g) || []).length >= 3, true, 'revocation paths do not return 401')
})

check('legacy tokens without tv still authenticate (no forced logout on deploy)', () => {
  const cmp = (tv, dbVersion) => (tv ?? 1) !== (dbVersion ?? 1)
  assert.equal(cmp(undefined, 1), false, 'pre-migration token would be rejected')
  assert.equal(cmp(1, 1), false)
  assert.equal(cmp(1, 2), true, 'stale token accepted after a bump')
  assert.equal(cmp(3, 2), true, 'forged higher version accepted')
})

check('revocation is scoped to one session, and sweeps expired rows', () => {
  const fn = middleware.slice(middleware.indexOf('export async function revokeToken'))
  const body = fn.slice(0, fn.indexOf('export async function isTokenRevoked'))
  assert.match(body, /INSERT OR IGNORE INTO revoked_tokens/)
  assert.match(body, /payload\.jti/, 'revokeToken does not key on the jti')
  assert.ok(!/token_version/.test(body), 'logout must not sign the user out of other devices')
  assert.match(body, /DELETE FROM revoked_tokens WHERE expires_at </, 'no pruning of expired revocations')
})

check('privilege changes invalidate every existing session', () => {
  assert.match(middleware, /export async function bumpTokenVersion/)
  assert.match(middleware, /SET token_version = token_version \+ 1/)
  for (const marker of ["'role_change'", "'suspend_user'", "'delete_user'"]) {
    const at = adminRoutes.indexOf(marker)
    assert.ok(at !== -1, `${marker} handler not found`)
    const before = adminRoutes.slice(Math.max(0, at - 700), at)
    assert.match(before, /bumpTokenVersion\(/, `${marker} does not revoke existing sessions`)
  }
})

check('migration 0005 creates the revocation table and column', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS revoked_tokens/)
  assert.match(migration, /jti\s+TEXT PRIMARY KEY/)
  assert.match(migration, /idx_revoked_tokens_expires/)
  assert.match(migration, /ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1/)
})

// ---------------------------------------------------------------- TASK 3 -----
console.log('\nTASK 3  security headers')

check('headers middleware is registered globally, before routes', () => {
  assert.match(index, /app\.use\('\*', securityHeaders\)/)
  assert.ok(index.indexOf('securityHeaders') < index.indexOf("app.route('/api/auth'"), 'headers registered after routes')
})

check('all defence-in-depth headers are set', () => {
  const fn = middleware.slice(middleware.indexOf('export async function securityHeaders'))
  for (const [header, value] of [
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=\\(\\)'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Strict-Transport-Security', 'max-age=31536000'],
  ]) {
    assert.match(fn, new RegExp(`'${header}',\\s*'${value}`), `${header} is not set`)
  }
})

check('HSTS is only sent over https and API responses are not cacheable', () => {
  const fn = middleware.slice(middleware.indexOf('export async function securityHeaders'))
  assert.match(fn, /protocol === 'https:'/, 'HSTS is sent on plain http too')
  assert.match(fn, /'Cache-Control',\s*'no-store'/, 'authenticated API responses are cacheable')
  assert.match(fn, /startsWith\('\/api\/'\)/)
})

check('CSP is deliberately not set here (ships separately, needs a visual pass)', () => {
  assert.ok(
    !/Content-Security-Policy/i.test(middleware.replace(/\/\/.*$/gm, '')),
    'CSP was added outside its own reviewed change',
  )
})

// ---------------------------------------------------------------- TASK 4 -----
console.log('\nTASK 4  impersonation scope')

check('impersonation tokens are short-lived', () => {
  assert.match(adminRoutes, /export const IMPERSONATION_TTL_SEC = 30 \* 60/)
  const ttl = 30 * 60
  assert.ok(ttl <= 3600, 'impersonation window is too long')

  const handler = adminRoutes.slice(adminRoutes.indexOf("admin.post('/users/:id/impersonate'"))
  const body = handler.slice(0, handler.indexOf("admin.post('/users/:id/notes'"))
  assert.match(body, /IMPERSONATION_TTL_SEC,\s*\)/, 'impersonation still mints a default-TTL (7 day) token')
  assert.match(body, /jti: newJti\(\)/, 'impersonation token cannot be revoked individually')
  assert.match(body, /tv: tv\?\.token_version \?\? 1/, 'impersonation token ignores token_version')
  assert.match(body, /expires_in: IMPERSONATION_TTL_SEC/, 'client is not told when the token expires')
})

check('signJwt still honours a caller-supplied ttl', () => {
  assert.match(authLib, /export async function signJwt\([\s\S]{0,200}ttlSec = 60 \* 60 \* 24 \* 7/)
  const now = 1_700_000_000
  const exp = (ttl) => now + ttl
  assert.equal(exp(30 * 60) - now, 1800, 'ttl arithmetic changed')
})

// -----------------------------------------------------------------------------
console.log(`\n${passed} hardening checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
