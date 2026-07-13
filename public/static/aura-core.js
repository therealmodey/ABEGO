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

  // ---------- Phase colors (design tokens) ----------
  const PHASE = {
    inhale: { a: '#60A5FA', b: '#22D3EE', glow: 'rgba(96,165,250,0.65)', label: 'Breathe in' },
    hold:   { a: '#A78BFA', b: '#7C3AED', glow: 'rgba(167,139,250,0.65)', label: 'Hold' },
    exhale: { a: '#34D399', b: '#22D3EE', glow: 'rgba(52,211,153,0.55)', label: 'Breathe out' },
    idle:   { a: '#7C3AED', b: '#22D3EE', glow: 'rgba(124,58,237,0.6)', label: '' },
  };
  const SCALE = { inhale: 1.18, hold: 1.20, exhale: 0.92, idle: 1.0 };

  // ---------- Orb ----------
  function orbHTML(size, phase, opts) {
    opts = opts || {};
    const p = PHASE[phase] || PHASE.idle;
    const intensity = opts.intensity != null ? opts.intensity : 0.75;
    const scale = (SCALE[phase] || 1) * (0.85 + intensity * 0.25);
    const aura = opts.showAura === false ? '' :
      `<div class="orb-aura" style="inset:${-size * 0.6}px;background:radial-gradient(circle, ${p.glow} 0%, transparent 60%)"></div>`;
    const anim = opts.animate === false ? 'style="animation:none"' : '';
    return `
    <div class="orb-wrap" data-orb style="width:${size}px;height:${size}px;transform:scale(${scale})">
      ${aura}
      <div class="orb-halo" style="background:radial-gradient(circle, transparent 55%, ${p.glow} 62%, transparent 78%)"></div>
      <div class="orb-blob-a" ${anim} style="background:radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, ${p.a} 30%, ${p.b} 65%, #1a0f3a 100%);box-shadow:inset -20px -20px 60px rgba(0,0,0,0.4), inset 15px 20px 40px rgba(255,255,255,0.25), 0 0 80px ${p.glow}"></div>
      <div class="orb-blob-b" ${anim} style="background:radial-gradient(circle at 68% 72%, ${p.b} 0%, transparent 60%)"></div>
      <div class="orb-specular"></div>
      <div class="orb-spark"></div>
      <div class="orb-innerring"></div>
    </div>`;
  }

  // Update an existing orb in place (phase transition, animated via CSS transitions)
  function setOrbPhase(el, phase, intensity, durMs) {
    const p = PHASE[phase] || PHASE.idle;
    intensity = intensity != null ? intensity : 0.75;
    const scale = (SCALE[phase] || 1) * (0.85 + intensity * 0.25);
    el.style.transitionDuration = (durMs || 4000) + 'ms';
    el.style.transform = `scale(${scale})`;
    const aura = el.querySelector('.orb-aura');
    if (aura) aura.style.background = `radial-gradient(circle, ${p.glow} 0%, transparent 60%)`;
    const halo = el.querySelector('.orb-halo');
    if (halo) halo.style.background = `radial-gradient(circle, transparent 55%, ${p.glow} 62%, transparent 78%)`;
    const a = el.querySelector('.orb-blob-a');
    if (a) {
      a.style.background = `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, ${p.a} 30%, ${p.b} 65%, #1a0f3a 100%)`;
      a.style.boxShadow = `inset -20px -20px 60px rgba(0,0,0,0.4), inset 15px 20px 40px rgba(255,255,255,0.25), 0 0 80px ${p.glow}`;
    }
    const b = el.querySelector('.orb-blob-b');
    if (b) b.style.background = `radial-gradient(circle at 68% 72%, ${p.b} 0%, transparent 60%)`;
  }

  // ---------- Progress ring ----------
  function ringHTML(size, progress, stroke, color) {
    stroke = stroke || 2;
    const r = (size - stroke * 2) / 2;
    const circ = 2 * Math.PI * r;
    return `
    <svg class="progress-ring" width="${size}" height="${size}" style="position:absolute;transform:rotate(-90deg)">
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
  };
  function icon(name, size, color) {
    return `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
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
      const veil = document.createElement('div');
      veil.className = 'modal-veil modal-veil--center';
      veil.innerHTML = `
        <div class="sheet sheet--center" style="max-width:380px">
          <h3 style="font-size:19px;font-weight:600;margin-bottom:10px">${title}</h3>
          <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;margin-bottom:24px">${body}</p>
          <div style="display:flex;gap:10px">
            <button class="btn-ghost" data-x style="flex:1">Cancel</button>
            <button class="btn-primary" data-ok style="flex:1;${danger ? 'background:linear-gradient(135deg,#F59E0B,#EF7B0B);box-shadow:0 10px 40px rgba(245,158,11,0.35)' : ''}">${confirmLabel || 'Confirm'}</button>
          </div>
        </div>`;
      veil.querySelector('[data-x]').onclick = () => { veil.remove(); resolve(false); };
      veil.querySelector('[data-ok]').onclick = () => { veil.remove(); resolve(true); };
      veil.onclick = (e) => { if (e.target === veil) { veil.remove(); resolve(false); } };
      document.body.appendChild(veil);
    });
  }

  // Upgrade prompt shown when API returns 402
  function upgradeModal(message) {
    const veil = document.createElement('div');
    veil.className = 'modal-veil modal-veil--center';
    veil.innerHTML = `
      <div class="sheet sheet--center" style="max-width:400px;text-align:center">
        <div style="display:flex;justify-content:center;margin-bottom:16px">${orbHTML(90, 'hold', { intensity: 0.9 })}</div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:9999px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(34,211,238,0.25));border:1px solid rgba(167,139,250,0.4);font-size:12px;font-weight:600;letter-spacing:1px;margin-bottom:14px">${icon('spark', 13)} AURA PLUS</div>
        <h3 style="font-size:21px;font-weight:600;margin-bottom:10px">Deepen your practice.</h3>
        <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;margin-bottom:24px">${message || 'Unlock unlimited sessions, every program, and deep analytics.'}</p>
        <a href="/pricing" class="btn-primary" style="margin-bottom:10px">See plans</a>
        <button class="btn-ghost" data-x>Not now</button>
      </div>`;
    veil.querySelector('[data-x]').onclick = () => veil.remove();
    veil.onclick = (e) => { if (e.target === veil) veil.remove(); };
    document.body.appendChild(veil);
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
    if (err && err.response && err.response.status === 402) { upgradeModal(data && data.error); return; }
    if (err && err.response && err.response.status === 401 && !location.pathname.startsWith('/pricing')) {
      AuraState.clear();
      if (location.pathname !== '/') location.href = '/';
    }
    toast((data && data.error) || fallback || 'Something went wrong.');
  }

  window.Aura = { api, AuraState, PHASE, orbHTML, setOrbPhase, ringHTML, icon, toast, confirmModal, upgradeModal, bgHTML, fmtTime, handleApiError };
})();
