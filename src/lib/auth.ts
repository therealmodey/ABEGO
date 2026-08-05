// Auth core: PBKDF2 password hashing + HS256 JWT — Web Crypto only (Workers-safe)

const enc = new TextEncoder()

// ---------- base64 helpers ----------
export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
export function b64url(buf: ArrayBuffer | Uint8Array): string {
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function fromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return fromB64(s)
}

// ---------- password hashing (PBKDF2-SHA256, 100k iterations) ----------
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  )
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'pbkdf2') return false
    const salt = fromB64(saltB64)
    const iterations = parseInt(iterStr, 10)
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, key, 256
    )
    const a = new Uint8Array(bits), b = fromB64(hashB64)
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i] // constant-time compare
    return diff === 0
  } catch { return false }
}

// ---------- JWT (HS256) ----------
export interface JwtPayload {
  sub: number          // user id
  email: string
  role: 'user' | 'admin'
  plan: 'free' | 'pro' | 'premium'
  jti?: string         // token id — revoked individually on logout
  tv?: number          // users.token_version snapshot — bump revokes all tokens
  imp_by?: number      // admin id, when this token was minted by impersonation
  iat: number
  exp: number
}

// Every token gets an id so a single session can be revoked without signing the
// user out of their other devices.
export function newJti(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)))
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSec = 60 * 60 * 24 * 7): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + ttlSec }
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(full)))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const [h, b, s] = token.split('.')
    if (!h || !b || !s) return null
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(s) as unknown as BufferSource, enc.encode(`${h}.${b}`))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(b))) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}
