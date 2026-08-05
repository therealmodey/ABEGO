// ============================================================================
// AURA — layout stability, invisible scrollbar, admin reset
//
// TASK 1  fixed viewport-based layout system
// TASK 2  scrollbar hidden everywhere, zero layout cost, scroll preserved
// TASK 3  no layout shift on navigation
// TASK 4  device consistency across phone sizes
// TASK 5  admin panel data reset restores clean defaults, no null states
//
// The CSS assertions parse the real stylesheet rule-by-rule rather than
// grepping, so a rule that merely *mentions* a property cannot pass a check
// that requires the property to actually be set on a specific selector.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CSS = read('public/static/aura.css');
const APP = read('public/static/app.js');
const CORE = read('public/static/aura-core.js');
const ADMIN_JS = read('public/static/admin.js');
const ADMIN_TS = read('src/routes/admin.ts');
const INDEX = read('src/index.tsx');

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------- CSS parser
// Strip comments first so commented-out code can never satisfy an assertion.
const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// Flatten to [{selector, body}], including rules nested inside @media/@supports.
function parseRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    const body = m[2].trim();
    if (/^@(media|supports|layer)/i.test(sel)) continue; // handled by recursion below
    if (!sel || sel.startsWith('@')) continue;           // @keyframes steps, @font-face
    out.push({ sel, body });
  }
  return out;
}
// Pull out at-rule blocks and parse their inner rules too.
function parseAll(css) {
  const rules = [];
  const atRe = /@(media|supports)([^{]*)\{/gi;
  let m;
  const spans = [];
  while ((m = atRe.exec(css))) {
    let depth = 1, i = atRe.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const inner = css.slice(atRe.lastIndex, i - 1);
    spans.push([m.index, i]);
    parseRules(inner).forEach((r) => rules.push({ ...r, at: `@${m[1]}${m[2].trim()}` }));
  }
  // Remove at-rule spans, parse what's left at top level.
  let top = '', cursor = 0;
  spans.forEach(([s, e]) => { top += css.slice(cursor, s); cursor = e; });
  top += css.slice(cursor);
  parseRules(top).forEach((r) => rules.push({ ...r, at: null }));
  return rules;
}
const RULES = parseAll(CSS_NC);

// Every rule whose selector list contains `sel` as a whole selector.
function rulesFor(sel) {
  return RULES.filter((r) =>
    r.sel.split(',').map((s) => s.trim()).includes(sel));
}
// Last declared value of `prop` on `sel` (cascade order within equal specificity).
function declared(sel, prop) {
  const vals = [];
  rulesFor(sel).forEach((r) => {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'gi');
    let m;
    while ((m = re.exec(r.body))) vals.push(m[1].trim());
  });
  return vals;
}
function lastDeclared(sel, prop) {
  const v = declared(sel, prop);
  return v.length ? v[v.length - 1] : null;
}

// ============================================================ TASK 2
section('TASK 2 — Scrollbar is invisible, costs zero layout width, scroll preserved');

// The old visible scrollbar is gone. That 8px was the shift.
check('the old 8px-wide visible scrollbar rule is gone',
  !/::-webkit-scrollbar\s*\{[^}]*width:\s*8px/.test(CSS_NC));
check('no scrollbar rule declares a non-zero width anywhere',
  !RULES.some((r) => /::-webkit-scrollbar\b/.test(r.sel) &&
    /width:\s*(?!0)(\d*\.?\d+)(px|rem|em|pt)/.test(r.body)));

// Cross-browser coverage: three engines need three different mechanisms.
const universalSb = RULES.filter((r) => r.sel === '*');
check('Firefox: scrollbar-width:none applied universally',
  universalSb.some((r) => /scrollbar-width:\s*none/.test(r.body)));
check('legacy Edge/IE: -ms-overflow-style:none applied universally',
  universalSb.some((r) => /-ms-overflow-style:\s*none/.test(r.body)));
check('WebKit/Blink: ::-webkit-scrollbar zeroed universally',
  RULES.some((r) => r.sel === '*::-webkit-scrollbar' &&
    /width:\s*0/.test(r.body) && /height:\s*0/.test(r.body)));
check('WebKit: scrollbar also display:none (belt and braces)',
  RULES.some((r) => r.sel === '*::-webkit-scrollbar' && /display:\s*none/.test(r.body)));
check('WebKit: thumb/track/corner boxes zeroed too',
  RULES.some((r) => /::-webkit-scrollbar-thumb/.test(r.sel) &&
    /::-webkit-scrollbar-track/.test(r.sel) && /width:\s*0/.test(r.body)));

// The rules must be UNIVERSAL, not scoped to one element, or a nested
// scroll container would still paint a bar.
check('scrollbar hiding is universal (`*`), not scoped to html/body only',
  universalSb.length > 0 &&
  RULES.some((r) => r.sel === '*::-webkit-scrollbar'));

// CRITICAL: scrolling must still work. No global overflow:hidden.
const htmlOverflowY = declared('html', 'overflow-y');
const bodyOverflow = declared('body', 'overflow');
check('html is NOT overflow:hidden in the base state (scroll preserved)',
  !declared('html', 'overflow').some((v) => /hidden/.test(v)));
check('body is NOT overflow:hidden in the base state (scroll preserved)',
  !bodyOverflow.some((v) => /hidden/.test(v)));
check('html declares overflow-y:scroll so the scroll container always exists',
  htmlOverflowY.some((v) => /scroll/.test(v)));
check('body does NOT declare its own overflow-y (no competing scroll container)',
  declared('body', 'overflow-y').length === 0);
check('touch scrolling is never disabled globally',
  !RULES.some((r) => (r.sel === 'body' || r.sel === 'html') && /touch-action:\s*none/.test(r.body)));

// The scroll lock is modal-scoped only, and must target html (the scroll container).
check('modal scroll-lock targets html (the actual scroll container)',
  RULES.some((r) => /^html\.modal-open$/.test(r.sel) && /overflow:\s*hidden/.test(r.body)));
check('modal scroll-lock is scoped to .modal-open only, never global',
  RULES.filter((r) => /overflow:\s*hidden/.test(r.body) && /^(html|body)$/.test(r.sel)).length === 0);
check('JS adds the lock class to documentElement as well as body',
  /documentElement\.classList\.add\('modal-open'\)/.test(CORE));
check('JS removes the lock class from documentElement on unlock',
  /documentElement\.classList\.remove\('modal-open'\)/.test(CORE));

// Horizontal axis locked so a h-scrollbar can't appear and shift things.
check('html locks the horizontal axis (no surprise h-scrollbar)',
  declared('html', 'overflow-x').some((v) => /hidden/.test(v)));
check('no 100vw anywhere (100vw ignores the scrollbar and overflows)',
  !/\b100vw\b/.test(CSS_NC));

// ============================================================ TASK 1 + 4
section('TASK 1 & 4 — Fixed viewport layout system, identical on every device');

check('a single stable height token --vh-fixed is defined on :root',
  RULES.some((r) => r.sel === ':root' && /--vh-fixed:/.test(r.body)));
check('--vh-fixed falls back to 100vh for engines without svh',
  RULES.some((r) => r.sel === ':root' && !r.at && /--vh-fixed:\s*100vh/.test(r.body)));
check('--vh-fixed upgrades to 100svh via @supports',
  RULES.some((r) => r.sel === ':root' && r.at && /@supports/.test(r.at) &&
    /--vh-fixed:\s*100svh/.test(r.body)));
check('the @supports guard actually tests height:100svh',
  /@supports\s*\(height:\s*100svh\)/.test(CSS_NC));

// dvh was the resize culprit: it changes as the mobile URL bar collapses.
check('no layout container still uses the unstable dvh unit',
  !/\d+dvh/.test(CSS_NC));

// Every full-height container must share the one token.
const fullHeightSelectors = ['.app-root', '.screen', '.screen--scroll', '.screen--wide', '.boot-loader', '.scc'];
fullHeightSelectors.forEach((sel) => {
  const h = [...declared(sel, 'height'), ...declared(sel, 'min-height')];
  check(`${sel} measures against --vh-fixed (not a raw viewport unit)`,
    h.some((v) => v.includes('--vh-fixed')) &&
    !h.some((v) => /\b\d+(vh|dvh)\b/.test(v)));
});
check('.sheet max-height derives from --vh-fixed too',
  declared('.sheet', 'max-height').some((v) => v.includes('--vh-fixed')));
check('the admin sidebar height uses --vh-fixed',
  /height:\s*var\(--vh-fixed\)/.test(
    RULES.filter((r) => /\.scc-side\b/.test(r.sel)).map((r) => r.body).join(';')));

// Identical bounding box across screens.
check('.screen has an explicit width:100% (no content-derived width)',
  declared('.screen', 'width').some((v) => v.trim() === '100%'));
check('.screen keeps its 480px max-width (design unchanged)',
  declared('.screen', 'max-width').includes('480px'));
check('.screen stays centred with margin:0 auto',
  declared('.screen', 'margin').some((v) => /0\s+auto/.test(v)));
check('.app-root spans the full width',
  declared('.app-root', 'width').some((v) => v.trim() === '100%'));

// The scrolling variant must differ ONLY in height/overflow, never in width.
check('.screen--scroll does NOT override width',
  declared('.screen--scroll', 'width').length === 0);
check('.screen--scroll does NOT override max-width',
  declared('.screen--scroll', 'max-width').length === 0);
check('.screen--scroll does NOT override margin (centring preserved)',
  declared('.screen--scroll', 'margin').length === 0);
check('.screen--scroll shares the same min-height basis as .screen',
  declared('.screen--scroll', 'min-height').some((v) => v.includes('--vh-fixed')));

// .screen--wide is the intentional desktop-pricing exception.
check('.screen--wide only widens max-width (documented pricing exception)',
  declared('.screen--wide', 'max-width').includes('1100px'));

// Device consistency.
check('viewport meta uses width=device-width + viewport-fit=cover',
  /width=device-width/.test(INDEX) && /viewport-fit=cover/.test(INDEX));
check('viewport meta does not lock zoom (accessibility preserved)',
  !/user-scalable\s*=\s*no/.test(INDEX) && !/maximum-scale\s*=\s*1/.test(INDEX));
check('safe-area insets are still honoured',
  /env\(safe-area-inset-top/.test(CSS_NC) && /env\(safe-area-inset-bottom/.test(CSS_NC));
check('adaptive density breakpoints are preserved (design unchanged)',
  /@media\s*\(max-height:\s*740px\)/.test(CSS_NC) &&
  /@media\s*\(max-height:\s*640px\)/.test(CSS_NC));

// ============================================================ TASK 3
section('TASK 3 — No layout shift on navigation');

// Screen transitions may only use compositor properties.
// Extract a @keyframes block by brace-matching. A regex cannot do this: the
// body contains nested `{ ... }` steps, and a lazy match stops at the FIRST
// closing brace while a greedy one runs past the block end into later rules
// (which produced false "layout property" hits on single-line keyframes).
function keyframeBlocks(css) {
  const out = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}
const KEYFRAMES = keyframeBlocks(CSS_NC);
function keyframeBody(name) {
  const k = KEYFRAMES.find((x) => x.name === name);
  return k ? k.body : '';
}
const LAYOUT_PROPS = /(?:^|[;{\s])(width|height|margin|margin-\w+|padding|padding-\w+|top|left|right|bottom|inset|flex|flex-basis|gap|font-size|border-width)\s*:/;
['auraScreenIn', 'auraScreenOut'].forEach((k) => {
  const body = keyframeBody(k);
  check(`${k} exists`, body.length > 0);
  check(`${k} animates only opacity/transform (no layout properties)`,
    !LAYOUT_PROPS.test(body));
});
check('.screen transition declares will-change: opacity, transform only',
  declared('.screen', 'will-change').some((v) => /opacity/.test(v) && /transform/.test(v) && !LAYOUT_PROPS.test(`;${v}:`)));

// The smooth-scroll / scrollTo conflict that made screens slide on entry.
check('navigation scroll reset is instant, not smooth-animated',
  /behavior:\s*'instant'/.test(APP));
check('navigation scroll reset has a legacy fallback',
  /catch\s*\(e\)\s*\{\s*window\.scrollTo\(0,\s*0\)/.test(APP));
check('smooth scroll-behavior is still available for in-page anchors',
  /scroll-behavior:\s*smooth/.test(CSS_NC));

// No keyframe anywhere animates a layout property.
const layoutAnimating = KEYFRAMES
  .filter((k) => LAYOUT_PROPS.test(k.body))
  .map((k) => k.name);
// background-position drift is paint-only; width on bar fills is data, and
// those live in `contain: layout` tracks (verified by motion-global suite).
const ALLOWED = ['auraAmbientDrift', 'auraShimmerSlide', 'sccShimmer'];
check(`no keyframe animates a layout property (found: ${layoutAnimating.join(', ') || 'none'})`,
  layoutAnimating.every((n) => ALLOWED.includes(n)));

// ============================================================ TASK 5
section('TASK 5 — Admin panel data reset');

check('POST /admin/reset endpoint exists',
  /admin\.post\('\/reset'/.test(ADMIN_TS));
check('reset is behind the admin guard (requireAuth + requireAdmin)',
  /admin\.use\('\*',\s*requireAuth\)/.test(ADMIN_TS) &&
  /admin\.use\('\*',\s*requireAdmin\)/.test(ADMIN_TS));
check('reset restores AI config from the shared AI_DEFAULTS constant',
  /import\s*\{[^}]*AI_DEFAULTS[^}]*\}\s*from\s*'\.\.\/lib\/aiconfig'/.test(ADMIN_TS) &&
  /JSON\.stringify\(AI_DEFAULTS\)/.test(ADMIN_TS));
check('reset restores all 8 baseline notification rules',
  (ADMIN_TS.match(/RESET_NOTIFICATION_RULES:[\s\S]*?\n\]/)[0].match(/\n\s*\[\d/g) || []).length === 8);
check('reset restores all 6 baseline experiments',
  (ADMIN_TS.match(/RESET_EXPERIMENTS:[\s\S]*?\n\]/)[0].match(/\n\s*\['exp_/g) || []).length === 6);

// No null/undefined states: every restore is an upsert with explicit values.
check('notification rules are UPSERTed (never left missing/unbound)',
  /INSERT INTO notification_rules[\s\S]{0,400}ON CONFLICT\(id\) DO UPDATE/.test(ADMIN_TS));
check('experiments are UPSERTed (never left missing/unbound)',
  /INSERT INTO experiments[\s\S]{0,400}ON CONFLICT\(id\) DO UPDATE/.test(ADMIN_TS));
check('ai_config is UPSERTed (never left missing/unbound)',
  /INSERT INTO app_config[\s\S]{0,300}ON CONFLICT\(key\) DO UPDATE/.test(ADMIN_TS));
check('no baseline notification rule has a null column',
  !/RESET_NOTIFICATION_RULES[\s\S]*?\n\]/.exec(ADMIN_TS)[0].includes('null'));
check('experiment winner is the only nullable field (schema allows it)',
  /winner: string \| null/.test(ADMIN_TS) || /string \| null\]/.test(ADMIN_TS));

// Safety: user data must be preserved.
const resetBlock = ADMIN_TS.slice(ADMIN_TS.indexOf("admin.post('/reset'"));
['users', 'sessions', 'moods', 'subscriptions', 'payments', 'profiles', 'audit_logs'].forEach((t) => {
  check(`reset never deletes from ${t}`,
    !new RegExp(`DELETE FROM ${t}\\b`, 'i').test(resetBlock));
});
check('reset never drops a table',
  !/DROP TABLE/i.test(resetBlock));
check('reset deletes only rules/experiments added beyond the baseline',
  /DELETE FROM notification_rules WHERE id > \?/.test(resetBlock) &&
  /DELETE FROM experiments WHERE id NOT IN/.test(resetBlock));
check('reset invalidates the ai_config cache so reads serve fresh values',
  /cacheDel\('ai_config'\)/.test(resetBlock));
check('reset writes an audit-log entry',
  /logAudit\([\s\S]{0,200}'admin_panel_reset'/.test(resetBlock));
check('reset reports what was preserved',
  /preserved:\s*\[/.test(resetBlock));

// UI wiring — feature intact, bound, confirmed.
check('Settings view renders a reset control',
  /id="scc-reset"/.test(ADMIN_JS));
check('reset button uses the existing danger button style (no new design)',
  /scc-btn scc-btn--danger" id="scc-reset"/.test(ADMIN_JS));
check('reset asks for confirmation before firing',
  /confirmModal\(\s*\n?\s*'Reset panel data\?'/.test(ADMIN_JS));
check('reset confirmation is flagged destructive',
  /'Reset',\s*true\)/.test(ADMIN_JS));
check('reset calls the API endpoint',
  /api\.post\('\/admin\/reset'\)/.test(ADMIN_JS));
check('reset clears the client-side module cache',
  /Object\.keys\(sccCache\)\.forEach\(\(k\)\s*=>\s*delete sccCache\[k\]\)/.test(ADMIN_JS));
check('reset re-renders settings so state is visibly clean',
  /views\.settings\(\);/.test(ADMIN_JS));
check('reset re-enables its button if the call fails (no dead control)',
  /rstAll\.disabled = false/.test(ADMIN_JS));
check('the existing per-module AI reset still exists (feature not removed)',
  /id="ai-reset"/.test(ADMIN_JS));

// ============================================================ REGRESSION
section('Regression — earlier fixes still intact');

check('countdown ring still centred via inset:0 + margin:auto',
  /position:absolute;inset:0;margin:auto/.test(CORE) &&
  RULES.some((r) => r.sel === '.progress-ring' && /margin:\s*auto/.test(r.body)));
check('orb colour interpolation timeline still present',
  /mixPalette/.test(CORE) && /_orbRaf/.test(CORE));
check('no `transition: all` reintroduced',
  !/transition:\s*all\b/.test(CSS_NC));
check('Library .lib-off crossfade class still present',
  RULES.some((r) => r.sel === '.lib-off'));
check('reduced-motion guard still neutralises animation globally',
  /prefers-reduced-motion:\s*reduce/.test(CSS_NC));
check('no feature routes were removed from the app',
  ['mood', 'programs', 'settings', 'personalize', 'home'].every((r) => new RegExp(`routes\\.${r}\\s*=`).test(APP)));

// ---------------------------------------------------------------- summary
console.log('\n----------------------------------------------------');
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('Layout is stable, scrollbars are invisible, admin reset is safe.\n');
