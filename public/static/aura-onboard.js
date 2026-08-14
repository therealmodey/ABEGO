// AURA — Onboarding · Extended Flow (10 screens). Vanilla-JS slices concatenated.

// AURA — Onboarding · Agent A slice (screens 1-4: softEntry / welcome / guided / how)
// Vanilla-JS IIFE registering 4 routes into the existing hash-routed app.
// Reuses window.Aura atoms and the .screen/.glass/.btn-primary/.chip/.toggle/.aura-slider
// / .overline design language from aura.css. Native web-app design only.
// NOTE: lotus / eye / moon icons do NOT exist in the icon() registry — inlined as
// 24x24 SVGs (stroke=currentColor, 1.5, fill=none) per the build contract.
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, bgHTML, PHASE } = window.Aura;
  const App = window.AuraApp;            // { routes, go, ... } defined in app.js
  const root = document.getElementById('app');

  // Shared onboarding draft (transient). Exposed on window.AuraApp.ob so the
  // whole 10-screen flow shares ONE object and tests can inspect it.
  const ob = (window.AuraApp.ob || (window.AuraApp.ob = { stress: 6, goal: 'relax', length: 5, sound: true, haptics: true, reminders: false, intent: 'ease' }));

  // Re-declare goalGlow (local to each onboarding slice; not global on window.Aura).
  function goalGlow(c) { return `inset 0 0 0 1px ${c}88, 0 0 32px ${c}55`; }
  function goto(r) { App.go(r); }

  // ---- 10-step progress dots; `active` is the 0-based index of the lit segment ----
  function dots(active) {
    let s = '<nav style="display:flex;gap:6px;justify-content:center;margin-top:18px" aria-hidden="true">';
    for (let i = 0; i < 10; i++) {
      const on = i === active;
      s += `<span style="width:${on ? 20 : 5}px;height:5px;border-radius:3px;background:${on ? 'linear-gradient(90deg,#7C3AED,#22D3EE)' : 'rgba(255,255,255,0.18)'}"></span>`;
    }
    return s + '</nav>';
  }

  // ---- Inline SVGs for icons that are NOT in the icon() registry ----
  function svgLotus() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2 4 2 8 0 11-2-3-2-7 0-11z"/><path d="M12 14c3-2 6-2 9 1-3 2-6 1-9-1z"/><path d="M12 14c-3-2-6-2-9 1 3 2 6 1 9-1z"/><path d="M12 14c4 1 7 3 8 6-4 0-7-2-8-6z"/><path d="M12 14c-4 1-7 3-8 6 4 0 7-2 8-6z"/><path d="M12 21v-7"/></svg>`;
  }
  function svgEye() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  function svgMoon() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>`;
  }

  // ================= 1 · SOFT ENTRY =================
  App.routes.softEntry = function () {
    root.innerHTML = `${bgHTML()}
    <section class="screen" style="padding:24px;justify-content:center;align-items:center;text-align:center;cursor:pointer" id="soft-screen">
      <div style="flex:1;display:flex;align-items:center;justify-content:center">${orbHTML(260, 'idle')}</div>
      <div style="padding-bottom:48px">
        <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;line-height:1.2;margin-bottom:14px">Just arrive.</h1>
        <p style="font-size:15px;color:var(--text-tertiary);max-width:280px;margin:0 auto 36px;line-height:1.5">A moment to land before we begin.</p>
        <button class="btn-primary" id="begin-btn" style="max-width:320px;margin:0 auto">Begin</button>
        <div class="overline" style="margin-top:28px;opacity:0.5;letter-spacing:3px">TAP ANYWHERE</div>
      </div>
    </section>`;
    const goWelcome = () => goto('welcome');
    document.getElementById('soft-screen').onclick = goWelcome;
    document.getElementById('begin-btn').onclick = (e) => { e.stopPropagation(); goWelcome(); };
  };

  // ================= 2 · WELCOME =================
  App.routes.welcome = function () {
    root.innerHTML = `${bgHTML()}
    <section class="screen" style="padding:24px">
      <header style="text-align:center;padding-top:28px"><span style="font-size:14px;font-weight:500;letter-spacing:8px;padding-left:8px">AURA</span></header>
      <div style="flex:1;display:flex;align-items:center;justify-content:center">${orbHTML(240, 'idle')}</div>
      <div style="text-align:center;padding-bottom:32px">
        <h1 style="font-size:32px;font-weight:600;letter-spacing:-0.5px;line-height:1.25;margin-bottom:14px">Breathe with<br/>intention.</h1>
        <p style="font-size:15px;color:var(--text-tertiary);max-width:280px;margin:0 auto 32px;line-height:1.5">A living orb that guides your breath. Calmer in seconds, clearer in minutes.</p>
        <button class="btn-primary" id="begin-btn" style="max-width:360px;margin:0 auto">Begin</button>
        <button style="margin-top:18px;font-size:14px;color:var(--text-tertiary);display:block;width:100%" id="login-link">I already have an account</button>
        ${dots(1)}
      </div>
    </section>`;
    document.getElementById('begin-btn').onclick = () => goto('guided');
    document.getElementById('login-link').onclick = () => goto('login');
  };

  // ================= 3 · GUIDED INTERACTION =================
  App.routes.guided = function () {
    root.innerHTML = `${bgHTML()}
    <section class="screen" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:24px">
        <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">Meet the orb</span>
        <div style="width:40px"></div>
      </header>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div id="guided-orb" style="transition:transform 400ms var(--ease), filter 400ms var(--ease);transform:scale(1)">${orbHTML(180, 'idle')}</div>
        <div style="margin-top:28px;display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:9999px;background:rgba(52,211,153,0.10);border:1px solid rgba(52,211,153,0.30)">
          <span class="pulse-dot" style="background:#34D399"></span>
          <span class="overline" style="color:#6EE7B7;letter-spacing:1.5px">RESPONDING TO YOU</span>
        </div>
      </div>
      <div style="padding-bottom:24px">
        <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;text-align:center;margin-bottom:8px">Meet the orb.</h1>
        <p style="font-size:15px;color:var(--text-tertiary);text-align:center;margin-bottom:28px">Touch it. Hold it. It'll respond.</p>
        <button class="btn-primary" id="next-btn">Tap when ready</button>
        ${dots(2)}
      </div>
    </section>`;
    const orb = document.getElementById('guided-orb');
    const press = () => { orb.style.transform = 'scale(1.08)'; orb.style.filter = 'drop-shadow(0 0 40px rgba(124,58,237,0.7))'; haptic(10); };
    const release = () => { orb.style.transform = 'scale(1)'; orb.style.filter = 'none'; };
    orb.addEventListener('pointerdown', press);
    orb.addEventListener('pointerup', release);
    orb.addEventListener('pointerleave', release);
    document.querySelector('[data-back]').onclick = () => goto('welcome');
    document.getElementById('next-btn').onclick = () => goto('how');
  };

  // ================= 4 · HOW IT WORKS =================
  App.routes.how = function () {
    const cards = [
      { phase: 'inhale', label: 'Inhale', desc: 'Expand slowly with the orb', dur: '4s' },
      { phase: 'hold', label: 'Hold', desc: 'Pause at the peak', dur: '2s' },
      { phase: 'exhale', label: 'Exhale', desc: 'Release and soften', dur: '7s' },
    ];
    root.innerHTML = `${bgHTML('blue')}
    <section class="screen screen--scroll" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:36px">
        <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">Step 3 of 4</span>
        <button id="skip-btn" style="font-size:13px;color:var(--text-tertiary)">Skip</button>
      </header>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:28px">The rhythm is<br/>simple.</h1>
      <div style="display:flex;flex-direction:column;gap:14px;flex:1">
        ${cards.map((c) => `
        <article class="glass" style="padding:18px;display:flex;align-items:center;gap:16px">
          <div style="width:56px;height:56px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), ${PHASE[c.phase].a} 40%, ${PHASE[c.phase].b} 80%);box-shadow:0 0 24px ${PHASE[c.phase].glow}"></div>
          <div style="flex:1"><div style="font-size:16px;font-weight:500;margin-bottom:3px">${c.label}</div>
          <div style="font-size:13px;color:var(--text-tertiary)">${c.desc}</div></div>
          <span class="tabular" style="font-size:15px;color:${PHASE[c.phase].a};font-weight:500">${c.dur}</span>
        </article>`).join('')}
      </div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="next-btn">Continue</button>
        ${dots(3)}
      </div>
    </section>`;
    document.querySelector('[data-back]').onclick = () => goto('guided');
    document.getElementById('skip-btn').onclick = () => goto('liveDemo');
    document.getElementById('next-btn').onclick = () => goto('liveDemo');
  };
})();

// AURA — Onboarding · Agent B slice (screens 5-7: liveDemo / personalize / intent)
// Vanilla-JS IIFE registering 3 routes into the existing hash-routed app.
// Reuses window.Aura atoms and the .screen/.glass/.btn-primary/.chip/.toggle/.aura-slider
// / .overline design language from aura.css. Native web-app design only.
// NOTE: lotus / eye / moon icons do NOT exist in the icon() registry — they are
// inlined as 24x24 SVGs (stroke=currentColor, 1.5, fill=none) per the build contract.
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, bgHTML } = window.Aura;
  const App = window.AuraApp;            // { routes, go, ... } defined in app.js
  const root = document.getElementById('app');

  // Shared onboarding draft (transient). Exposed on window.AuraApp.ob so the
  // whole 10-screen flow shares ONE object and tests can inspect it.
  const ob = (window.AuraApp.ob || (window.AuraApp.ob = { stress: 6, goal: 'relax', length: 5, sound: true, haptics: true, reminders: false, intent: 'ease' }));

  // Re-declare goalGlow (local to each onboarding slice; not global on window.Aura).
  function goalGlow(c) { return `inset 0 0 0 1px ${c}88, 0 0 32px ${c}55`; }
  function goto(r) { App.go(r); }

  // Module-level demo interval handle — cleared at the top of every route fn so it never leaks.
  let _demoTimer = null;

  // ---- 10-step progress dots; `active` is the 0-based index of the lit segment ----
  function dots(active) {
    let s = '<nav style="display:flex;gap:6px;justify-content:center;margin-top:18px" aria-hidden="true">';
    for (let i = 0; i < 10; i++) {
      const on = i === active;
      s += `<span style="width:${on ? 20 : 5}px;height:5px;border-radius:3px;background:${on ? 'linear-gradient(90deg,#7C3AED,#22D3EE)' : 'rgba(255,255,255,0.18)'}"></span>`;
    }
    return s + '</nav>';
  }

  // ---- Inline SVGs for icons that are NOT in the icon() registry ----
  function svgLotus() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2 4 2 8 0 11-2-3-2-7 0-11z"/><path d="M12 14c3-2 6-2 9 1-3 2-6 1-9-1z"/><path d="M12 14c-3-2-6-2-9 1 3 2 6 1 9-1z"/><path d="M12 14c4 1 7 3 8 6-4 0-7-2-8-6z"/><path d="M12 14c-4 1-7 3-8 6 4 0 7-2 8-6z"/><path d="M12 21v-7"/></svg>`;
  }
  function svgEye() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  function svgMoon() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>`;
  }

  // ================= 5 · LIVE DEMO =================
  App.routes.liveDemo = function () {
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    root.innerHTML = `${bgHTML()}\n    <section class="screen screen--scroll" id="demo-screen" style="padding:24px">
      <header style="display:flex;align-items:center;padding-top:16px;margin-bottom:10px">
        <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
        <span class="overline" style="flex:1;text-align:center;color:var(--text-tertiary)">TRY ONE BREATH</span>
        <div style="width:40px"></div>
      </header>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;position:relative;min-height:280px">
        <div style="position:absolute;width:210px;height:210px;border-radius:50%;border:1.5px solid rgba(124,58,237,0.35);box-shadow:0 0 40px rgba(124,58,237,0.22);animation:auraPulseRing 3s ease-out infinite"></div>
        <div style="animation:auraBreathe 13s ease-in-out infinite">${orbHTML(160, 'inhale', { intensity: 0.85 })}</div>
      </div>
      <div style="text-align:center;padding-bottom:24px">
        <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:10px">Follow the orb.</h1>
        <div id="demo-caption" style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#60A5FA;margin-bottom:8px">Breathe in</div>
        <div class="overline" style="opacity:.7;margin-bottom:24px">PREVIEW · ONE CYCLE</div>
        <button class="btn-primary" id="next-btn">Continue</button>
        ${dots(4)}
      </div>
    </section>`;
    // Caption follows the breathing cycle (~13s loop): inhale(blue) → hold(violet) → exhale(green).
    const cap = root.querySelector('#demo-caption');
    const steps = [
      { t: 'Breathe in', c: '#60A5FA' },
      { t: 'Hold', c: '#A78BFA' },
      { t: 'Breathe out', c: '#34D399' },
    ];
    let si = 0;
    _demoTimer = setInterval(() => {
      si = (si + 1) % steps.length;
      if (cap) { cap.textContent = steps[si].t; cap.style.color = steps[si].c; }
    }, 4333);
    root.querySelector('[data-back]').onclick = () => goto('how');
    root.querySelector('#next-btn').onclick = () => goto('personalize');
  };

  // ================= 6 · PERSONALIZE =================
  App.routes.personalize = function () {
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    const stressLabel = (v) => (v <= 3 ? 'Low' : v <= 6 ? 'Moderate' : 'High');
    const goals = [
      { id: 'relax', label: 'Relax', svg: svgLotus, color: '#34D399' },
      { id: 'focus', label: 'Focus', svg: svgEye, color: '#60A5FA' },
      { id: 'sleep', label: 'Sleep', svg: svgMoon, color: '#A78BFA' },
    ];
    root.innerHTML = `${bgHTML()}\n    <section class="screen screen--scroll" id="pers-screen" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:28px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
          <span class="overline">Step 3 of 4</span>
        </div>
        <button id="skip-btn" style="font-size:13px;color:var(--text-tertiary)">Skip</button>
      </header>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:28px">Tune AURA<br/>to you.</h1>

      <div style="margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px">
          <span class="overline">Stress today</span>
          <span id="stress-val" class="slider-val" style="font-size:13px;color:#60A5FA">${stressLabel(ob.stress)} · ${ob.stress}</span>
        </div>
        <input type="range" min="0" max="10" value="${ob.stress}" class="aura-slider" id="stress-slider" aria-label="Stress level">
      </div>

      <div style="margin-bottom:28px">
        <div class="overline" style="margin-bottom:14px">Your goal</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px" id="goal-grid">
          ${goals.map((g) => `
          <button class="glass goal-card" data-goal="${g.id}" aria-pressed="${ob.goal === g.id}" style="padding:20px 10px;display:flex;flex-direction:column;align-items:center;gap:10px;border-radius:18px;transition:box-shadow 400ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1);${ob.goal === g.id ? `box-shadow:${goalGlow(g.color)};` : ''}">
            <span style="color:${g.color}">${g.svg()}</span>
            <span style="font-size:13px;font-weight:500">${g.label}</span>
          </button>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div class="overline" style="margin-bottom:14px">Preferred session</div>
        <div style="display:flex;gap:10px" id="len-row">
          ${[3, 5, 10, 15].map((m) => `<button class="chip ${ob.length === m ? 'selected' : ''}" data-len="${m}" aria-pressed="${ob.length === m}">${m} min</button>`).join('')}
        </div>
      </div>

      <div style="flex:1"></div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="next-btn">Continue</button>
        ${dots(5)}
      </div>
    </section>`;

    const A = window.Aura;
    A.attachSlider(root.querySelector('#stress-slider'), {
      onMove: (v) => A.setSliderVal(root.querySelector('#stress-val'), `${stressLabel(v)} · ${v}`),
      onCommit: (v) => { ob.stress = v; },
    });

    // Selection patches the SAME nodes — no screen re-render (mirrors app.js personalize pattern).
    const goalCards = Array.prototype.slice.call(root.querySelectorAll('.goal-card'));
    const lenChips = Array.prototype.slice.call(root.querySelectorAll('[data-len]'));
    const goalColor = {};
    goals.forEach((g) => { goalColor[g.id] = g.color; });
    goalCards.forEach((b) => b.onclick = () => {
      if (ob.goal === b.dataset.goal) return;
      ob.goal = b.dataset.goal;
      goalCards.forEach((c) => {
        const on = c.dataset.goal === ob.goal;
        c.style.boxShadow = on ? goalGlow(goalColor[c.dataset.goal]) : '';
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      A.haptic(8);
    });
    lenChips.forEach((b) => b.onclick = () => {
      const v = +b.dataset.len;
      if (ob.length === v) return;
      ob.length = v;
      lenChips.forEach((c) => {
        const on = +c.dataset.len === v;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      A.haptic(6);
    });

    root.querySelector('[data-back]').onclick = () => goto('liveDemo');
    root.querySelector('#next-btn').onclick = () => goto('intent');
    root.querySelector('#skip-btn').onclick = () => goto('intent');
  };

  // ================= 7 · INTENT =================
  App.routes.intent = function () {
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    const intents = [
      { id: 'ease', label: 'Ease', svg: svgLotus, color: '#34D399', desc: 'to unwind & release tension' },
      { id: 'clear', label: 'Clear', svg: svgEye, color: '#60A5FA', desc: 'to sharpen & focus' },
      { id: 'rest', label: 'Rest', svg: svgMoon, color: '#A78BFA', desc: 'to slow down for sleep' },
    ];
    root.innerHTML = `${bgHTML()}\n    <section class="screen screen--scroll" id="intent-screen" style="padding:24px">
      <header style="display:flex;align-items:center;padding-top:16px;margin-bottom:8px">
        <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
        <span class="overline" style="flex:1;text-align:center;color:var(--text-tertiary)">WHAT BRINGS YOU HERE</span>
        <div style="width:40px"></div>
      </header>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;text-align:center;margin:10px 0 6px">You want to…</h1>
      <div style="display:flex;flex-direction:column;gap:14px;flex:1;padding:20px 0">
        ${intents.map((g) => `
        <button class="glass intent-card" data-intent="${g.id}" aria-pressed="${ob.intent === g.id}" style="padding:18px;display:flex;align-items:center;gap:16px;border-radius:18px;transition:box-shadow 400ms cubic-bezier(.4,0,.2,1), transform 400ms cubic-bezier(.4,0,.2,1);${ob.intent === g.id ? `box-shadow:${goalGlow(g.color)};` : ''}">
          <span style="color:${g.color};flex-shrink:0">${g.svg()}</span>
          <div style="flex:1"><div style="font-size:16px;font-weight:500;margin-bottom:2px">${g.label}</div>
          <div style="font-size:13px;color:var(--text-tertiary)">${g.desc}</div></div>
        </button>`).join('')}
      </div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="next-btn">Continue</button>
        ${dots(6)}
      </div>
    </section>`;

    const A = window.Aura;
    const cards = Array.prototype.slice.call(root.querySelectorAll('.intent-card'));
    const colorOf = {};
    intents.forEach((g) => { colorOf[g.id] = g.color; });
    cards.forEach((b) => b.onclick = () => {
      if (ob.intent === b.dataset.intent) return;
      ob.intent = b.dataset.intent;
      cards.forEach((c) => {
        const on = c.dataset.intent === ob.intent;
        c.style.boxShadow = on ? goalGlow(colorOf[c.dataset.intent]) : '';
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      A.haptic(8);
    });

    root.querySelector('[data-back]').onclick = () => goto('personalize');
    root.querySelector('#next-btn').onclick = () => goto('previewRecommend'); // enabled; default 'ease' selected
  };
})();

// AURA — Onboarding flow, Agent C slice (screens 8-10).
// Registers App.routes.previewRecommend, permissions, transition.
// Mirrors aura-auth.js structure; uses only window.Aura atoms + aura.css classes.
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, bgHTML } = window.Aura;
  const App = window.AuraApp;
  const root = document.getElementById('app');
  // Shared onboarding draft (transient). Exposed on window.AuraApp.ob so the
  // whole 10-screen flow shares ONE object and tests can inspect it.
  const ob = (window.AuraApp.ob || (window.AuraApp.ob = { stress: 6, goal: 'relax', length: 5, sound: true, haptics: true, reminders: false, intent: 'ease' }));
  function goalGlow(c) { return `inset 0 0 0 1px ${c}88, 0 0 32px ${c}55`; }
  function goto(r) { App.go(r); }

  // PHASE palette (window.Aura.PHASE = { inhale/hold/exhale: {a,b,glow} }).
  const PHASE = window.Aura.PHASE;

  // Progress dots (10, one lit at the given index).
  function dotsHTML(active) {
    let s = '<div style="display:flex;gap:6px;justify-content:center;padding:14px 0 4px">';
    for (let i = 0; i < 10; i++) {
      if (i === active) s += '<span class="pulse-dot" style="width:20px;height:5px;border-radius:3px;background:linear-gradient(90deg,#7C3AED,#22D3EE)"></span>';
      else s += '<span class="pulse-dot" style="width:5px;height:5px;border-radius:3px;background:rgba(255,255,255,0.18)"></span>';
    }
    return s + '</div>';
  }

  // Mini stat (timeline row item).
  function statHTML(label, val, color) {
    return `<div style="flex:1;text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:12px 6px">
        <div style="font-size:18px;font-weight:600;color:${color}">${val}</div>
        <div class="overline" style="color:var(--text-tertiary);margin-top:4px">${label}</div>
      </div>`;
  }

  // Toggle row (permissions screen).
  function permRow(key, label, desc, ic, color) {
    const on = ob[key];
    return `<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="width:34px;height:34px;border-radius:10px;background:${color}15;border:1px solid ${color}35;box-shadow:inset 0 0 12px ${color}30;display:flex;align-items:center;justify-content:center;color:${color}">${icon(ic, 18, color)}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:500">${label}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${desc}</div>
        </div>
        <button class="toggle ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-toggle="${key}" aria-label="${label}" style="flex-shrink:0"></button>
      </div>`;
  }

  // =====================================================================
  // 8 · previewRecommend
  // =====================================================================
  App.routes.previewRecommend = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px 0">
          <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
          <div style="width:40px"></div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;text-align:center;margin-top:8px">
          <div class="overline" style="display:inline-flex;align-items:center;gap:8px;margin-bottom:14px;color:#34D399">
            <span style="width:6px;height:6px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399"></span> TUNED TO YOU
          </div>
          <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:18px">We recommend a <span class="grad-text">3-minute reset</span></h1>
          <div style="position:relative;display:flex;align-items:center;justify-content:center;margin-bottom:18px">
            <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(52,211,153,0.22) 0%,transparent 60%);filter:blur(22px)"></div>
            ${orbHTML(150, 'idle', { intensity: 0.78 })}
          </div>
          <div class="glass" style="width:100%;max-width:360px;padding:18px;margin-bottom:16px;text-align:left">
            <div id="prog-name" style="font-size:16px;font-weight:600">4-7-8 · Deep Unwind</div>
            <div id="prog-sub" class="overline" style="color:var(--text-tertiary);margin-top:4px">Slow exhale · calms the nervous system</div>
          </div>
          <div style="display:flex;gap:10px;width:100%;max-width:360px;margin-bottom:14px">
            ${statHTML('Inhale', '4s', PHASE.inhale.a)}
            ${statHTML('Hold', '7s', PHASE.hold.a)}
            ${statHTML('Exhale', '8s', PHASE.exhale.a)}
          </div>
          <div class="overline tabular" style="color:var(--text-tertiary);margin-bottom:22px">SESSION LENGTH 3:00 · 6 cycles</div>
          <div style="display:flex;gap:12px;width:100%;max-width:360px">
            <button class="btn-ghost" id="customize-btn" style="flex:1">Customize</button>
            <button class="btn-primary" id="sounds-btn" style="flex:1">Sounds right</button>
          </div>
        </div>
        ${dotsHTML(7)}
      </section>`;
    root.querySelector('[data-back]').onclick = () => goto('intent');
    document.getElementById('customize-btn').onclick = () => toast('Customize after your first session');
    document.getElementById('sounds-btn').onclick = () => goto('permissions');
    // Fetch a tuned program; keep fallback copy on failure or if no match.
    (async () => {
      try {
        const { data } = await api.get('/api/programs');
        const progs = (data && data.programs) || [];
        const catMap = { ease: 'relax', clear: 'focus', rest: 'sleep' };
        const want = catMap[ob.intent] || 'relax';
        let prog = progs.find(p => p.category === want && !p.premium);
        if (!prog) prog = progs.find(p => !p.premium);
        const name = prog && prog.title ? prog.title : '4-7-8 · Deep Unwind';
        const nm = document.getElementById('prog-name');
        if (nm) nm.textContent = name;
      } catch (e) { /* keep fallback copy */ }
    })();
  };

  // =====================================================================
  // 9 · permissions
  // =====================================================================
  App.routes.permissions = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        <div style="display:flex;align-items:center;gap:12px;padding:6px 4px 0">
          <button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>
          <span class="overline" style="flex:1;text-align:center">Step 4 of 4</span>
          <div style="width:40px"></div>
        </div>
        <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;text-align:center;margin:18px 0 4px">Make it feel alive.</h1>
        <p class="overline" style="text-align:center;color:var(--text-tertiary);margin-bottom:22px">A few settings to make it yours</p>
        <div class="glass" style="padding:6px 16px">
          ${permRow('sound', 'Spatial Sound', 'Room-filling calm', 'sound', '#60A5FA')}
          ${permRow('haptics', 'Haptic Feedback', 'Feel each breath', 'spark', '#A78BFA')}
          ${permRow('reminders', 'Gentle Reminders', 'A nudge when you need it', 'heart', '#34D399')}
        </div>
        <div style="flex:1"></div>
        <button class="btn-primary" id="enter-btn" style="margin-top:18px;width:100%">Enter AURA</button>
        ${dotsHTML(8)}
      </section>`;
    root.querySelector('[data-back]').onclick = () => goto('previewRecommend');
    root.querySelectorAll('[data-toggle]').forEach(t => {
      t.onclick = () => {
        const k = t.dataset.toggle;
        ob[k] = !ob[k];
        t.classList.toggle('on', ob[k]);
        t.setAttribute('aria-checked', String(ob[k]));
        t.blur();
      };
    });
    document.getElementById('enter-btn').onclick = () => goto('transition');
  };

  // =====================================================================
  // 10 · transition (final)
  // =====================================================================
  App.routes.transition = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen" style="padding:32px;align-items:center;justify-content:center;text-align:center">
        <div style="display:flex;flex-direction:column;align-items:center">
          <div style="position:relative;display:flex;align-items:center;justify-content:center;margin-bottom:22px">
            <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(124,58,237,0.28) 0%,transparent 60%);filter:blur(24px)"></div>
            ${orbHTML(150, 'idle', { intensity: 0.8 })}
          </div>
          <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:8px">Let's begin.</h1>
          <p style="font-size:14px;color:var(--text-tertiary);margin-bottom:18px;max-width:260px">Your first breath is ready when you are.</p>
          <div class="chip" style="display:inline-flex;align-items:center;gap:8px;margin-bottom:26px">
            <span style="width:6px;height:6px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399"></span> YOUR FIRST BREATH
          </div>
          <button class="btn-primary" id="start-btn" style="max-width:340px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px">${icon('play', 18)} Start your first session</button>
          <button class="btn-ghost" data-back style="margin-top:12px">Back</button>
          ${dotsHTML(9)}
        </div>
      </section>`;
    root.querySelector('[data-back]').onclick = () => goto('permissions');
    document.getElementById('start-btn').onclick = async () => {
      try {
        await api.put('/profile', {
          goal: ob.goal,
          baselineStress: ob.stress,
          sessionLength: ob.length,
          prefs: { sound: ob.sound, haptics: ob.haptics, reminders: ob.reminders, intent: ob.intent },
          onboarded: true,
        });
        const u = AuraState.user;
        if (u) { u.onboarded = true; AuraState.user = u; }
        goto('home');
      } catch (err) { (window.Aura.handleApiError || toast)(err); }
    };
  };

  console.log('[aura-onboard.partC] previewRecommend, permissions, transition registered');
})();
