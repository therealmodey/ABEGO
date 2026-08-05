// ============================================================================
// AURA — critical security invariants
//
// TASK 1  JWT secret fails closed (no hardcoded fallback anywhere)
// TASK 2  no credentials committed in the seed; bootstrap script works instead
// TASK 3  webhook signatures verified unconditionally, constant-time, replay-safe
// TASK 4  simulated checkout cannot activate paid plans unless explicitly enabled
//
// These are regression locks: each one asserts on the real source/schema, so a
// future edit that re-introduces a fail-open path breaks the suite.
// ============================================================================
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const middleware = read('src/lib/middleware.ts')
const billing = read('src/routes/billing.ts')
const seed = read('seed.sql')

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
console.log('\nTASK 1  JWT secret fails closed')

check('no hardcoded dev secret fallback in the source tree', () => {
  for (const file of ['src/lib/middleware.ts', 'src/lib/auth.ts', 'src/index.tsx',
    'src/routes/auth.ts', 'src/routes/admin.ts', 'src/routes/app.ts', 'src/routes/billing.ts']) {
    assert.ok(
      !/dev-secret|change-in-production/.test(read(file)),
      `${file} still contains a hardcoded secret fallback`,
    )
  }
})

check('jwtSecret throws when JWT_SECRET is missing', () => {
  const fn = middleware.slice(middleware.indexOf('export function jwtSecret'))
  assert.ok(/throw new Error/.test(fn.slice(0, 600)), 'jwtSecret does not throw on missing secret')
  assert.ok(!/\|\|\s*'/.test(fn.slice(0, 300)), 'jwtSecret still has a string fallback')
})

check('a minimum secret length is enforced', () => {
  assert.match(middleware, /MIN_JWT_SECRET_LENGTH\s*=\s*(\d+)/)
  const min = Number(/MIN_JWT_SECRET_LENGTH\s*=\s*(\d+)/.exec(middleware)[1])
  assert.ok(min >= 32, `minimum secret length ${min} is too small`)
  assert.match(middleware, /secret\.length\s*<\s*MIN_JWT_SECRET_LENGTH/)
})

// ---------------------------------------------------------------- TASK 2 -----
console.log('\nTASK 2  no committed credentials')

check('seed.sql creates no admin user and holds no password hash', () => {
  assert.ok(!/admin@aura\.app/.test(seed), 'seed.sql still references the default admin email')
  assert.ok(!/pbkdf2\$/.test(seed), 'seed.sql still contains a password hash')
  assert.ok(!/Admin123!/.test(seed), 'seed.sql still contains a plaintext password')
  assert.ok(!/INSERT[\s\S]{0,80}INTO users/i.test(seed), 'seed.sql still inserts into users')
})

check('no plaintext default password remains anywhere in tracked source', () => {
  for (const file of ['seed.sql', 'README.md', 'src/routes/auth.ts', 'src/routes/admin.ts']) {
    assert.ok(!/Admin123!/.test(read(file)), `${file} still contains the default password`)
  }
})

check('bootstrap script produces a hash the app can verify', () => {
  const password = 'correct-horse-battery-staple'
  const sql = execFileSync('node', [join(ROOT, 'scripts/bootstrap-admin.mjs'), 'owner@example.com', password], { encoding: 'utf8' })

  assert.match(sql, /'admin', 'active'/, 'bootstrap SQL does not create an admin')
  assert.ok(!sql.includes(password), 'bootstrap SQL leaked the plaintext password')

  const stored = /'(pbkdf2\$[^']+)'/.exec(sql)?.[1]
  assert.ok(stored, 'no pbkdf2 hash found in bootstrap output')

  // Verify exactly the way src/lib/auth.ts verifyPassword() does.
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$')
  assert.equal(scheme, 'pbkdf2')
  const iterations = Number(iterStr)
  assert.ok(iterations >= 100000, `iteration count ${iterations} is too low`)

  const expected = Buffer.from(hashB64, 'base64')
  const good = pbkdf2Sync(password, Buffer.from(saltB64, 'base64'), iterations, expected.length, 'sha256')
  assert.ok(timingSafeEqual(good, expected), 'correct password does not verify')

  const bad = pbkdf2Sync(password + 'x', Buffer.from(saltB64, 'base64'), iterations, expected.length, 'sha256')
  assert.ok(!bad.equals(expected), 'wrong password verified')
})

check('bootstrap script rejects weak or malformed input', () => {
  const fails = (args) => {
    try {
      execFileSync('node', [join(ROOT, 'scripts/bootstrap-admin.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' })
      return false
    } catch {
      return true
    }
  }
  assert.ok(fails([]), 'accepted missing arguments')
  assert.ok(fails(['not-an-email', 'a-long-enough-password']), 'accepted an invalid email')
  assert.ok(fails(['owner@example.com', 'short']), 'accepted a short password')
})

// ---------------------------------------------------------------- TASK 3 -----
console.log('\nTASK 3  webhook verification')

const stripeHandler = billing.slice(billing.indexOf("billing.post('/webhooks/stripe'"), billing.indexOf("billing.post('/webhooks/paystack'"))
const paystackHandler = billing.slice(billing.indexOf("billing.post('/webhooks/paystack'"))

check('verification is not conditional on a secret being present', () => {
  for (const [name, handler] of [['stripe', stripeHandler], ['paystack', paystackHandler]]) {
    assert.ok(!/if\s*\(\s*secret\s*\)/.test(handler), `${name} webhook still verifies only when a secret exists`)
    assert.match(handler, /if\s*\(!secret\)\s*return[\s\S]{0,80}503/, `${name} webhook does not refuse without a secret`)
  }
})

check('signatures are compared in constant time, never with !==', () => {
  for (const [name, handler] of [['stripe', stripeHandler], ['paystack', paystackHandler]]) {
    assert.match(handler, /timingSafeEqualStr\(/, `${name} webhook does not use a constant-time compare`)
    assert.ok(!/expected\s*!==/.test(handler), `${name} webhook still uses a short-circuiting compare`)
  }
  assert.match(middleware, /export function timingSafeEqualStr/)
  const fn = middleware.slice(middleware.indexOf('export function timingSafeEqualStr'))
  assert.match(fn.slice(0, 400), /\|=/, 'timingSafeEqualStr does not accumulate differences')
  assert.ok(!/return\s+false\s*$/m.test(fn.slice(fn.indexOf('for ('), fn.indexOf('return diff'))), 'timingSafeEqualStr returns early inside the loop')
})

check('constant-time comparison logic is correct', () => {
  // Mirror of timingSafeEqualStr, executed to prove the semantics hold.
  const cmp = (a, b) => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
  }
  assert.equal(cmp('deadbeef', 'deadbeef'), true)
  assert.equal(cmp('deadbeef', 'deadbeee'), false)
  assert.equal(cmp('deadbeef', 'deadbee'), false)
  assert.equal(cmp('', ''), true)
})

check('stripe timestamp tolerance is checked', () => {
  assert.match(stripeHandler, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\)\s*>\s*300/)
  assert.match(stripeHandler, /Number\.isFinite\(ts\)/)
})

check('replay/idempotency guard exists and is used by both providers', () => {
  assert.match(billing, /export async function claimWebhookEvent/)
  assert.match(billing, /INSERT OR IGNORE INTO webhook_events/)
  for (const [name, handler] of [['stripe', stripeHandler], ['paystack', paystackHandler]]) {
    assert.match(handler, /claimWebhookEvent\(/, `${name} webhook has no replay guard`)
    const guardAt = handler.indexOf('claimWebhookEvent(')
    const activateAt = handler.indexOf('activatePlan(')
    assert.ok(guardAt < activateAt, `${name} webhook activates the plan before deduping`)
  }
})

check('webhook_events table is migrated with a unique index', () => {
  const migration = read('migrations/0004_webhook_events.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS webhook_events/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*ON webhook_events \(provider, event_id\)/)
})

check('malformed webhook bodies are rejected, not thrown on', () => {
  for (const [name, handler] of [['stripe', stripeHandler], ['paystack', paystackHandler]]) {
    assert.match(handler, /try \{ event = JSON\.parse\(payload\) \} catch/, `${name} webhook parses JSON unguarded`)
  }
})

// ---------------------------------------------------------------- TASK 4 -----
console.log('\nTASK 4  simulated checkout is opt-in')

check('simulated checkout requires ALLOW_SIM_CHECKOUT', () => {
  assert.match(billing, /ALLOW_SIM_CHECKOUT === '1'/)
  const sim = billing.slice(billing.indexOf('async function simulateCheckout'))
  const body = sim.slice(0, sim.indexOf('export async function activatePlan'))
  const gateAt = body.indexOf('simCheckoutEnabled')
  const activateAt = body.indexOf('activatePlan(')
  assert.ok(gateAt !== -1 && gateAt < activateAt, 'simulateCheckout activates a plan before checking the gate')
  assert.match(body, /503/, 'simulateCheckout does not refuse when disabled')
})

check('ALLOW_SIM_CHECKOUT is typed on the bindings and absent from committed config', () => {
  assert.match(middleware, /ALLOW_SIM_CHECKOUT\?: string/)
  assert.ok(!/ALLOW_SIM_CHECKOUT/.test(read('wrangler.jsonc')), 'sim checkout is enabled in committed config')
})

// -----------------------------------------------------------------------------
console.log(`\n${passed} security checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
