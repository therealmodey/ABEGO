// Copy-style invariants.
//
// Em dashes are not used in user-facing copy. They are the single most obvious
// tell of machine-written product text, and the app's voice is short sentences.
// This suite fails on any em dash inside a string literal that ships to a user.
//
// Two things are deliberately NOT flagged:
//   1. Source comments. They are never rendered; rewriting them would be a
//      diff with no product effect.
//   2. The standalone "no value" glyph, i.e. a literal whose entire content is
//      an em dash (empty table cells, missing metrics). That is typography,
//      not prose, and it is the app's existing convention for "no data".
//
// The check strips comments first, so a comment that merely mentions an em dash
// cannot fail the suite and cannot be used to smuggle copy past it either.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const EM = '\u2014'

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('  ok   ' + name) }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')) }
}

/** Remove // line comments, /* block comments *​/ and SQL -- comments. */
function stripComments(src) {
  let out = ''
  let i = 0
  let quote = null      // active string/template delimiter
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (quote) {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
      if (c === quote) quote = null
      out += c; i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '-' && d === '-') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  return out
}

/**
 * Em-dash occurrences in `src` that are real copy: an em dash still inside a
 * string literal once comments and standalone "no data" glyphs are removed.
 */
function copyEmDashes(src) {
  // Blank out the standalone glyph first, including where it is nested inside a
  // larger template literal (`${value || '—'}`) or a table-row array. Without
  // this the enclosing template would be judged as a whole and every empty-cell
  // fallback would read as prose.
  const stripped = stripComments(src).replace(/(['"`])\s*\u2014\s*\1/g, "$1$1")
  const hits = []
  // Every quoted run, including template literals with ${...} interpolation.
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  let m
  while ((m = literal.exec(stripped))) {
    const body = m[1] ?? m[2] ?? m[3] ?? ''
    if (!body.includes(EM)) continue
    // A literal that is only the placeholder glyph is allowed.
    if (body.trim() === EM) continue
    const line = stripped.slice(0, m.index).split('\n').length
    hits.push(`line ${line}: ${body.trim().slice(0, 90)}`)
  }
  return hits
}

function filesIn(dir, exts) {
  const out = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...filesIn(join(dir, e.name), exts))
    else if (exts.some((x) => e.name.endsWith(x))) out.push(join(dir, e.name))
  }
  return out
}

console.log('\nCopy style: no em dashes in user-facing copy\n')

const targets = [...filesIn('src', ['.ts', '.tsx']), ...filesIn('public/static', ['.js']), 'migrations/0003_admin_controls.sql']

for (const rel of targets) {
  const hits = copyEmDashes(readFileSync(join(ROOT, rel), 'utf8'))
  check(`${rel} has no em dash in shipped copy`, hits.length === 0, hits.join('\n       '))
}

// The placeholder convention itself must survive: these files still use the
// standalone glyph for missing data, so a future blanket find-and-replace that
// strips it (leaving blank cells) fails here.
for (const rel of ['public/static/admin.js', 'public/static/billing.js']) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  check(`${rel} keeps the standalone no-data glyph`, new RegExp(`['"\`]\\s*${EM}\\s*['"\`]`).test(src))
}

// Sanity-check the detector, so a broken stripper cannot silently pass everything.
check('detector ignores comments', copyEmDashes(`// a — comment\nconst x = 1`).length === 0)
check('detector ignores the placeholder glyph', copyEmDashes(`const x = '—'`).length === 0)
check('detector catches copy', copyEmDashes(`const x = 'Saved — live now'`).length === 1)
check('detector catches copy in templates', copyEmDashes('const x = `${a} — done`').length === 1)

console.log(`\n${pass} copy-style checks passed`)
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ` + failures.join('\n  '))
  process.exit(1)
}
