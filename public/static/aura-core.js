// AURA core — shared API client, orb renderer, UI atoms
(function () {
  'use strict';

  // ---------- API client ----------
  const api = axios.create({ baseURL: '/api', withCredentials: true });
  api.interceptors.request.use((cfg) => {
    const t = localStorage.getItem('aura_token');
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });

  // ---------- State helpers ----------
  const AuraState = {
    get user() { try { return JSON.parse(localStorage.getItem('aura_user') || 'null'); } catch { return null; } },
    set user(u) { u ? localStorage.setItem('aura_user', JSON.stringify(u)) : localStorage.removeItem('aura_user'); },
    setToken(t) { t ? localStorage.setItem('aura_token', t) : localStorage.removeItem('aura_token'); },
    clear() { localStorage.removeItem('aura_user'); localStorage.removeItem('aura_token'); },
  };

  // ---------- Theme engine (dark default / light "luminous environment") ----------
  // Applied at parse time (script is in <body>, before first paint of app UI)
  // so there is never a wrong-theme flash. Switch crossfades ~250ms.
  const Theme = {
    get mode() { return localStorage.getItem('aura_theme') === 'light' ? 'light' : 'dark'; },
    apply(mode) {
      document.documentElement.setAttribute('data-theme', mode === 'light' ? 'light' : 'dark');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', mode === 'light' ? '#F4F6FB' : '#0B0F1A');
    },
    set(mode, animate) {
      localStorage.setItem('aura_theme', mode === 'light' ? 'light' : 'dark');
      if (!animate) return Theme.apply(mode);
      // Smooth global switch: fade app out, swap tokens, fade back in (~250ms)
      const html = document.documentElement;
      html.classList.add('theme-switching');
      setTimeout(() => {
        Theme.apply(mode);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          html.classList.remove('theme-switching');
        }));
      }, 130);
    },
  };
  Theme.apply(Theme.mode);

  // ---------- Sensory prefs (functional, not visual-only) ----------
  // Session code consults these before vibrating / playing tones; the theme
  // intensity slider drives ambient background opacity; glow steps drive
  // orb aura via html[data-glow].
  const Prefs = {
    _read() { try { return JSON.parse(localStorage.getItem('aura_prefs') || '{}'); } catch { return {}; } },
    get all() { return Object.assign({ sound: true, haptics: true, glow: 'medium', reminders: false, adaptive: true, theme: 72, mode: Theme.mode }, this._read()); },
    set(patch) {
      const next = Object.assign(this._read(), patch);
      localStorage.setItem('aura_prefs', JSON.stringify(next));
      Prefs.applySideEffects(next);
      return next;
    },
    applySideEffects(p) {
      p = p || this.all;
      if (p.glow) document.documentElement.setAttribute('data-glow', p.glow);
      if (typeof p.theme === 'number') {
        document.documentElement.style.setProperty('--bg-vis', String(0.35 + (p.theme / 100) * 0.65));
      }
      // Account-level appearance follows the user across devices
      if (p.mode && p.mode !== Theme.mode) Theme.set(p.mode, false);
    },
  };
  Prefs.applySideEffects();

  // Haptic tick that respects the user's haptics preference
  function haptic(ms) {
    if (!Prefs.all.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (e) {} }
  }

  // ---------- Breathing tone engine (WebAudio, gated by the sound pref) ----------
  // Soft sine swells per phase — inhale rises, hold sustains, exhale falls.
  // Lazy-initialized on first user gesture (autoplay policy safe).
  const Tone = (() => {
    let ctx = null, master = null;
    const FREQ = { inhale: 220, hold: 262, exhale: 174, idle: 196 };
    function ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      return true;
    }
    function phase(name, durSec) {
      if (!Prefs.all.sound || !ensure()) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(FREQ[name] || 196, now);
      // gentle detune drift for an organic feel
      osc.detune.setValueAtTime(-6, now);
      osc.detune.linearRampToValueAtTime(6, now + durSec);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.05, now + Math.min(0.9, durSec * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + durSec + 0.05);
    }
    function stop() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
    return { phase, stop };
  })();

  // ---------- Phase colors (design tokens) ----------
  const PHASE = {
    inhale: { a: '#60A5FA', b: '#22D3EE', glow: 'rgba(96,165,250,0.65)', label: 'Breathe in' },
    hold:   { a: '#A78BFA', b: '#7C3AED', glow: 'rgba(167,139,250,0.65)', label: 'Hold' },
    exhale: { a: '#34D399', b: '#22D3EE', glow: 'rgba(52,211,153,0.55)', label: 'Breathe out' },
    idle:   { a: '#7C3AED', b: '#22D3EE', glow: 'rgba(124,58,237,0.6)', label: '' },
  };
  // Light-physics orb palette (airy translucent mist, per light_tokens handoff)
  const PHASE_LIGHT = {
    inhale: { a: '#DDEEFF', b: '#9EC7FF', c: '#60A5FA', glow: 'rgba(96,165,250,0.45)', label: 'Breathe in' },
    hold:   { a: '#EFE7FF', b: '#C7B4FF', c: '#A78BFA', glow: 'rgba(167,139,250,0.40)', label: 'Hold' },
    exhale: { a: '#E1F7EC', b: '#B7EDD1', c: '#34D399', glow: 'rgba(52,211,153,0.35)', label: 'Breathe out' },
    idle:   { a: '#E7DDFF', b: '#B4D8FF', c: '#8B5CF6', glow: 'rgba(124,58,237,0.30)', label: '' },
  };
  const SCALE = { inhale: 1.18, hold: 1.20, exhale: 0.92, idle: 1.0 };

  // ---------- Color interpolation primitives ----------
  // CSS cannot interpolate gradients, so orb color changes are driven by a
  // single requestAnimationFrame timeline that numerically mixes the PREVIOUS
  // palette into the NEXT one and rewrites the gradient strings each frame.
  // That is what turns an abrupt gradient swap into a true colour flow.
  function parseColor(c) {
    c = String(c).trim();
    if (c.charAt(0) === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [r || 0, g || 0, b || 0, a];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 && !isNaN(p[3]) ? p[3] : 1];
    }
    return [0, 0, 0, 1];
  }
  function mixColor(from, to, t) {
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
      from[3] + (to[3] - from[3]) * t,
    ];
  }
  function rgbaStr(c) {
    // 4dp keeps 8-bit hex alphas (n/255) exact enough to be sub-perceptual at
    // the timeline endpoints, so t=0 / t=1 render the original design colours.
    const a = Math.round(c[3] * 10000) / 10000;
    return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  }
  function withAlpha(c, a) { return [c[0], c[1], c[2], a]; }
  // ease-in-out (cubic) — symmetric acceleration/deceleration, no snapping
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Hex alpha suffixes used by the light palette, kept exact so an
  // interpolated palette at t=0 / t=1 renders the same pixels as before.
  const A_20 = 32 / 255, A_25 = 37 / 255, A_40 = 64 / 255;

  // A phase's colours as numbers — the single source of truth the orb reads.
  function phasePalette(phase) {
    if (Theme.mode === 'light') {
      const p = PHASE_LIGHT[phase] || PHASE_LIGHT.idle;
      return { light: true, a: parseColor(p.a), b: parseColor(p.b), c: parseColor(p.c), glow: parseColor(p.glow) };
    }
    const p = PHASE[phase] || PHASE.idle;
    const col = parseColor(p.b);
    return { light: false, a: parseColor(p.a), b: col, c: col, glow: parseColor(p.glow) };
  }
  function mixPalette(from, to, t) {
    return {
      light: to.light,
      a: mixColor(from.a, to.a, t),
      b: mixColor(from.b, to.b, t),
      c: mixColor(from.c || to.c, to.c, t),
      glow: mixColor(from.glow, to.glow, t),
    };
  }

  // Gradient CSS for every coloured orb layer, built from a numeric palette.
  function gradientsFrom(p) {
    if (p.light) {
      return {
        glow: rgbaStr(p.glow),
        auraBg: `radial-gradient(circle, ${rgbaStr(p.glow)} 0%, transparent 60%)`,
        haloBg: `radial-gradient(circle, transparent 55%, ${rgbaStr(p.glow)} 62%, transparent 78%)`,
        bodyBg: `radial-gradient(circle at 35% 30%, rgba(255,255,255,1) 0%, ${rgbaStr(p.a)} 25%, ${rgbaStr(p.b)} 60%, ${rgbaStr(withAlpha(p.c, A_20))} 90%)`,
        bodyShadow: `inset -10px -10px 30px ${rgbaStr(withAlpha(p.c, A_25))}, inset 10px 15px 30px rgba(255,255,255,0.8), 0 0 60px ${rgbaStr(p.glow)}`,
        vaporBg: `radial-gradient(circle at 65% 68%, ${rgbaStr(withAlpha(p.c, A_40))} 0%, transparent 55%)`,
      };
    }
    return {
      glow: rgbaStr(p.glow),
      auraBg: `radial-gradient(circle, ${rgbaStr(p.glow)} 0%, transparent 60%)`,
      haloBg: `radial-gradient(circle, transparent 55%, ${rgbaStr(p.glow)} 62%, transparent 78%)`,
      bodyBg: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, ${rgbaStr(p.a)} 30%, ${rgbaStr(p.b)} 65%, #1a0f3a 100%)`,
      bodyShadow: `inset -20px -20px 60px rgba(0,0,0,0.4), inset 15px 20px 40px rgba(255,255,255,0.25), 0 0 80px ${rgbaStr(p.glow)}`,
      vaporBg: `radial-gradient(circle at 68% 72%, ${rgbaStr(p.b)} 0%, transparent 60%)`,
    };
  }

  // Gradient CSS for the main orb body in the active theme
  function orbGradients(phase) { return gradientsFrom(phasePalette(phase)); }

  // ---------- Orb ----------
  function orbHTML(size, phase, opts) {
    opts = opts || {};
    const g = orbGradients(phase);
    const intensity = opts.intensity != null ? opts.intensity : 0.75;
    const scale = (SCALE[phase] || 1) * (0.85 + intensity * 0.25);
    const aura = opts.showAura === false ? '' :
      `<div class="orb-aura" style="inset:${-size * 0.6}px;background:${g.auraBg}"></div>`;
    const anim = opts.animate === false ? 'style="animation:none"' : '';
    // Colour changes are interpolated in place by setOrbPhase (see below), so
    // every layer here is a single stable node for the life of the screen.
    return `
    <div class="orb-wrap" data-orb data-phase="${phase}" style="width:${size}px;height:${size}px;transform:scale(${scale})">
      ${aura}
      <div class="orb-halo" style="background:${g.haloBg}"></div>
      <div class="orb-blob-a" ${anim} style="background:${g.bodyBg};box-shadow:${g.bodyShadow}"></div>
      <div class="orb-blob-b" ${anim} style="background:${g.vaporBg}"></div>
      <div class="orb-specular"></div>
      <div class="orb-spark"></div>
      <div class="orb-innerring"></div>
    </div>`;
  }

  // Paint an orb's coloured layers from a numeric palette. Pure write — no
  // reads, no layout properties, so a frame costs one composite.
  function paintOrb(el, palette) {
    const g = gradientsFrom(palette);
    const aura = el.querySelector('.orb-aura');
    if (aura) aura.style.background = g.auraBg;
    const halo = el.querySelector('.orb-halo');
    if (halo) halo.style.background = g.haloBg;
    const a = el.querySelector('.orb-blob-a');
    if (a) { a.style.background = g.bodyBg; a.style.boxShadow = g.bodyShadow; }
    const b = el.querySelector('.orb-blob-b');
    if (b) b.style.background = g.vaporBg;
  }

  // Update an existing orb in place.
  //
  // Colour is INTERPOLATED, not swapped. One requestAnimationFrame timeline
  // per orb numerically mixes the palette it is currently showing into the
  // palette the new phase asks for, easing in and out, and rewrites every
  // coloured layer from that single mixed value each frame. Consequences:
  //   * no abrupt jump — every intermediate colour actually exists
  //   * exactly one timeline per orb; starting a new phase cancels the old
  //     one and continues from the colour on screen, so an early phase change
  //     bends the curve instead of snapping back
  //   * no overlay/base handoff, so the old promote-to-base frame (and the
  //     mix-blend-mode:screen double-composite it caused) is gone
  //   * colour is derived from state (data-phase -> palette), never from a
  //     hardcoded per-phase branch at the call site
  // Scale still rides the breath duration on its own transform transition.
  function setOrbPhase(el, phase, intensity, durMs) {
    if (!el) return;
    intensity = intensity != null ? intensity : 0.75;
    const scale = (SCALE[phase] || 1) * (0.85 + intensity * 0.25);
    el.style.transitionDuration = (durMs || 4000) + 'ms';
    el.style.transform = `scale(${scale})`;
    // The phase the orb is currently showing. Falls back to the rendered
    // data-phase attribute so the first in-place update after orbHTML()
    // interpolates away from the colours actually on screen.
    const shownPhase = el._orbPhase || el.dataset.phase || phase;
    if (shownPhase === phase && el._orbShown) return; // same colours — only scale updates
    el.dataset.phase = phase;

    const to = phasePalette(phase);
    // Where the orb visually is right now: the last painted mix if a fade is
    // still in flight, otherwise the palette of the phase it was showing. A
    // theme switch invalidates the cached mix (different palette family), so
    // fall back to a clean same-theme reading of the previous phase.
    const themeChanged = el._orbTheme != null && el._orbTheme !== Theme.mode;
    const from = (!themeChanged && el._orbShown) || phasePalette(shownPhase);
    el._orbTheme = Theme.mode;
    el._orbPhase = phase;

    // Cancel the in-flight timeline first — there is never more than one.
    if (el._orbRaf) { cancelAnimationFrame(el._orbRaf); el._orbRaf = 0; }

    // Fade length is proportional to the phase, clamped to the design range.
    const fadeMs = Math.max(600, Math.min(1200, (durMs || 4000) * 0.3));
    if (shownPhase === phase || prefersReducedMotion() || fadeMs <= 0) {
      el._orbShown = to;
      paintOrb(el, to);
      return;
    }

    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const step = (now) => {
      const raw = Math.min(1, ((now || t0) - t0) / fadeMs);
      const mixed = raw >= 1 ? to : mixPalette(from, to, easeInOut(raw));
      el._orbShown = mixed;
      paintOrb(el, mixed);
      if (raw < 1) el._orbRaf = requestAnimationFrame(step);
      else el._orbRaf = 0;
    };
    el._orbRaf = requestAnimationFrame(step);
  }

  // ---------- Progress ring ----------
  // The SVG is absolutely positioned so it can overlay the orb without
  // consuming layout space. It is centred on both axes with inset:0 +
  // margin:auto — the SVG has an intrinsic width/height, so auto margins
  // resolve symmetrically inside the positioned parent at any parent size.
  // No hardcoded offsets, nothing to recompute on resize, and because the
  // element only ever animates stroke-dashoffset, the centre never drifts.
  // (Previously this was `position:absolute` with no offsets at all, so the
  // ring fell back to its static position and sat low-right of the orb.)
  function ringHTML(size, progress, stroke, color) {
    stroke = stroke || 2;
    const r = (size - stroke * 2) / 2;
    const circ = 2 * Math.PI * r;
    return `
    <svg class="progress-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute;inset:0;margin:auto;transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}"/>
      <circle data-ring cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color || 'url(#auraRingGrad)'}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - progress)}"/>
      <defs><linearGradient id="auraRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7C3AED"/><stop offset="100%" stop-color="#22D3EE"/>
      </linearGradient></defs>
    </svg>`;
  }

  // ---------- Icons (24x24 line, stroke 1.5) ----------
  const ICONS = {
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="2.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l5 5L19 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.15-1.4l2-1.55-2-3.46-2.35.95A7 7 0 0014.7 5.3l-.35-2.5h-4l-.35 2.5a7 7 0 00-1.8 1.24l-2.35-.95-2 3.46 2 1.55A7 7 0 005.7 12a7 7 0 00.15 1.4l-2 1.55 2 3.46 2.35-.95a7 7 0 001.8 1.24l.35 2.5h4l.35-2.5a7 7 0 001.8-1.24l2.35.95 2-3.46-2-1.55A7 7 0 0019 12z"/>',
    stats: '<path d="M5 20V12M12 20V6M19 20v-8" stroke-width="2"/>',
    heart: '<path d="M12 20s-7-4.5-9-9c-1.2-2.8.6-6 3.5-6 2 0 3.5 1.2 5.5 3.5C14 6.2 15.5 5 17.5 5c2.9 0 4.7 3.2 3.5 6-2 4.5-9 9-9 9z"/>',
    spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5"/>',
    moon: '<path d="M20 13.5A8 8 0 0110.5 4 8 8 0 1020 13.5z"/>',
    sound: '<path d="M4 10v4h3l5 4V6l-5 4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
    bell: '<path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 004 0"/>',
    lotus: '<path d="M12 20c-4 0-8-2.5-8-6 1.5.5 3 .5 4-.2C8 10 9.5 6.5 12 4c2.5 2.5 4 6 4 9.8 1 .7 2.5.7 4 .2 0 3.5-4 6-8 6z"/>',
    focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3.5 3.5 0 010 6M17 14c2.9.5 4 2.8 4 6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
    logout: '<path d="M14 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2v-2M9 12h11M17 9l3 3-3 3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z"/>',
    wind: '<path d="M4 8h9a3 3 0 100-3M3 13h13a3 3 0 110 3M5 18h7a2.5 2.5 0 11.5 2"/>',
    // ---- Auth / account icons (design handoff) ----
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    download: '<path d="M12 3v13M6 12l6 6 6-6M4 20h16"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2"/>',
    warn: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/><path d="M10 11v6M14 11v6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
  };
  function icon(name, size, color) {
    return `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  // ---------- Modal manager: scroll lock + animated open/close ----------
  // `html` is the page scroll container, so the lock class goes on BOTH the
  // documentElement and body. The CSS `:has()` rule covers modern engines; this
  // mirrors it directly for older Safari/Firefox that lack :has() support.
  // The scrollbar is zero-width in every state, so locking reclaims no space
  // and cannot shift layout when a modal opens or closes.
  let openModals = 0;
  function lockScroll() {
    if (++openModals === 1) {
      document.body.classList.add('modal-open');
      document.documentElement.classList.add('modal-open');
    }
  }
  function unlockScroll() {
    if (--openModals <= 0) {
      openModals = 0;
      document.body.classList.remove('modal-open');
      document.documentElement.classList.remove('modal-open');
    }
  }

  // openModal(className, html) -> { veil, close(cb) }
  // close() plays the reverse animation, unlocks scroll, then removes.
  function openModal(className, html) {
    const veil = document.createElement('div');
    veil.className = className;
    veil.innerHTML = html;
    lockScroll();
    let closed = false;
    function close(after) {
      if (closed) return; closed = true;
      veil.classList.add('modal-veil--closing');
      unlockScroll();
      setTimeout(() => { veil.remove(); if (after) after(); }, 260);
    }
    document.body.appendChild(veil);
    return { veil, close };
  }

  // ---------- Slider engine ----------
  // Continuous drag: visual value tracks pointer via rAF (no re-render),
  // onMove fires per frame for readouts, onCommit fires once on release.
  function attachSlider(input, { onMove, onCommit } = {}) {
    let raf = 0, pending = null, dragging = false;
    function flush() {
      raf = 0;
      if (pending === null) return;
      const v = pending; pending = null;
      if (onMove) onMove(v, input);
    }
    input.addEventListener('input', () => {
      pending = +input.value;
      if (!raf) raf = requestAnimationFrame(flush);
    }, { passive: true });
    function start() {
      if (dragging) return; dragging = true;
      input.classList.add('dragging');
    }
    function end() {
      if (!dragging) { return; }
      dragging = false;
      input.classList.remove('dragging');
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (pending !== null) { const v = pending; pending = null; if (onMove) onMove(v, input); }
      if (onCommit) onCommit(+input.value, input);
      haptic(8); // respects the haptics preference
    }
    input.addEventListener('pointerdown', start, { passive: true });
    input.addEventListener('pointerup', end, { passive: true });
    input.addEventListener('pointercancel', end, { passive: true });
    // keyboard support: commit per change
    input.addEventListener('change', () => { if (!dragging && onCommit) onCommit(+input.value, input); }, { passive: true });
    return input;
  }

  // Crossfade-free value readout update (bump animation, no flicker)
  function setSliderVal(el, text) {
    if (!el || el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('bump');
    void el.offsetWidth; // restart animation
    el.classList.add('bump');
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg, ms) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), ms || 3200);
  }

  function confirmModal(title, body, confirmLabel, danger) {
    return new Promise((resolve) => {
      const m = openModal('modal-veil modal-veil--center', `
        <div class="sheet sheet--center" style="max-width:380px">
          <h3 style="font-size:19px;font-weight:600;margin-bottom:10px">${title}</h3>
          <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;margin-bottom:24px">${body}</p>
          <div style="display:flex;gap:10px">
            <button class="btn-ghost" data-x style="flex:1">Cancel</button>
            <button class="btn-primary" data-ok style="flex:1;${danger ? 'background:linear-gradient(135deg,#F59E0B,#EF7B0B);box-shadow:0 10px 40px rgba(245,158,11,0.35)' : ''}">${confirmLabel || 'Confirm'}</button>
          </div>
        </div>`);
      m.veil.querySelector('[data-x]').onclick = () => m.close(() => resolve(false));
      m.veil.querySelector('[data-ok]').onclick = () => m.close(() => resolve(true));
      m.veil.onclick = (e) => { if (e.target === m.veil) m.close(() => resolve(false)); };
    });
  }

  // Upgrade prompt shown when API returns 402
  function upgradeModal(message) {
    const m = openModal('modal-veil modal-veil--center', `
      <div class="sheet sheet--center" style="max-width:400px;text-align:center">
        <div style="display:flex;justify-content:center;margin-bottom:16px">${orbHTML(90, 'hold', { intensity: 0.9 })}</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:9999px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(34,211,238,0.25));border:1px solid rgba(167,139,250,0.4);font-size:12px;font-weight:600;letter-spacing:1px;margin-bottom:14px">${icon('spark', 13)} AURA PLUS</div>
        <h3 style="font-size:21px;font-weight:600;margin-bottom:10px">Deepen your practice.</h3>
        <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;margin-bottom:24px">${message || 'Unlock unlimited sessions, every program, and deep analytics.'}</p>
        <a href="/pricing" class="btn-primary" style="margin-bottom:10px">See plans</a>
        <button class="btn-ghost" data-x>Not now</button>
      </div>`);
    m.veil.querySelector('[data-x]').onclick = () => m.close();
    m.veil.onclick = (e) => { if (e.target === m.veil) m.close(); };
  }

  function bgHTML(hue) {
    return `<div class="aura-bg ${hue ? 'aura-bg--' + hue : ''}"></div><div class="aura-stars"></div>`;
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function handleApiError(err, fallback) {
    const data = err && err.response && err.response.data;
    const status = err && err.response && err.response.status;
    if (status === 402) { upgradeModal(data && data.error); return; }
    // 401 (invalid/expired) and 403 (account unavailable / suspended / session
    // invalidated) both mean the stored session is no longer good — clear it and
    // return to login so the user isn't stuck on a dead-end error screen.
    if ((status === 401 || status === 403) && !location.pathname.startsWith('/pricing')) {
      AuraState.clear();
      if (location.hash && !['#login', '#signup', '#welcome', '#splash'].includes(location.hash)) {
        location.hash = '#login';
      } else if (location.pathname !== '/') {
        location.href = '/';
      }
      return;
    }
    toast((data && data.error) || fallback || 'Something went wrong.');
  }

  window.Aura = { api, AuraState, Theme, Prefs, haptic, Tone, PHASE, orbHTML, setOrbPhase, ringHTML, icon, toast, confirmModal, upgradeModal, bgHTML, fmtTime, handleApiError, openModal, attachSlider, setSliderVal };
})();
