// Visual-parity guard: proves the mood screen renders the SAME pixels as the
// pre-fix implementation. Boots the ORIGINAL app.js (read straight from git)
// and the FIXED app.js side by side in jsdom, then compares the visual
// signature of every node — tag, class, text and all layout/paint styles.
//
// Only motion/behaviour may differ; design, layout, spacing and structure must
// be byte-identical in both the unselected and selected states.
//
// Run: node tests/mood-visual-parity.test.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const STATIC = join(REPO, 'public', 'static');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failures.push(name); console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const USER = { id: 1, name: 'Tester', email: 't@e.st', plan: 'free', onboarded: true, sessionLength: 5 };
const PLAN = { pattern: '4-7-8 breathing', inhale: 4, hold: 7, exhale: 8, minutes: 5, reason: 'Slow exhale to ease an anxious mind' };

function boot(appSource) {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta name="theme-color" content="#0B0F1A"></head>
     <body><div id="app"></div></body></html>`,
    { url: 'https://aura.test/#home', pretendToBeVisual: true, runScripts: 'outside-only' },
  );
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.navigator.vibrate = () => true;
  window.axios = {
    create: () => ({
      interceptors: { request: { use() {} } },
      get: (url) => Promise.resolve({ data: url === '/app/config' ? { flags: {} } : { user: USER } }),
      post: (url) => Promise.resolve({ data: url === '/app/moods' ? { suggestion: PLAN } : {} }),
      put: () => Promise.resolve({ data: {} }),
    }),
  };
  const store = new Map([['aura_user', JSON.stringify(USER)]]);
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    configurable: true,
  });
  window.eval(readFileSync(join(STATIC, 'aura-core.js'), 'utf8'));
  window.eval(appSource);
  return window;
}

// Every property that affects appearance/geometry. Motion-only properties
// (transition, animation, will-change) are deliberately excluded — those are
// exactly what the fix is allowed to change.
const VISUAL_PROPS = [
  'display', 'flex-direction', 'align-items', 'justify-content', 'flex', 'flex-shrink', 'gap',
  'grid-template-columns', 'padding', 'margin', 'margin-top', 'margin-bottom', 'width', 'height',
  'max-width', 'min-height', 'position', 'top', 'left', 'right', 'bottom', 'inset', 'border-radius',
  'border', 'background', 'box-shadow', 'color', 'font-size', 'font-weight', 'letter-spacing',
  'line-height', 'text-align', 'text-transform', 'opacity', 'transform', 'overflow', 'z-index',
];

function signature(el) {
  const style = VISUAL_PROPS
    .map((p) => `${p}:${el.style.getPropertyValue(p)}`)
    .filter((s) => !s.endsWith(':'))
    .join(';');
  return [
    el.tagName,
    `class=${el.className || ''}`,
    `id=${el.id || ''}`,
    `data-mood=${el.getAttribute('data-mood') || ''}`,
    `disabled=${el.hasAttribute('disabled')}`,
    `text=${[...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')}`,
    `style{${style}}`,
  ].join(' | ');
}

function tree(root) {
  const out = [];
  (function walk(el, depth) {
    out.push('  '.repeat(depth) + signature(el));
    [...el.children].forEach((c) => walk(c, depth + 1));
  })(root, 0);
  return out;
}

// ---------------------------------------------------------------------------
// box-shadow normalisation.
//
// The fix deliberately REORDERS the selected-card shadow list so its
// inset/outset pattern lines up positionally with the base .glass shadow —
// that positional match is precisely what makes box-shadow interpolable
// (CSS Transitions: shadow lists only interpolate pairwise when the `inset`
// keyword matches at every position; otherwise the value swaps discretely,
// which is the visible "snap").
//
// Reordering is pixel-neutral because CSS Backgrounds & Borders clips an
// outer shadow to OUTSIDE the border edge and an inner shadow to INSIDE it:
// the two sets of pixels are strictly disjoint, so their relative paint order
// cannot change any pixel. Reordering two shadows of the SAME kind, however,
// can change pixels — so we normalise by stable-sorting inset before outset
// and separately assert that order WITHIN each kind is untouched.
function splitShadows(v) {
  return v.split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
}
function normalizeShadow(v) {
  const parts = splitShadows(v);
  const ins = parts.filter((p) => /\binset\b/.test(p));
  const out = parts.filter((p) => !/\binset\b/.test(p));
  return { key: [...ins, ...out].join(', '), ins, out };
}
function normalizeSignature(line) {
  return line.replace(/box-shadow:([^;}]+)/, (_, v) => `box-shadow:${normalizeShadow(v).key}`);
}

function diff(a, b) {
  const lines = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] === undefined ? undefined : normalizeSignature(a[i]);
    const y = b[i] === undefined ? undefined : normalizeSignature(b[i]);
    if (x !== y) lines.push(`line ${i}:\n        OLD ${a[i] || '(none)'}\n        NEW ${b[i] || '(none)'}`);
  }
  return lines;
}

async function moodTree(win, selectMood) {
  win.AuraApp.routes.mood();
  await tick();
  const doc = win.document;
  if (selectMood) {
    doc.querySelector(`.mood-card[data-mood="${selectMood}"]`).click();
    await tick(); await tick(); await tick();
    await new Promise((r) => setTimeout(r, 700)); // let any crossfade finish
  }
  return {
    screen: tree(doc.querySelector('section.screen')),
    bgClass: doc.querySelector('.aura-bg').className,
    starCount: doc.querySelectorAll('.aura-stars').length,
  };
}

// Baseline is PINNED to the last commit before the jitter fix. It must not be
// `HEAD`: once the fix is committed HEAD becomes the fixed file, and the test
// would silently degrade into comparing the fix against itself (the "original
// glow snapped" assertion below would then flip to a false failure).
const BASELINE_COMMIT = 'bfe5db7'; // "Admin functionality pass" — pre-fix mood screen
const origSrc = execFileSync('git', ['show', `${BASELINE_COMMIT}:public/static/app.js`],
  { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });
const fixedSrc = readFileSync(join(STATIC, 'app.js'), 'utf8');

// Guard the guard: if the baseline ever stops being the pre-fix file, fail loudly
// rather than quietly passing a meaningless self-comparison.
if (/RENDER-ONCE screen/.test(origSrc)) {
  console.error(`\nBaseline ${BASELINE_COMMIT} already contains the fix — update BASELINE_COMMIT.`);
  process.exit(1);
}
if (!/function render\(\)[\s\S]{0,400}root\.innerHTML/.test(origSrc)) {
  console.error(`\nBaseline ${BASELINE_COMMIT} does not look like the pre-fix mood screen.`);
  process.exit(1);
}

console.log(`\nVisual parity: original (${BASELINE_COMMIT}) vs fixed mood screen`);

// ---- state A: initial, nothing selected
{
  const a = await moodTree(boot(origSrc), null);
  const b = await moodTree(boot(fixedSrc), null);
  const d = diff(a.screen, b.screen);
  check('initial render is visually identical', d.length === 0, d.slice(0, 6).join('\n      '));
  check('ambient background class identical', a.bgClass === b.bgClass, `${a.bgClass} vs ${b.bgClass}`);
  check('star layer identical', a.starCount === b.starCount);
  check('node count identical', a.screen.length === b.screen.length, `${a.screen.length} vs ${b.screen.length}`);
}

// ---- state B: a mood selected + suggestion shown
{
  const a = await moodTree(boot(origSrc), 'anxious');
  const b = await moodTree(boot(fixedSrc), 'anxious');
  const d = diff(a.screen, b.screen);
  check('selected state is visually identical', d.length === 0, d.slice(0, 6).join('\n      '));
  check('node count identical after selection', a.screen.length === b.screen.length,
    `${a.screen.length} vs ${b.screen.length}`);
  const glow = (t) => t.find((l) => l.includes('data-mood=anxious'));
  check('selected card glow renders identical pixels (inset/outset sets equal)',
    normalizeSignature(glow(a.screen)) === normalizeSignature(glow(b.screen)),
    `\n        OLD ${glow(a.screen)}\n        NEW ${glow(b.screen)}`);

  // The reorder is only pixel-safe if it swaps ACROSS kinds, never within one.
  const shadowOf = (line) => normalizeShadow(line.match(/box-shadow:([^;}]+)/)[1]);
  const sa = shadowOf(glow(a.screen));
  const sb = shadowOf(glow(b.screen));
  check('identical set of inset shadows, in the same relative order',
    JSON.stringify(sa.ins) === JSON.stringify(sb.ins), `${sa.ins} vs ${sb.ins}`);
  check('identical set of outset shadows, in the same relative order',
    JSON.stringify(sa.out) === JSON.stringify(sb.out), `${sa.out} vs ${sb.out}`);
  check('reorder crosses inset/outset only (disjoint pixels => pixel-neutral)',
    sa.ins.length === sb.ins.length && sa.out.length === sb.out.length &&
    splitShadows(glow(a.screen).match(/box-shadow:([^;}]+)/)[1]).length ===
    splitShadows(glow(b.screen).match(/box-shadow:([^;}]+)/)[1]).length);

  // And the whole point of the reorder: it must now positionally match the
  // base .glass shadow so the browser interpolates instead of snapping.
  const css = readFileSync(join(STATIC, 'aura.css'), 'utf8');
  const baseDark = splitShadows(css.match(/\.glass \{[\s\S]*?box-shadow:([^;]+);/)[1]);
  const fixedList = splitShadows(glow(b.screen).match(/box-shadow:([^;}]+)/)[1]);
  const origList = splitShadows(glow(a.screen).match(/box-shadow:([^;}]+)/)[1]);
  const pattern = (l) => l.map((s) => (/\binset\b/.test(s) ? 'inset' : 'outset')).join(',');
  check(`fixed glow matches base .glass inset pattern (${pattern(baseDark)}) => interpolates`,
    pattern(fixedList) === pattern(baseDark), `fixed=${pattern(fixedList)} base=${pattern(baseDark)}`);
  check('original glow did NOT match it => that was the snap/jitter',
    pattern(origList) !== pattern(baseDark), `orig=${pattern(origList)} base=${pattern(baseDark)}`);
  const sug = (t) => t.filter((l) => l.includes('AURA suggests') || l.includes('Slow exhale'));
  check('suggestion card content identical', JSON.stringify(sug(a.screen)) === JSON.stringify(sug(b.screen)),
    `\n        OLD ${sug(a.screen).join(' / ')}\n        NEW ${sug(b.screen).join(' / ')}`);
}

console.log(`\n${'-'.repeat(52)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  FAILED: ${f}`)); process.exit(1); }
console.log('Mood screen is visually identical to the original — only motion changed.\n');
