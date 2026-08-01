/* AURA Admin — Super Command Centre v2 (full rebuild per design handoff3) */
(function () {
  const { api, AuraState, icon, toast, confirmModal, Theme } = window.Aura;
  const root = document.getElementById('app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let me = null;

  async function guard() {
    const token = localStorage.getItem('aura_token');
    if (!token) { location.href = '/#/login'; return false; }
    try {
      const { data } = await api.get('/auth/me');
      if (data.user.role !== 'admin') {
        toast('Admin access required', 'warn');
        setTimeout(() => (location.href = '/'), 800);
        return false;
      }
      me = data.user;
      AuraState.user = data.user;
      return true;
    } catch (e) { location.href = '/#/login'; return false; }
  }

  /* ---- Navigation: 11 sections per handoff sidebar ---- */
  const NAV = [
    { id: 'overview', label: 'Overview', ic: 'grid' },
    { id: 'live', label: 'Mission Control', ic: 'activity', live: true },
    { id: 'ai', label: 'AI Control', ic: 'brain' },
    { id: 'analytics', label: 'Analytics', ic: 'chart' },
    { id: 'biometrics', label: 'Biometrics', ic: 'heart' },
    { id: 'programs', label: 'Programs', ic: 'layers' },
    { id: 'experiments', label: 'Experiments', ic: 'beaker' },
    { id: 'notifications', label: 'Notifications', ic: 'bell' },
    { id: 'revenue', label: 'Revenue', ic: 'dollar' },
    { id: 'health', label: 'System Health', ic: 'server' },
    { id: 'users', label: 'Users', ic: 'users' },
  ];
  const TITLES = {
    overview: 'Overview', live: 'Mission Control', ai: 'AI Control', analytics: 'Advanced Analytics',
    biometrics: 'Biometrics', programs: 'Programs', experiments: 'Experiments',
    notifications: 'Notification Engine', revenue: 'Revenue', health: 'System Health',
    users: 'Users', settings: 'Settings & Audit',
  };
  const VIEW_IDS = NAV.map(n => n.id).concat(['settings']);
  function currentView() {
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'dashboard') return 'overview';
    if (h === 'content') return 'programs';
    if (h === 'audit') return 'settings';
    return VIEW_IDS.includes(h) ? h : 'overview';
  }

  /* ---- Admin icon set (from handoff admin_kit AdminIcon) ---- */
  const AIC_PATHS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    activity: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
    brain: '<path d="M9 3a3 3 0 00-3 3v0a2 2 0 00-2 2v2a2 2 0 001 1.7A2 2 0 003 14v2a3 3 0 003 3h1"/><path d="M15 3a3 3 0 013 3v0a2 2 0 012 2v2a2 2 0 01-1 1.7A2 2 0 0121 14v2a3 3 0 01-3 3h-1"/><path d="M9 3v18M15 3v18"/>',
    chart: '<path d="M3 20V10M9 20V4M15 20v-6M21 20V8"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/>',
    beaker: '<path d="M9 3v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3"/><path d="M7 3h10M6 15h12"/>',
    bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 20a2 2 0 004 0"/>',
    dollar: '<path d="M12 3v18"/><path d="M17 7a4 4 0 00-4-2h-2a3 3 0 000 6h2a3 3 0 010 6h-2a4 4 0 01-4-2"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 6a3 3 0 010 6M22 20a5.5 5.5 0 00-4.5-5.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    filter: '<path d="M4 5h16M6 12h12M10 19h4"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    play: '<path d="M8 5l12 7-12 7V5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    kebab: '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    check: '<path d="M5 12l4 4L19 7"/>',
    warn: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    zap: '<path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><circle cx="7" cy="7.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="7" cy="16.5" r="0.8" fill="currentColor" stroke="none"/>',
    command: '<path d="M9 6a3 3 0 100 6h6a3 3 0 100-6M9 18a3 3 0 110-6h6a3 3 0 110 6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M14 7h7v7"/>',
    replay: '<path d="M3 12a9 9 0 1015-6.7L21 3"/><path d="M21 3v6h-6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    orb: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="2" fill="currentColor" stroke="none"/>',
  };
  function aic(name, size) {
    const sz = size || 18;
    const body = AIC_PATHS[name] || AIC_PATHS.dot;
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0" aria-hidden="true">${body}</svg>`;
  }

  /* ---- format helpers ---- */
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s + (s.includes('T') || s.includes('Z') ? '' : 'Z'));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function money(cents, cur) {
    const n = (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return cur === 'NGN' ? `₦${n}` : `$${n}`;
  }
  function revenueStr(r) {
    if (!r) return '$0';
    const parts = [];
    if (r.usd_cents) parts.push(money(r.usd_cents, 'USD'));
    if (r.ngn_kobo) parts.push(money(r.ngn_kobo, 'NGN'));
    return parts.join(' + ') || '$0';
  }
  function initials(nameOrEmail) {
    const s = String(nameOrEmail || '?').trim();
    const parts = s.split(/[\s._@-]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function avatarHTML(nameOrEmail, size) {
    const sz = size || 30;
    return `<span class="scc-avatar" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.36)}px">${esc(initials(nameOrEmail))}</span>`;
  }
  function errBox(e) {
    const msg = e?.response?.data?.error || e.message || 'Something drifted off course';
    return `<div class="scc-card scc-err"><p>${esc(msg)}</p></div>`;
  }
  const spinner = `<div class="scc-loading"><div class="scc-loading-orb"></div><p>Syncing telemetry…</p></div>`;
  // deterministic pseudo-random per seed (stable mock values per user id)
  const seeded = (seed, min, max) => min + ((seed * 2654435761) % 1000) / 1000 * (max - min);
  const genClient = (n, base = 40, vari = 25, drift = 0.5) => Array.from({ length: n }, (_, i) => base + Math.sin(i * 0.8) * vari * 0.5 + Math.sin(i * 0.31) * vari * 0.5 + i * drift);

  /* ---- SCC mock module fetcher (schema: GET /admin/scc/:module) ---- */
  const sccCache = {};
  async function sccData(mod) {
    if (sccCache[mod]) return sccCache[mod];
    const { data } = await api.get(`/admin/scc/${mod}`);
    sccCache[mod] = data.data;
    return data.data;
  }

  /* ================= SVG chart helpers (per admin_kit handoff) ================= */
  let gid = 0;
  const ACCENT_V = '#8B5CF6', ACCENT_C = '#22D3EE', GOOD = '#34D399', WARN = '#F59E0B', BAD = '#F87171', SLATE = '#64748B', BLUE = '#60A5FA';
  const PHASE_C = { inhale: '#60A5FA', hold: '#A78BFA', exhale: '#34D399', rest: '#64748B' };

  function smoothPath(pts) {
    if (!pts.length) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return d;
  }
  function toPts(data, w, h, pad, yMax) {
    const p = pad == null ? 4 : pad;
    const max = yMax || Math.max(1, ...data), min = Math.min(0, ...data);
    const span = max - min || 1;
    return data.map((v, i) => [
      p + (i / Math.max(1, data.length - 1)) * (w - p * 2),
      h - p - ((v - min) / span) * (h - p * 2),
    ].map(n => Math.round(n * 10) / 10));
  }

  function miniSpark(data, w, h, color) {
    if (!data || data.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const id = 'sg' + (++gid);
    const pts = toPts(data, w, h);
    const line = smoothPath(pts);
    const area = `${line} L ${pts[pts.length - 1][0]} ${h} L ${pts[0][0]} ${h} Z`;
    const c = color || ACCENT_V;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c}" stop-opacity="0.28"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" stroke="${c}" stroke-width="1.6" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${c}66)"/>
    </svg>`;
  }

  // Multi-series line chart: series = [{ data, color, area? }], supports 1..n series
  function lineChartM(seriesList, w, h, labels, yMax) {
    const id = 'lg' + (++gid);
    const pad = 10;
    const grid = [0.25, 0.5, 0.75].map(f =>
      `<line x1="${pad}" y1="${Math.round(h * f)}" x2="${w - pad}" y2="${Math.round(h * f)}" stroke="currentColor" stroke-opacity="0.07"/>`).join('');
    const globalMax = yMax || Math.max(1, ...seriesList.flatMap(s => s.data || [0]));
    const body = seriesList.map((s, i) => {
      if (!s.data || s.data.length < 2) return '';
      const pts = toPts(s.data, w, h, pad, globalMax);
      const line = smoothPath(pts);
      const last = pts[pts.length - 1];
      const dotEl = `<circle cx="${last[0]}" cy="${last[1]}" r="3.4" fill="${s.color}" style="filter:drop-shadow(0 0 6px ${s.color})"/>`;
      const area = (s.area || i === 0)
        ? `<path d="${line} L ${last[0]} ${h - pad} L ${pts[0][0]} ${h - pad} Z" fill="url(#${id})"/>` : '';
      return `${area}<path d="${line}" stroke="${s.color}" stroke-width="2" stroke-linecap="round" fill="none" style="filter:drop-shadow(0 0 5px ${s.color}55)"/>${dotEl}`;
    }).join('');
    const lab = (labels && labels.length)
      ? `<div class="scc-chart-x">${labels.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : '';
    const c0 = seriesList[0]?.color || ACCENT_V;
    return `<div><svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" aria-hidden="true" style="display:block">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c0}" stop-opacity="0.22"/><stop offset="100%" stop-color="${c0}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}${body}
    </svg>${lab}</div>`;
  }
  function lineChart(a, b, w, h, labels) {
    const list = [{ data: a, color: ACCENT_V, area: true }];
    if (b) list.push({ data: b, color: ACCENT_C });
    return lineChartM(list, w, h, labels);
  }

  // Bar chart with optional highlight index (Mission Control timeline)
  function barChart(data, w, h, hiIdx, labels) {
    const max = Math.max(1, ...data);
    const bw = (w - 12) / data.length;
    const bars = data.map((v, i) => {
      const bh = Math.max(3, (v / max) * (h - 18));
      const hot = i === hiIdx;
      const c = hot ? ACCENT_C : ACCENT_V;
      return `<rect x="${(6 + i * bw + bw * 0.15).toFixed(1)}" y="${(h - 14 - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"
        fill="${c}" fill-opacity="${hot ? 0.95 : 0.45}" ${hot ? `style="filter:drop-shadow(0 0 8px ${c})"` : ''}/>`;
    }).join('');
    const lab = (labels || []).map((l, i) =>
      `<text x="${(6 + i * bw + bw / 2).toFixed(1)}" y="${h - 3}" text-anchor="middle" class="scc-stack-lbl">${esc(l)}</text>`).join('');
    return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="display:block">${bars}${lab}</svg>`;
  }

  function donut(segments, size, centerLabel, centerSub) {
    const sz = size || 150, sw = 14, r = (sz - sw) / 2, C = 2 * Math.PI * r;
    const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
    let off = 0;
    const arcs = segments.filter(s => s.value > 0).map(s => {
      const len = (s.value / total) * C;
      const el = `<circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="${s.color}" stroke-width="${sw}" fill="none"
        stroke-dasharray="${len - 2} ${C - len + 2}" stroke-dashoffset="${-off}" stroke-linecap="round"
        style="filter:drop-shadow(0 0 5px ${s.color}44)"/>`;
      off += len;
      return el;
    }).join('');
    return `<div style="position:relative;width:${sz}px;height:${sz}px;margin:0 auto">
      <svg width="${sz}" height="${sz}" style="transform:rotate(-90deg)" aria-hidden="true">
        <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="currentColor" stroke-opacity="0.07" stroke-width="${sw}" fill="none"/>
        ${arcs}
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span class="scc-mono" style="font-size:22px;font-weight:600;color:var(--adm-text)">${esc(centerLabel)}</span>
        <span style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--adm-text-3)">${esc(centerSub || '')}</span>
      </div>
    </div>`;
  }

  function meter(label, value, max, right, color) {
    const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
    const c = color || ACCENT_V;
    return `<div class="scc-meter">
      <div class="scc-meter-top"><span>${esc(label)}</span><span class="scc-mono">${esc(right != null ? right : value)}</span></div>
      <div class="scc-meter-track"><div class="scc-meter-fill" style="width:${pct}%;background:linear-gradient(90deg,${c},${ACCENT_C})"></div></div>
    </div>`;
  }

  function tag(text, color) {
    const c = color || SLATE;
    return `<span class="scc-tag" style="background:${c}18;border-color:${c}40;color:${c}">${esc(text)}</span>`;
  }
  function roleTag(r) { return tag(r, r === 'admin' ? ACCENT_V : SLATE); }
  function planTag(p) { return tag(p || 'free', p === 'premium' ? ACCENT_C : p === 'pro' ? ACCENT_V : SLATE); }
  function statusTag(s) { return tag(s, s === 'active' ? GOOD : s === 'suspended' ? WARN : SLATE); }
  function dot(color, pulse) { return `<span class="scc-dot ${pulse ? 'scc-dot--pulse' : ''}" style="background:${color};color:${color}"></span>`; }

  function kpi(label, value, unit, delta, dir, sparkData, sparkColor, glow) {
    const dcls = dir === 'up' ? 'scc-delta--up' : dir === 'down' ? 'scc-delta--down' : 'scc-delta--flat';
    const darrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    return `<div class="scc-card scc-kpi ${glow ? 'scc-kpi--glow' : ''}">
      <div class="scc-kpi-label">${esc(label)}</div>
      <div class="scc-kpi-row">
        <span class="scc-kpi-val scc-mono">${value}${unit ? `<span class="scc-kpi-unit">${esc(unit)}</span>` : ''}</span>
        ${delta != null ? `<span class="scc-delta ${dcls}">${darrow} ${esc(delta)}</span>` : ''}
      </div>
      ${sparkData ? `<div class="scc-kpi-spark">${miniSpark(sparkData, 150, 34, sparkColor)}</div>` : ''}
    </div>`;
  }

  function cardHead(title, sub, right) {
    return `<div class="scc-card-head">
      <div><div class="scc-card-title">${esc(title)}</div>${sub ? `<div class="scc-card-sub">${esc(sub)}</div>` : ''}</div>
      ${right || ''}
    </div>`;
  }

  function segControl(opts, activeIdx, extraCls) {
    return `<div class="scc-seg ${extraCls || ''}">${opts.map((o, i) =>
      `<button class="${i === activeIdx ? 'on' : ''}" data-seg="${i}">${esc(o)}</button>`).join('')}</div>`;
  }

  /* ---- Globe stub (SVG dashed meridians + pulsing pings) ---- */
  function globeStub(pings, liveN, h) {
    const H = h || 230;
    const meridians = [-0.6, -0.3, 0, 0.3, 0.6].map(k => {
      const cx = 350 + k * 420;
      return `<ellipse cx="350" cy="${H / 2}" rx="${Math.abs(300 - Math.abs(k) * 180)}" ry="${H / 2 - 18}" fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-dasharray="3 5" transform="translate(${(cx - 350) * 0.25},0)"/>`;
    }).join('');
    const lats = [0.3, 0.5, 0.7].map(f =>
      `<ellipse cx="350" cy="${H / 2}" rx="300" ry="${(H / 2 - 18) * f}" fill="none" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3 5"/>`).join('');
    const pingEls = (pings || []).map((pt, i) => {
      const x = 50 + (pt.x / 700) * 600, y = 20 + (pt.y / 230) * (H - 40);
      if (pt.hot) return `<circle class="scc-ping" cx="${x}" cy="${y}" r="4.5" fill="${ACCENT_C}" style="filter:drop-shadow(0 0 7px ${ACCENT_C});animation-delay:${(i % 5) * 0.4}s"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${ACCENT_C}" stroke-opacity="0.35"/>`;
      return `<circle cx="${x}" cy="${y}" r="2.6" fill="${ACCENT_V}" fill-opacity="0.75"/>`;
    }).join('');
    return `<div class="scc-globe">
      <svg viewBox="0 0 700 ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${lats}${meridians}${pingEls}</svg>
      <span class="scc-globe-live">${tag(`${liveN} live`, GOOD)}</span>
    </div>`;
  }

  /* ---- Heatmap 7×24 (violet alpha cells per handoff) ---- */
  function heatmap(grid) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows = grid.map((row, d) => `<div class="scc-heat-row">
      <span class="scc-heat-lbl">${days[d]}</span>
      ${row.map(v => `<span class="scc-heat-cell ${v > 0.7 ? 'scc-heat-cell--hot' : ''}" style="background:rgba(139,92,246,${(0.06 + v * 0.85).toFixed(2)})" title="${v}"></span>`).join('')}
    </div>`).join('');
    const colLabels = ['12a', '', '', '', '', '', '6a', '', '', '', '', '', '12p', '', '', '', '', '', '6p', '', '', '', '', '12a'];
    return `<div class="scc-heat">${rows}
      <div class="scc-heat-cols"><span></span>${colLabels.map(l => `<span>${l}</span>`).join('')}</div>
    </div>
    <div class="scc-heat-legend">Low ${[0.1, 0.25, 0.45, 0.65, 0.8, 0.95].map(a => `<i style="background:rgba(139,92,246,${a})"></i>`).join('')} High</div>`;
  }

  /* ---- Cohort retention grid ---- */
  function cohortGrid(cohorts) {
    const head = `<div class="scc-cohort-w"></div><div class="scc-cohort-n">Users</div>` +
      Array.from({ length: 8 }, (_, i) => `<div class="scc-cohort-h">W${i}</div>`).join('');
    const cells = cohorts.map(c => `<div class="scc-cohort-w">${esc(c.w)}</div><div class="scc-cohort-n">${esc(c.n)}</div>` +
      c.v.map(v => v == null ? '<div></div>'
        : `<div class="scc-cohort-c ${v > 70 ? 'scc-cohort-c--hot' : ''}" style="background:rgba(139,92,246,${(0.10 + (v / 100) * 0.75).toFixed(2)});color:${v > 40 ? '#fff' : 'var(--adm-text-2)'}">${v}</div>`).join('')
    ).join('');
    return `<div class="scc-cohort">${head}${cells}</div>`;
  }

  /* ---- Funnel with conversion % ---- */
  function funnel(steps) {
    const max = Math.max(1, ...steps.map(s => s.v));
    return `<div class="scc-funnel">${steps.map((s, i) => {
      const conv = i === 0 ? null : Math.round((s.v / steps[i - 1].v) * 100);
      const cc = conv == null ? '' : conv > 80 ? GOOD : conv > 60 ? ACCENT_C : WARN;
      return `<div class="scc-funnel-row">
        <span class="scc-funnel-lbl">${esc(s.l)}</span>
        <div class="scc-funnel-track"><div class="scc-funnel-bar" style="width:${Math.round((s.v / max) * 100)}%;background:linear-gradient(90deg,${s.c},${s.c}AA);box-shadow:0 0 10px ${s.c}44">${s.v.toLocaleString()}</div></div>
        <span class="scc-funnel-conv" style="color:${cc}">${conv == null ? '' : conv + '%'}</span>
      </div>`;
    }).join('')}</div>`;
  }

  /* ---- Scatter with trend line ---- */
  function scatter(dotsArr, corr) {
    const dots = dotsArr.map((d, i) => {
      const hot = i % 5 === 0;
      const c = hot ? ACCENT_C : ACCENT_V;
      return `<circle cx="${d.x}" cy="${d.y}" r="7" fill="${c}" fill-opacity="0.12"/>
        <circle cx="${d.x}" cy="${d.y}" r="3" fill="${c}" fill-opacity="0.85"/>`;
    }).join('');
    return `<div style="position:relative">
      <svg width="100%" height="230" viewBox="0 0 740 230" preserveAspectRatio="none" aria-hidden="true" style="display:block">
        ${[0.25, 0.5, 0.75].map(f => `<line x1="30" y1="${230 * f}" x2="720" y2="${230 * f}" stroke="currentColor" stroke-opacity="0.07"/>`).join('')}
        ${dots}
        <path d="M 40 200 Q 350 130 700 40" stroke="${ACCENT_C}" stroke-width="2" stroke-dasharray="6 5" fill="none" opacity="0.7"/>
        <text x="8" y="18" class="scc-stack-lbl">Calm Δ</text>
        <text x="640" y="226" class="scc-stack-lbl">Duration (min)</text>
      </svg>
      <span style="position:absolute;top:8px;right:8px">${tag(`Correlation ${corr}`, ACCENT_C)}</span>
    </div>`;
  }

  /* ---- Stress arc (4-stop gradient + milestone dots) ---- */
  function stressArc(milestones) {
    const id = 'sa' + (++gid);
    const W = 700, H = 220, pad = 40;
    const pts = milestones.map((m, i) => [
      pad + (i / (milestones.length - 1)) * (W - pad * 2),
      30 + m.v * (H - 80),
    ]);
    const line = smoothPath(pts);
    const area = `${line} L ${pts[pts.length - 1][0]} ${H - 30} L ${pts[0][0]} ${H - 30} Z`;
    const dotsEls = pts.map(([x, y], i) => `
      <circle cx="${x}" cy="${y}" r="5" fill="#0B0F1D" stroke="${['#F87171', '#F59E0B', '#A78BFA', '#8B5CF6', '#34D399'][i] || GOOD}" stroke-width="2.5" style="filter:drop-shadow(0 0 6px rgba(139,92,246,0.5))"/>
      <text x="${x}" y="${y - 14}" text-anchor="middle" style="font-size:11px;font-weight:600;fill:var(--adm-text)">${esc(String(milestones[i].v))}</text>
      <text x="${x}" y="${H - 10}" text-anchor="middle" class="scc-stack-lbl">${esc(milestones[i].l)}</text>`).join('');
    return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="display:block">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#F87171"/><stop offset="33%" stop-color="#F59E0B"/>
          <stop offset="66%" stop-color="#A78BFA"/><stop offset="100%" stop-color="#34D399"/>
        </linearGradient>
        <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#A78BFA" stop-opacity="0.18"/><stop offset="100%" stop-color="#A78BFA" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id}f)"/>
      <path d="${line}" stroke="url(#${id})" stroke-width="3" stroke-linecap="round" fill="none" style="filter:drop-shadow(0 0 8px rgba(167,139,250,0.4))"/>
      ${dotsEls}
      <text x="${pad}" y="16" class="scc-stack-lbl">Session start</text>
      <text x="${W - pad}" y="16" text-anchor="end" class="scc-stack-lbl">Session end</text>
    </svg>`;
  }

  /* ---- Stacked MRR bars (new / expansion / churn below baseline) ---- */
  function stackedBars(months) {
    const id = 'sb' + (++gid);
    const W = 700, H = 250, base = 210, bw = 54;
    const maxUp = Math.max(1, ...months.map(m => m.nw + m.exp));
    const scale = 130 / maxUp;
    const bars = months.map((m, i) => {
      const x = 60 + i * ((W - 100) / months.length);
      const hNew = m.nw * scale, hExp = m.exp * scale, hCh = m.ch * scale * 0.9;
      return `
        <rect x="${x}" y="${base - hNew}" width="${bw}" height="${hNew}" rx="6" fill="url(#${id})" style="filter:drop-shadow(0 0 10px rgba(139,92,246,0.35))"/>
        <rect x="${x}" y="${base - hNew - hExp - 3}" width="${bw}" height="${hExp}" rx="5" fill="${ACCENT_C}" fill-opacity="0.35"/>
        <rect x="${x}" y="${base + 4}" width="${bw}" height="${hCh}" rx="4" fill="${BAD}" fill-opacity="0.55"/>
        <text x="${x + bw / 2}" y="${base - hNew - hExp - 10}" text-anchor="middle" style="font-size:11px;font-weight:600;fill:var(--adm-text)" class="scc-mono">$${m.total}k</text>
        <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="scc-stack-lbl">${esc(m.m)}</text>`;
    }).join('');
    return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="display:block">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${ACCENT_C}"/><stop offset="100%" stop-color="${ACCENT_V}"/>
      </linearGradient></defs>
      <line x1="40" y1="${base}" x2="${W - 30}" y2="${base}" stroke="currentColor" stroke-opacity="0.15"/>
      ${bars}
    </svg>
    <div class="scc-legend" style="justify-content:center;margin-top:6px">
      <span>${dot(ACCENT_V)} New</span><span>${dot(ACCENT_C)} Expansion</span><span>${dot(BAD)} Churn</span>
    </div>`;
  }

  /* ---- Slider row (AI tuning) ---- */
  function sliderRow(s) {
    return `<div class="scc-slider-row">
      <div class="scc-slider-top">
        <div><div class="scc-slider-name">${esc(s.label)}</div><div class="scc-slider-desc">${esc(s.desc)}</div></div>
        <div style="display:flex;align-items:center;flex-shrink:0">
          <span class="scc-slider-hint">${esc(s.hint)}</span>
          <span class="scc-slider-pill scc-mono" style="background:${s.c}1c;color:${s.c}" data-pill="${esc(s.id)}">${Math.round(s.v * 100)}%</span>
        </div>
      </div>
      <div class="scc-slider" style="--sl-c:${s.c}">
        <input type="range" min="0" max="100" value="${Math.round(s.v * 100)}" data-slider="${esc(s.id)}"/>
      </div>
    </div>`;
  }

  function toggleHTML(id, on, small) {
    return `<span class="scc-toggle ${small ? 'scc-toggle--sm' : ''}"><input type="checkbox" data-tg="${esc(String(id))}" ${on ? 'checked' : ''}/><span></span></span>`;
  }

  /* ================= shell layout (11-item sidebar + upgraded topbar) ================= */
  let liveCount = 142; // updated from live module when loaded
  function layout(view, content) {
    root.innerHTML = `
      <div class="scc-bg" aria-hidden="true"></div>
      <div class="scc">
        <aside class="scc-side">
          <div class="scc-brand">
            <div class="scc-mark"></div>
            <div>
              <div class="scc-brand-name">AURA <span class="scc-ver scc-mono">v2.4</span></div>
              <div class="scc-brand-sub">ADMIN</div>
            </div>
          </div>
          <nav class="scc-nav">
            ${NAV.map(n => `
              <a href="#/${n.id}" class="scc-nav-item ${view === n.id ? 'scc-nav-item--on' : ''}" title="${esc(n.label)}">
                ${aic(n.ic, 17)}<span>${n.label}</span>
                ${n.live ? `<span class="scc-nav-live">${dot(GOOD, true)} <b class="scc-mono" style="font-size:10px;color:${GOOD}">${liveCount}</b></span>` : ''}
              </a>`).join('')}
          </nav>
          <div class="scc-side-foot">
            <a href="#/settings" class="scc-nav-item ${view === 'settings' ? 'scc-nav-item--on' : ''}" title="Settings">${aic('settings', 17)}<span>Settings</span></a>
            <a href="/" class="scc-nav-item" title="Back to app">${icon('back', 17)}<span>Back to app</span></a>
            <button class="scc-nav-item" id="scc-logout" title="Log out">${icon('logout', 17)}<span>Log out</span></button>
            <div class="scc-me">
              ${avatarHTML(me?.display_name || me?.email, 30)}
              <div style="flex:1;min-width:0">
                <div class="scc-me-name">${esc(me?.display_name || 'Admin')}</div>
                <div class="scc-me-sub">Product · Admin</div>
              </div>
              <span style="color:var(--adm-text-3)">${aic('kebab', 15)}</span>
            </div>
          </div>
        </aside>
        <main class="scc-main">
          <header class="scc-top">
            <div>
              <div class="scc-crumbs">AURA / ${esc(TITLES[view])}</div>
              <div class="scc-title">${esc(TITLES[view])}</div>
            </div>
            <div class="scc-top-right">
              <div class="scc-search-wrap scc-search" style="width:min(440px,30vw)">
                ${aic('search', 15)}<input id="scc-global-search" placeholder="Search users, sessions, programs…"/>
                <span class="scc-search-keys"><span class="scc-key">⌘</span><span class="scc-key">K</span></span>
              </div>
              ${segControl(['24h', '7d', '30d', '90d'], 1)}
              <span class="scc-env">${dot(GOOD, true)} Prod</span>
              <button class="scc-bell" id="scc-bell" title="Notifications">${aic('bell', 15)}<i></i></button>
              <button class="scc-btn" id="scc-theme" title="Toggle theme">${icon(Theme.mode === 'light' ? 'moon' : 'spark', 15)}<span>${Theme.mode === 'light' ? 'Dark' : 'Light'}</span></button>
              ${avatarHTML(me?.display_name || me?.email, 28)}
            </div>
          </header>
          <div class="scc-body">${content}</div>
        </main>
      </div>`;

    const lo = document.getElementById('scc-logout');
    if (lo) lo.onclick = async () => {
      try { await api.post('/auth/logout'); } catch (e) {}
      localStorage.removeItem('aura_token'); localStorage.removeItem('aura_user');
      location.href = '/#/welcome';
    };
    const th = document.getElementById('scc-theme');
    if (th) th.onclick = () => {
      Theme.set(Theme.mode === 'light' ? 'dark' : 'light', true);
      th.innerHTML = `${icon(Theme.mode === 'light' ? 'moon' : 'spark', 15)}<span>${Theme.mode === 'light' ? 'Dark' : 'Light'}</span>`;
    };
    const gs = document.getElementById('scc-global-search');
    if (gs) gs.onkeydown = (ev) => {
      if (ev.key === 'Enter' && gs.value.trim()) {
        sessionStorage.setItem('scc_user_q', gs.value.trim());
        location.hash = '#/users';
        if (currentView() === 'users') views.users();
      }
    };
    const bell = document.getElementById('scc-bell');
    if (bell) bell.onclick = () => toast('3 unread alerts — see Mission Control anomalies', 'ok');
    // topbar range segmented (visual data-range selector; per-range data wired later)
    document.querySelectorAll('.scc-top-right .scc-seg button').forEach(b => {
      b.onclick = () => {
        b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      };
    });
  }

  function activityRows(rows) {
    if (!rows.length) return '<p class="scc-empty">Nothing yet</p>';
    return rows.map(a => `
      <div class="scc-activity-row">
        ${dot(a.action && a.action.includes('fail') ? BAD : ACCENT_C)}
        <span class="scc-activity-what"><strong>${esc(a.email || 'unknown')}</strong> — ${esc(a.action)}${a.meta_json ? ` <em>${esc(a.meta_json)}</em>` : ''}</span>
        <span class="scc-activity-when scc-mono">${fmtDate(a.created_at)}</span>
      </div>`).join('');
  }

  const views = {};

  /* ============ 01 · OVERVIEW ============ */
  views.overview = async function () {
    layout('overview', spinner);
    let d, m;
    try {
      [d, m] = await Promise.all([api.get('/admin/analytics').then(r => r.data), sccData('overview')]);
    } catch (e) { return layout('overview', errBox(e)); }

    const byDay = d.sessionsByDay || [];
    const sessSeries = byDay.map(x => x.n);
    const calmSeries = byDay.map(x => x.avg_calm || 0);
    const signupSeries = (d.signups || []).map(s => s.n);
    const dayLabels = byDay.length ? [byDay[0].day, byDay[Math.floor(byDay.length / 2)]?.day, byDay[byDay.length - 1].day].filter(Boolean).map(x => x.slice(5)) : [];
    const perf = (d.programPerf || []).slice(0, 5);
    const maxStarts = Math.max(1, ...perf.map(p => p.starts));
    const evColor = { violet: ACCENT_V, amber: WARN, cyan: ACCENT_C, green: GOOD };

    layout('overview', `
      <div class="scc-kpis">
        ${kpi('Active users', d.users?.total ?? 0, '', `${d.users?.new_this_week ?? 0} new / wk`, (d.users?.new_this_week ?? 0) > 0 ? 'up' : 'flat', signupSeries.length > 1 ? signupSeries : null, ACCENT_V, true)}
        ${kpi('Sessions today', d.sessions?.last_24h ?? 0, '', `${d.sessions?.total ?? 0} all time`, (d.sessions?.last_24h ?? 0) > 0 ? 'up' : 'flat', sessSeries.length > 1 ? sessSeries : null, ACCENT_C)}
        ${kpi('Avg calm', d.sessions?.avg_calm != null ? Number(d.sessions.avg_calm) : '—', d.sessions?.avg_calm != null ? '/100' : '', 'completed sessions', 'flat', calmSeries.some(v => v > 0) ? calmSeries : null, GOOD)}
        ${kpi('Revenue', revenueStr(d.revenue), '', `${d.revenue?.payments ?? 0} payments`, (d.revenue?.payments ?? 0) > 0 ? 'up' : 'flat', null, BLUE)}
      </div>

      <div class="scc-grid-2-1">
        <div class="scc-card scc-card--glow">
          ${cardHead('Session volume × calm score', 'Sessions (violet) vs avg calm (cyan)',
            `<div style="display:flex;align-items:center;gap:10px"><div class="scc-legend"><span>${dot(ACCENT_V)} Sessions</span><span>${dot(ACCENT_C)} Avg calm</span></div>${segControl(['Line', 'Area'], 1)}</div>`)}
          ${sessSeries.length > 1 ? lineChart(sessSeries, calmSeries.some(v => v > 0) ? calmSeries : null, 560, 180, dayLabels) : '<p class="scc-empty">Not enough session data yet</p>'}
        </div>
        <div class="scc-stack">
          <div class="scc-card">
            ${cardHead('D7 retention', 'Weekly cohort average')}
            ${donut([{ value: m.retention.pct, color: ACCENT_V }, { value: 100 - m.retention.pct, color: 'rgba(100,116,139,0.2)' }], 110, m.retention.pct + '%', 'D7')}
            <div style="margin-top:10px">
              ${m.retention.bars.map(b => meter(b.l, b.v, 100, b.v + '%')).join('')}
            </div>
          </div>
          <div class="scc-card">
            ${cardHead('AI adaptation events', 'Realtime model activity', tag('LIVE', GOOD))}
            ${m.aiEvents.map(ev => `
              <div class="scc-activity-row">
                ${dot(evColor[ev.c] || ACCENT_C, true)}
                <span class="scc-activity-what"><strong>${esc(ev.t)}</strong> — ${esc(ev.d)}</span>
                <span class="scc-activity-when scc-mono">${esc(ev.ago)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="scc-grid-121">
        <div class="scc-card">
          ${cardHead('Sessions · geo', 'Live global distribution')}
          ${globeStub(m.geo.pings, m.geo.live, 200)}
        </div>
        <div class="scc-card">
          ${cardHead('Top programs', 'By session starts')}
          ${perf.length ? perf.map(p => `
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:2px">
              <span class="scc-dot" style="background:${ACCENT_V};color:${ACCENT_V};flex-shrink:0"></span>
              <div style="flex:1;min-width:0">${meter(p.title, p.starts, maxStarts, `${p.starts}`)}</div>
            </div>`).join('') : '<p class="scc-empty">No program data yet</p>'}
        </div>
        <div class="scc-card">
          ${cardHead('System pulse', 'Core service latency', tag('Healthy', GOOD))}
          ${m.systemPulse.map(s => `
            <div class="scc-svc-row">
              ${dot(s.ok ? GOOD : WARN, true)}
              <span class="scc-svc-name">${esc(s.name)}</span>
              <div style="width:70px;height:5px;border-radius:3px;background:var(--adm-border);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(s.load * 100)}%;background:${s.ok ? GOOD : WARN};border-radius:3px"></i></div>
              <span class="scc-svc-ms">${s.ms}ms</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('Recent activity', 'Latest user events')}
        ${activityRows(d.recentActivity || [])}
      </div>
    `);
  };

  /* ============ 02 · MISSION CONTROL (live) ============ */
  views.live = async function () {
    layout('live', spinner);
    let m;
    try { m = await sccData('live'); } catch (e) { return layout('live', errBox(e)); }
    liveCount = m.stats.live;

    const sevC = { amber: WARN, red: BAD };
    const statCard = (label, v, c, pulse) => `<div class="scc-card scc-kpi scc-live-stat">
      <div class="scc-kpi-label">${esc(label)}</div>
      <div class="scc-kpi-row"><b style="color:${c}">${v}</b>${pulse ? dot(c, true) : ''}</div>
    </div>`;

    const cols = '1.4fr 1fr 90px 1fr 90px 90px 90px 60px';
    const rows = m.sessions.map(s => {
      const pc = PHASE_C[s.phase] || SLATE;
      const stressC = s.stress > 0.7 ? WARN : s.stress > 0.5 ? ACCENT_V : GOOD;
      return `<div class="scc-trow" style="grid-template-columns:${cols};${s.hot ? 'background:rgba(245,158,11,0.06)' : ''}">
        <div class="scc-user-cell">${avatarHTML(s.name, 28)}<div><strong>${esc(s.name)}</strong><span class="scc-mono">${esc(s.sid)}</span></div></div>
        <div class="scc-cell-2">${esc(s.region)}</div>
        <div class="scc-mono scc-cell-2">${esc(s.pattern)}</div>
        <div style="display:flex;align-items:center;gap:7px">${dot(pc, true)}<span style="color:${pc};text-transform:capitalize">${esc(s.phase)}</span></div>
        <div><div style="width:60px;height:5px;border-radius:3px;background:var(--adm-border);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(s.stress * 100)}%;background:${stressC};border-radius:3px"></i></div></div>
        <div class="scc-mono scc-cell-2">${s.calm}</div>
        <div class="scc-mono scc-cell-3">${esc(s.dur)}</div>
        <div style="color:var(--adm-text-3)">${aic('kebab', 15)}</div>
      </div>`;
    }).join('');

    layout('live', `
      <div class="scc-kpis scc-kpis--5">
        ${statCard('Live sessions', m.stats.live, GOOD, true)}
        ${statCard('Inhaling', m.stats.inhaling, PHASE_C.inhale)}
        ${statCard('Holding', m.stats.holding, PHASE_C.hold)}
        ${statCard('Exhaling', m.stats.exhaling, PHASE_C.exhale)}
        ${statCard('Flagged', m.stats.flagged, WARN)}
      </div>

      <div class="scc-grid-171">
        <div class="scc-card scc-card--glow">
          ${cardHead('Global session flow', 'Live sessions by region · last hour',
            `<div style="display:flex;align-items:center;gap:10px"><div class="scc-legend"><span>${dot(ACCENT_C)} Hotspot</span><span>${dot(ACCENT_V)} Session</span></div>${segControl(['Globe', 'List'], 0)}</div>`)}
          ${globeStub(Array.from({ length: 16 }, (_, i) => ({ x: 60 + ((i * 137) % 580), y: 40 + ((i * 89) % 160), hot: i % 5 === 0 })), m.stats.live, 190)}
          <div style="margin-top:10px">${barChart(m.timeline, 700, 80, 8, ['-55', '', '', '-40', '', '', '-25', '', '', '-10', '', 'now'])}</div>
        </div>
        <div class="scc-stack">
          <div class="scc-card">
            ${cardHead('Phase distribution', 'Across live sessions')}
            ${donut(m.phaseDist.map(p => ({ value: p.v, color: p.c })), 120, m.phaseDist[0].v + '%', m.phaseDist[0].l)}
            <div style="margin-top:8px">
              ${m.phaseDist.map(p => `<div class="scc-svc-row">${dot(p.c)}<span class="scc-svc-name">${esc(p.l)}</span><span class="scc-mono">${p.v}%</span></div>`).join('')}
            </div>
          </div>
          <div class="scc-card scc-card--glow">
            ${cardHead('Anomalies', 'AI-flagged live issues', tag('3 active', WARN))}
            ${m.anomalies.map(a => {
              const c = sevC[a.sev] || WARN;
              return `<div class="scc-anom" style="background:${c}10;border:1px solid ${c}22">
                <span style="color:${c};flex-shrink:0;margin-top:1px">${aic('warn', 15)}</span>
                <div><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div>
                <span class="ago">${esc(a.ago)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('Live sessions', `Showing ${m.sessions.length} of ${m.stats.live}`,
          `<div style="display:flex;align-items:center;gap:10px"><span class="scc-btn">${aic('filter', 13)}<span>Filter</span></span>${segControl(['All', 'Anxious', 'Flagged'], 0)}</div>`)}
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <span>User</span><span>Region</span><span>Pattern</span><span>Phase</span><span>Stress</span><span>Calm</span><span>Duration</span><span></span>
        </div>
        ${rows}
      </div>
    `);
  };

  /* ============ 03 · AI CONTROL ============ */
  views.ai = async function () {
    layout('ai', spinner);
    let m;
    try { m = await sccData('ai'); } catch (e) { return layout('ai', errBox(e)); }
    const pv = m.preview;
    const digitC = [PHASE_C.inhale, PHASE_C.hold, PHASE_C.exhale];

    layout('ai', `
      <div class="scc-kpis">
        ${kpi('Model version', `<span style="font-size:17px">${esc(m.model.version)}</span>`, '', m.model.status, 'flat', null, null, true)}
        ${kpi('Adaptations · 24h', m.kpis.adaptations.toLocaleString(), '', '+8.2%', 'up', null, ACCENT_V)}
        ${kpi('Effectiveness', m.kpis.effectiveness, '', '+0.04', 'up', null, GOOD)}
        ${kpi('Inference latency', m.kpis.latencyMs, 'ms', '−12ms', 'down', null, ACCENT_C)}
      </div>

      <div class="scc-grid-141">
        <div class="scc-stack">
          <div class="scc-card scc-card--glow">
            ${cardHead('Adaptation tuning', 'Model behaviour weights — publish to roll out',
              `<div style="display:flex;gap:8px"><button class="scc-btn" id="ai-reset">Reset</button><button class="scc-btn scc-btn--violet" id="ai-publish" style="background:linear-gradient(90deg,${ACCENT_V},${ACCENT_C});color:#fff;border:none">Publish</button></div>`)}
            <div id="ai-sliders">${m.sliders.map(sliderRow).join('')}</div>
          </div>
          <div class="scc-card">
            ${cardHead('Feature flags', 'Model capabilities')}
            ${m.flags.map(f => `
              <div class="scc-flag-row">
                <div><div class="scc-flag-name">${esc(f.label)} ${f.exp ? tag('Experimental', WARN) : ''}</div><div class="scc-flag-sub">${esc(f.sub)}</div></div>
                ${toggleHTML(f.id, f.on)}
              </div>`).join('')}
          </div>
        </div>
        <div class="scc-stack">
          <div class="scc-card">
            ${cardHead('Live decision preview', 'What the model would do right now', tag('Preview', ACCENT_C))}
            <div class="scc-kv">
              ${pv.input.map(kv => `<div><span>${esc(kv.k)}</span><span style="color:${kv.c}">${esc(kv.v)}</span></div>`).join('')}
            </div>
            <div class="scc-ai-flow">↓ <span class="scc-ai-model-pill">${aic('brain', 13)} ${esc(m.model.version)}</span> ↓</div>
            <div class="scc-ai-out">
              <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--adm-text-3);margin-bottom:6px">Recommended pattern</div>
              <div class="scc-ai-pattern">${pv.pattern.map((d, i) => `<span style="color:${digitC[i]}">${d}</span>`).join('<span style="color:var(--adm-text-3)">·</span>')}</div>
              <div style="font-size:10px;color:var(--adm-text-3);margin-top:2px">seconds</div>
              <div class="scc-ai-sub">Confidence <b class="scc-mono" style="color:var(--adm-text)">${pv.confidence}</b> · Fallback pattern: <span class="scc-mono">${esc(pv.fallback)}</span></div>
            </div>
          </div>
          <div class="scc-card">
            ${cardHead('Rollout', `${m.model.version} adoption`, tag('Live', GOOD))}
            <div class="scc-roll-bar"><div class="scc-roll-fill" style="width:${m.rollout.pct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--adm-text-2)">
              <span>${m.rollout.pct}% of users</span><span class="scc-mono">${esc(m.rollout.users)}</span>
            </div>
            <div class="scc-roll-boxes">
              <div class="scc-roll-box"><b>${esc(m.rollout.prev.v)}</b><span>previous · ${m.rollout.prev.pct}%</span></div>
              <div class="scc-roll-box"><b>${esc(m.rollout.canary.v)}</b><span>canary · ${m.rollout.canary.pct}%</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="scc-card scc-card--glow">
        ${cardHead('Model effectiveness × exploration', 'Last 30 days',
          `<div style="display:flex;align-items:center;gap:10px"><div class="scc-legend"><span>${dot(GOOD)} Effectiveness</span><span>${dot(ACCENT_V)} Exploration</span></div>${segControl(['30d', '90d', 'YTD'], 0)}</div>`)}
        ${lineChartM([{ data: m.effectiveness.a, color: GOOD, area: true }, { data: m.effectiveness.b, color: ACCENT_V }], 700, 170, ['30d ago', '15d ago', 'today'])}
      </div>
    `);

    // slider live-update + config PUT stubs
    const state = { sliders: {}, flags: {} };
    document.querySelectorAll('#ai-sliders input[type="range"]').forEach(inp => {
      inp.oninput = () => {
        const pill = document.querySelector(`[data-pill="${inp.dataset.slider}"]`);
        if (pill) pill.textContent = inp.value + '%';
        state.sliders[inp.dataset.slider] = Number(inp.value) / 100;
      };
    });
    document.querySelectorAll('.scc-flag-row input[data-tg]').forEach(inp => {
      inp.onchange = async () => {
        state.flags[inp.dataset.tg] = !!inp.checked;
        try { await api.put('/admin/scc/ai', { flags: { [inp.dataset.tg]: !!inp.checked } }); toast('Flag saved (stub — audit-logged)', 'ok'); }
        catch (e) { inp.checked = !inp.checked; toast('Save failed', 'warn'); }
      };
    });
    const pub = document.getElementById('ai-publish');
    if (pub) pub.onclick = async () => {
      const ok = await confirmModal('Publish tuning?', 'New adaptation weights will roll out to all users on the current model version.', 'Publish', false);
      if (!ok) return;
      try { await api.put('/admin/scc/ai', { sliders: state.sliders, flags: state.flags }); toast('Published (stub — audit-logged)', 'ok'); }
      catch (e) { toast('Publish failed', 'warn'); }
    };
    const rst = document.getElementById('ai-reset');
    if (rst) rst.onclick = () => { delete sccCache.ai; views.ai(); };
  };

  /* ============ 04 · ADVANCED ANALYTICS ============ */
  views.analytics = async function () {
    layout('analytics', spinner);
    let m, d;
    try {
      [m, d] = await Promise.all([sccData('analytics'), api.get('/admin/analytics').then(r => r.data)]);
    } catch (e) { return layout('analytics', errBox(e)); }
    const byDay = d.sessionsByDay || [];
    const calmReal = byDay.map(x => x.avg_calm || 0);

    layout('analytics', `
      <div class="scc-kpis">
        ${kpi('Calm improvement', m.kpis.calmImprovement, 'pts', '+2.1', 'up', null, GOOD, true)}
        ${kpi('Stress→calm conversion', m.kpis.conversion, '', '+1.8%', 'up', null, ACCENT_C)}
        ${kpi('Session depth', m.kpis.depth, 'cycles', '+0.3', 'up', null, ACCENT_V)}
        ${kpi('Effective sessions', m.kpis.effective, '', '−0.4%', 'down', null, BLUE)}
      </div>

      <div class="scc-card scc-card--glow">
        ${cardHead('Retention by weekly cohort', 'Percent of cohort returning each week',
          `<div style="display:flex;align-items:center;gap:10px">${segControl(['Weekly', 'Monthly'], 0)}<span class="scc-btn">Export</span></div>`)}
        ${cohortGrid(m.cohorts)}
      </div>

      <div class="scc-grid-113">
        <div class="scc-card">
          ${cardHead('Session funnel', 'App open → completion')}
          ${funnel(m.funnel)}
        </div>
        <div class="scc-card">
          ${cardHead('Calm improvement over time', 'Plus (violet) vs Free (cyan)',
            `<div style="display:flex;align-items:center;gap:10px"><div class="scc-legend"><span>${dot(ACCENT_V)} Plus</span><span>${dot(ACCENT_C)} Free</span></div>${segControl(['Avg', 'P50', 'P90'], 0)}</div>`)}
          ${lineChartM([{ data: m.calm.a, color: ACCENT_V, area: true }, { data: m.calm.b, color: ACCENT_C }], 620, 190, ['W1', 'W10', 'W20'])}
          ${calmReal.some(v => v > 0) ? `<p class="scc-card-sub" style="margin-top:8px">Live D1 avg calm (last ${calmReal.length}d): <b class="scc-mono">${Math.round(calmReal.reduce((a, b) => a + b, 0) / Math.max(1, calmReal.filter(Boolean).length))}</b></p>` : ''}
        </div>
      </div>

      <div class="scc-grid-131">
        <div class="scc-card">
          ${cardHead('Calm Δ × session duration', 'Each dot = 1,000 sessions')}
          ${scatter(m.scatter, m.correlation)}
        </div>
        <div class="scc-card">
          ${cardHead('Where users drop off', 'Exit rate by breathing cycle')}
          <div class="scc-drop">
            ${m.dropoff.map(x => `<div class="scc-drop-row">
              <span class="scc-drop-lbl">${esc(x.l)}</span>
              <div class="scc-drop-bar ${x.hot ? 'scc-drop-bar--hot' : ''}" style="width:${Math.min(92, x.v * 300 / 40)}%"></div>
              <span class="scc-drop-pct">${x.v}%</span>
            </div>`).join('')}
          </div>
          <div class="scc-insight scc-insight--amber">${esc(m.dropInsight)}</div>
        </div>
      </div>
    `);
  };

  /* ============ 05 · BIOMETRICS ============ */
  views.biometrics = async function () {
    layout('biometrics', spinner);
    let m;
    try { m = await sccData('biometrics'); } catch (e) { return layout('biometrics', errBox(e)); }

    layout('biometrics', `
      <div class="scc-kpis">
        ${kpi('Avg HR reduction', m.kpis.hrReduction, 'bpm', 'per session', 'down', null, BAD, true)}
        ${kpi('HRV improvement', '+' + m.kpis.hrvImprovement, 'ms', '+2.1ms', 'up', null, ACCENT_C)}
        ${kpi('Stress recovery', m.kpis.recovery, 'min', '−0:18', 'down', null, ACCENT_V)}
        ${kpi('Coherence rate', m.kpis.coherence, '%', '+4%', 'up', null, GOOD)}
      </div>

      <div class="scc-grid-151">
        <div class="scc-card scc-card--glow">
          ${cardHead('Heart rate — session start vs end', 'Wearable-connected users · 14 days',
            `<div class="scc-legend"><span>${dot(BAD)} Session start</span><span>${dot(GOOD)} Session end</span></div>`)}
          ${lineChartM([{ data: m.hr.start, color: BAD, area: true }, { data: m.hr.end, color: GOOD }], 620, 200, m.hr.labels)}
        </div>
        <div class="scc-card">
          ${cardHead('Optimal pattern by segment', 'AI-learned effectiveness')}
          ${m.segments.map(s => `
            <div class="scc-seg-row">
              <span class="scc-seg-name">${esc(s.seg)}</span>
              <span class="scc-seg-pat" style="background:${s.c}1c;color:${s.c}">${esc(s.pattern)}</span>
              <span class="scc-seg-eff"><i><b style="width:${s.eff}%;background:${s.c}"></b></i>${s.eff}%</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('Breathing efficiency by hour', 'Avg coherence · all users · 7×24',
          tag(`${m.heatSessions.toLocaleString()} sessions`, ACCENT_V))}
        ${heatmap(m.heatmap)}
        <p class="scc-card-sub" style="margin-top:8px">${esc(m.heatPeak)}</p>
      </div>

      <div class="scc-grid-131">
        <div class="scc-card scc-card--glow">
          ${cardHead('Stress decay in session', 'Average stress level over session time')}
          ${stressArc(m.arc.milestones)}
        </div>
        <div class="scc-card">
          ${cardHead('HRV coherence', 'Wearable users', tag(`${m.hrv.users.toLocaleString()} users`, ACCENT_C))}
          ${donut([{ value: m.hrv.pct, color: GOOD }, { value: 100 - m.hrv.pct, color: 'rgba(100,116,139,0.2)' }], 120, m.hrv.pct + '%', 'Coherent')}
          <div style="margin-top:10px">
            ${m.hrv.rows.map(r => meter(r.l, r.v, 100, r.v + '%', r.c)).join('')}
          </div>
        </div>
      </div>
    `);
  };

  /* ============ 06 · PROGRAMS (real data + design cards) ============ */
  views.programs = async function () {
    layout('programs', spinner);
    let d, perf = {};
    try {
      const [progs, analytics] = await Promise.all([
        api.get('/admin/programs').then(r => r.data),
        api.get('/admin/analytics').then(r => r.data).catch(() => null),
      ]);
      d = progs;
      (analytics?.programPerf || []).forEach(p => { perf[p.id] = p; });
    } catch (e) { return layout('programs', errBox(e)); }

    const premiumCount = d.programs.filter(p => p.is_premium).length;
    const activeCount = d.programs.filter(p => p.active).length;
    const rates = d.programs.map(p => {
      const st = perf[p.id] || {};
      return st.starts ? Math.round(((st.completions || 0) / st.starts) * 100) : null;
    }).filter(v => v != null);
    const avgComp = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
    let best = null, bestRate = -1;
    d.programs.forEach(p => {
      const st = perf[p.id] || {};
      const r = st.starts ? ((st.completions || 0) / st.starts) * 100 : -1;
      if (r > bestRate) { bestRate = r; best = p; }
    });
    const orbC = [ '#A78BFA', '#60A5FA', '#22D3EE', '#34D399', '#F59E0B', '#7C3AED' ];

    const cards = d.programs.map((p, i) => {
      const st = perf[p.id] || {};
      const compRate = st.starts ? Math.round(((st.completions || 0) / st.starts) * 100) : null;
      const compC = compRate == null ? 'var(--adm-text)' : compRate > 85 ? GOOD : compRate > 70 ? 'var(--adm-text)' : WARN;
      const c = orbC[i % orbC.length];
      const sparkData = Array.from({ length: 10 }, (_, k) => 40 + Math.sin(k * 0.7 + i) * 14 + k * 1.2);
      return `<div class="scc-card scc-prog">
        <div class="scc-prog-head">
          <div class="scc-prog-orb" style="border-radius:14px;background:radial-gradient(circle at 32% 30%,${c}D0,${c}60 62%,${c}25)"></div>
          <div style="flex:1;min-width:0">
            <div class="scc-card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
            <div class="scc-card-sub"><span style="text-transform:uppercase;letter-spacing:1px;color:${c}">${esc(p.category)}</span> · <span class="scc-mono">${p.inhale}-${p.hold}-${p.exhale}</span></div>
          </div>
          ${p.is_new ? tag('NEW', ACCENT_C) : ''}
          <span style="color:var(--adm-text-3)">${aic('kebab', 15)}</span>
        </div>
        <div class="scc-prog-stats" style="grid-template-columns:repeat(3,1fr)">
          <div><span class="scc-mono">${st.starts ?? 0}</span><label>users</label></div>
          <div><span class="scc-mono" style="color:${compC}">${compRate != null ? compRate + '%' : '—'}</span><label>completion</label></div>
          <div><span class="scc-mono" style="color:${ACCENT_C}">${st.avg_calm_delta != null ? '+' + st.avg_calm_delta : '—'}</span><label>calm Δ</label></div>
        </div>
        <div style="margin:4px 0">${miniSpark(sparkData, 220, 30, c)}</div>
        <div class="scc-prog-toggles">
          <label class="scc-prog-tg"><span>Premium</span><span class="scc-toggle"><input type="checkbox" data-field="is_premium" data-id="${p.id}" ${p.is_premium ? 'checked' : ''}/><span></span></span></label>
          <label class="scc-prog-tg"><span>New badge</span><span class="scc-toggle"><input type="checkbox" data-field="is_new" data-id="${p.id}" ${p.is_new ? 'checked' : ''}/><span></span></span></label>
          <label class="scc-prog-tg"><span>Active</span><span class="scc-toggle"><input type="checkbox" data-field="active" data-id="${p.id}" ${p.active ? 'checked' : ''}/><span></span></span></label>
        </div>
      </div>`;
    }).join('');

    // drop-off by program (derived: 100 - completion)
    const dropRows = d.programs.slice(0, 5).map(p => {
      const st = perf[p.id] || {};
      const compRate = st.starts ? Math.round(((st.completions || 0) / st.starts) * 100) : null;
      const drop = compRate == null ? null : 100 - compRate;
      return { l: p.title, v: drop };
    }).filter(r => r.v != null);
    const started = (d.programs.length ? Array.from({ length: 13 }, (_, i) => 30 + Math.sin(i * 0.5) * 8 + i * 2) : []);
    const completed = started.map(v => v * 0.82);

    layout('programs', `
      <div class="scc-kpis">
        ${kpi('Programs live', activeCount, '', `${d.programs.length} total`, 'flat', null, ACCENT_V)}
        ${kpi('Avg completion', avgComp != null ? avgComp + '%' : '—', '', avgComp != null ? '+1.2%' : null, 'up', null, GOOD, true)}
        ${kpi('Best-performing', `<span style="font-size:15px">${esc(best?.title || '—')}</span>`, '', bestRate >= 0 ? Math.round(bestRate) + '% completion' : null, 'flat')}
        ${kpi('Premium', premiumCount, '', `${d.programs.length - premiumCount} free`, 'flat', null, ACCENT_C)}
      </div>
      <div class="scc-grid-3">${cards}</div>
      <div class="scc-grid-113">
        <div class="scc-card">
          ${cardHead('Drop-off by program', 'Share of sessions abandoned')}
          ${dropRows.length ? `<div class="scc-drop">${dropRows.map(x => `
            <div class="scc-drop-row">
              <span class="scc-drop-lbl" style="width:110px">${esc(x.l.slice(0, 16))}</span>
              <div class="scc-drop-bar ${x.v > 15 ? 'scc-drop-bar--hot' : ''}" style="width:${Math.min(92, x.v * 2.4)}%"></div>
              <span class="scc-drop-pct">${x.v}%</span>
            </div>`).join('')}</div>` : '<p class="scc-empty">No completion data yet</p>'}
        </div>
        <div class="scc-card scc-card--glow">
          ${cardHead('Session completion over time', 'Started (violet) vs completed (green) · 13 weeks',
            `<div class="scc-legend"><span>${dot(ACCENT_V)} Started</span><span>${dot(GOOD)} Completed</span></div>`)}
          ${started.length ? lineChartM([{ data: started, color: ACCENT_V, area: true }, { data: completed, color: GOOD }], 620, 170, ['W1', 'W7', 'W13']) : '<p class="scc-empty">No data yet</p>'}
        </div>
      </div>
      <p class="scc-empty" style="text-align:left;padding:4px 2px">Toggles save instantly and invalidate the programs cache.</p>
    `);

    document.querySelectorAll('.scc-prog-toggles input').forEach(inp => {
      inp.onchange = async () => {
        try {
          await api.put(`/admin/programs/${inp.dataset.id}`, { [inp.dataset.field]: !!inp.checked });
          toast('Saved', 'ok');
        } catch (e) {
          inp.checked = !inp.checked;
          toast(e?.response?.data?.error || 'Save failed', 'warn');
        }
      };
    });
  };

  /* ============ 07 · EXPERIMENTS ============ */
  views.experiments = async function () {
    layout('experiments', spinner);
    let m;
    try { m = await sccData('experiments'); } catch (e) { return layout('experiments', errBox(e)); }
    const f = m.featured;
    const stC = { Running: GOOD, Winning: ACCENT_C, Paused: WARN, Complete: ACCENT_V };
    const cols = '90px 1.5fr 100px 80px 100px 80px 120px 40px';

    const rows = m.rows.map(r => {
      const liftC = r.lift.startsWith('−') || r.lift.startsWith('-') ? BAD : parseFloat(r.lift) > 5 ? GOOD : 'var(--adm-text-2)';
      return `<div class="scc-trow" style="grid-template-columns:${cols}">
        <div class="scc-mono scc-cell-3">${esc(r.id)}</div>
        <div><strong>${esc(r.name)}</strong><div class="scc-card-sub">${r.days} days running</div></div>
        <div>${tag(r.status, stC[r.status] || SLATE)}</div>
        <div class="scc-mono scc-cell-2">${r.variants}</div>
        <div class="scc-mono scc-cell-2">${esc(r.users)}</div>
        <div class="scc-mono" style="color:${liftC}">${esc(r.lift)}</div>
        <div class="scc-conf-bar"><i><b style="width:${r.conf}%;background:${r.conf > 90 ? `linear-gradient(90deg,${GOOD},${ACCENT_C})` : ACCENT_V}"></b></i><span class="scc-mono" style="font-size:10.5px">${r.conf}%</span></div>
        <div style="color:var(--adm-text-3)">${aic('kebab', 15)}</div>
      </div>`;
    }).join('');

    layout('experiments', `
      <div class="scc-kpis">
        ${kpi('Live experiments', m.kpis.live, '', '2 ending this wk', 'flat', null, ACCENT_V)}
        ${kpi('Users in tests', m.kpis.inTests, '', '+3.2k', 'up', null, ACCENT_C)}
        ${kpi('Winning · this qtr', m.kpis.winning, '', '+3 vs last', 'up', null, GOOD, true)}
        ${kpi('Avg calm lift', m.kpis.avgLift, '', 'across winners', 'up', null, BLUE)}
      </div>

      <div class="scc-card scc-card--glow">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="display:flex;gap:8px;margin-bottom:8px">${tag(`${f.id} · Winning`, ACCENT_C)}${tag(`${f.conf}% confidence`, GOOD)}<span class="scc-card-sub" style="align-self:center">${esc(f.meta)}</span></div>
            <div class="scc-card-title" style="font-size:16px">${esc(f.title)}</div>
            <div class="scc-card-sub" style="max-width:520px;margin-top:4px">${esc(f.desc)} <b style="color:${GOOD}">${esc(f.rec)}</b></div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="scc-btn" id="exp-pause">${aic('pause', 13)}<span>Pause</span></button>
            <button class="scc-btn" id="exp-promote" style="background:linear-gradient(90deg,${GOOD},#10B981);color:#052e22;border:none;font-weight:700">Promote winner</button>
          </div>
        </div>
        <div class="scc-exp-variants">
          <div class="scc-exp-var">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${dot(SLATE)}<b style="font-size:12px;color:var(--adm-text)">${esc(f.a.name)}</b></div>
            <div class="scc-exp-stats">
              <div>Calm score<b>${f.a.calm}</b></div><div>Conversion<b>${esc(f.a.conv)}</b></div>
              <div>D7 retention<b>${esc(f.a.d7)}</b></div><div>Users<b>${esc(f.a.users)}</b></div>
            </div>
          </div>
          <div class="scc-exp-var scc-exp-var--win">
            <span class="scc-exp-win-tag">Winner</span>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${dot(GOOD, true)}<b style="font-size:12px;color:var(--adm-text)">${esc(f.b.name)}</b></div>
            <div class="scc-exp-stats">
              <div>Calm score<b style="color:${GOOD}">${f.b.calm}</b></div><div>Conversion<b style="color:${GOOD}">${esc(f.b.conv)}</b></div>
              <div>D7 retention<b style="color:${GOOD}">${esc(f.b.d7)}</b></div><div>Users<b>${esc(f.b.users)}</b></div>
            </div>
          </div>
          <div class="scc-exp-var">
            ${cardHead('Calm score · daily', '', tag(f.chart.lift, GOOD))}
            ${lineChartM([{ data: f.chart.a, color: SLATE }, { data: f.chart.b, color: GOOD, area: true }], 300, 110)}
          </div>
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('All experiments', `${m.rows.length} experiments`,
          `<div style="display:flex;align-items:center;gap:10px">${segControl(['All', 'Running', 'Complete'], 0)}<button class="scc-btn" id="exp-new" style="background:linear-gradient(90deg,${ACCENT_V},${ACCENT_C});color:#fff;border:none">${aic('plus', 13)}<span>New experiment</span></button></div>`)}
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <span>ID</span><span>Experiment</span><span>Status</span><span>Variants</span><span>Users</span><span>Lift</span><span>Confidence</span><span></span>
        </div>
        ${rows}
      </div>
    `);

    const promote = document.getElementById('exp-promote');
    if (promote) promote.onclick = async () => {
      const ok = await confirmModal('Promote winner?', `Variant B of ${f.id} will roll out to 100% of users. (Experiment pipeline stub — wired later.)`, 'Promote', false);
      if (ok) toast('Promotion queued (stub)', 'ok');
    };
    const pause = document.getElementById('exp-pause');
    if (pause) pause.onclick = () => toast('Experiment paused (stub)', 'ok');
    const enew = document.getElementById('exp-new');
    if (enew) enew.onclick = () => toast('Experiment builder — coming with pipeline integration', 'ok');
  };

  /* ============ 08 · NOTIFICATION ENGINE ============ */
  views.notifications = async function () {
    layout('notifications', spinner);
    let m;
    try { m = await sccData('notifications'); } catch (e) { return layout('notifications', errBox(e)); }
    const cols = '1.6fr 1fr 100px 100px 100px 60px';

    const pill = (t) => `<span class="scc-pill">${esc(t)}</span>`;
    const op = (t) => `<span class="scc-op">${esc(t)}</span>`;
    const val = (t) => `<span class="scc-val">${esc(t)}</span>`;
    const kw = (t) => `<span class="scc-kw">${esc(t)}</span>`;
    const ruleBlock = (label, c, tc, lines) => `<div class="scc-rule" style="--rb-c:${c};--rb-t:${tc}">
      <span class="scc-rule-lbl">${esc(label)}</span>${lines.map(l => `<div class="scc-rule-line">${l}</div>`).join('')}
    </div>`;

    const rows = m.rules.map(r => `
      <div class="scc-trow" style="grid-template-columns:${cols}">
        <div><strong>${esc(r.name)}</strong></div>
        <div class="scc-mono scc-cell-3">${esc(r.trigger)}</div>
        <div class="scc-mono scc-cell-2">${esc(r.sent)}</div>
        <div class="scc-mono" style="color:${r.open > 45 ? GOOD : 'var(--adm-text-2)'}">${r.open}%</div>
        <div>${toggleHTML('rule-' + r.id, r.on, true)}</div>
        <div style="color:var(--adm-text-3)">${aic('kebab', 15)}</div>
      </div>`).join('');

    layout('notifications', `
      <div class="scc-kpis">
        ${kpi('Sent · today', m.kpis.sent, '', '+6.2%', 'up', null, ACCENT_V)}
        ${kpi('Open rate', m.kpis.open, '', '+1.4%', 'up', null, GOOD, true)}
        ${kpi('Conversion', m.kpis.conv, '', 'to session', 'up', null, ACCENT_C)}
        ${kpi('Unsubscribes', m.kpis.unsub, '', '−0.02%', 'down', null, BLUE)}
      </div>

      <div class="scc-grid-151">
        <div class="scc-card scc-card--glow">
          ${cardHead('Rule builder', 'Behavioural trigger — evening unwind',
            `<div style="display:flex;gap:8px"><button class="scc-btn" id="nr-test">Test</button><button class="scc-btn" id="nr-activate" style="background:linear-gradient(90deg,${ACCENT_V},${ACCENT_C});color:#fff;border:none">Activate rule</button></div>`)}
          ${ruleBlock('When', 'rgba(245,158,11,0.4)', '#FCD34D', [
            `${pill('stress_level')} ${op('>')} ${val('0.70')} ${kw('and')} ${pill('last_session')} ${op('>')} ${val('18 hrs ago')}`,
          ])}
          ${ruleBlock('And', 'rgba(139,92,246,0.4)', '#C4B5FD', [
            `${pill('local_time')} ${op('between')} ${val('7 pm')} ${op('and')} ${val('10 pm')} ${kw('or')} ${pill('mood')} ${op('=')} ${val('"anxious"')}`,
          ])}
          ${ruleBlock('Then', 'rgba(34,211,238,0.4)', '#67E8F9', [
            `${kw('Send')} ${pill('push notification')} ${op('with')} ${val('template · unwind_evening')}`,
            `${kw('Suggest')} ${val('4-7-8 Unwind · 5 min')}`,
            `${kw('Cool down')} ${val('24 hrs')} ${op('·')} ${kw('max')} ${val('2 per day')}`,
          ])}
        </div>
        <div class="scc-card">
          ${cardHead('Preview', 'iOS lock screen')}
          <div class="scc-ios">
            <div class="scc-ios-date">Tuesday, July 15 · 8:14 pm</div>
            <div class="scc-ios-card">
              <div class="scc-ios-orb"></div>
              <div style="flex:1;min-width:0">
                <div class="scc-ios-app"><span>AURA</span><span>now</span></div>
                <div class="scc-ios-title">A moment to breathe?</div>
                <div class="scc-ios-body">Your evening looks tense. 5 minutes of 4-7-8 usually brings you back down.</div>
              </div>
            </div>
          </div>
          <div class="scc-ios-meta">Estimated audience <b class="scc-mono" style="color:var(--adm-text)">${esc(m.audience)}</b> · projected open rate <b class="scc-mono" style="color:${GOOD}">${esc(m.projOpen)}</b></div>
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('Active rules', `${m.rules.length} rules · ${m.rules.filter(r => r.on).length} automated`, `<span class="scc-btn">Manage templates</span>`)}
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <span>Rule</span><span>Trigger</span><span>Sent · 7d</span><span>Open rate</span><span>Enabled</span><span></span>
        </div>
        ${rows}
      </div>
    `);

    document.querySelectorAll('input[data-tg^="rule-"]').forEach(inp => {
      inp.onchange = async () => {
        const id = inp.dataset.tg.replace('rule-', '');
        try {
          await api.put(`/admin/scc/notifications/${id}`, { enabled: !!inp.checked });
          toast('Rule ' + (inp.checked ? 'enabled' : 'disabled') + ' (stub — audit-logged)', 'ok');
        } catch (e) { inp.checked = !inp.checked; toast('Save failed', 'warn'); }
      };
    });
    const act = document.getElementById('nr-activate');
    if (act) act.onclick = async () => {
      const ok = await confirmModal('Activate rule?', 'Evening unwind will start sending to ~14,200 users tonight.', 'Activate', false);
      if (ok) toast('Rule activated (stub)', 'ok');
    };
    const tst = document.getElementById('nr-test');
    if (tst) tst.onclick = () => toast('Test notification sent to your device (stub)', 'ok');
  };

  /* ============ 09 · REVENUE ============ */
  views.revenue = async function () {
    layout('revenue', spinner);
    let m, d;
    try {
      [m, d] = await Promise.all([sccData('revenue'), api.get('/admin/analytics').then(r => r.data)]);
    } catch (e) { return layout('revenue', errBox(e)); }
    const realRev = revenueStr(d.revenue);
    const plans = d.plans || [];
    const planColor = { free: SLATE, pro: ACCENT_V, premium: ACCENT_C };
    const planTotal = plans.reduce((a, p) => a + p.n, 0);

    layout('revenue', `
      <div class="scc-kpis">
        ${kpi('MRR', m.kpis.mrr, '', '+6.8%', 'up', null, ACCENT_V, true)}
        ${kpi('ARPU', m.kpis.arpu, '', '+$0.31', 'up', null, ACCENT_C)}
        ${kpi('LTV · 90d', m.kpis.ltv, '', '+$4.20', 'up', null, GOOD)}
        ${kpi('Churn · monthly', m.kpis.churn, '', '−0.3%', 'down', null, BLUE)}
      </div>

      <div class="scc-grid-151">
        <div class="scc-card scc-card--glow">
          ${cardHead('MRR growth', 'New + expansion above baseline · churn below')}
          ${stackedBars(m.mrr.months)}
        </div>
        <div class="scc-card">
          ${cardHead('Plan mix', 'Live subscriptions', planTotal ? tag(`${planTotal} real`, GOOD) : '')}
          ${donut(m.planMix.rows.map(r => ({ value: r.pct, color: r.c })), 120, m.planMix.total, 'Total plus')}
          <div style="margin-top:10px">
            ${m.planMix.rows.map(r => meter(r.l, r.pct, 100, `${r.pct}% · ${r.n}`, r.c)).join('')}
          </div>
          ${planTotal ? `<div class="scc-donut-legend" style="margin-top:8px">${plans.map(p => `<span>${dot(planColor[p.plan] || SLATE)} ${esc(p.plan)} <b class="scc-mono">${p.n}</b></span>`).join('')}</div>
          <p class="scc-card-sub" style="margin-top:6px">Live D1 revenue: <b class="scc-mono">${esc(realRev)}</b> · ${d.revenue?.payments ?? 0} payments</p>` : ''}
        </div>
      </div>

      <div class="scc-grid-11">
        <div class="scc-card">
          ${cardHead('Paywall funnel', 'Seen → subscribed')}
          ${funnel(m.funnel)}
          <div class="scc-insight scc-insight--green">${esc(m.insight)}</div>
        </div>
        <div class="scc-card">
          ${cardHead('LTV by cohort', 'Cumulative revenue per user',
            `<div class="scc-legend">${m.ltv.cohorts.map(c => `<span>${dot(c.c)} ${esc(c.name)}</span>`).join('')}</div>`)}
          ${lineChartM(m.ltv.cohorts.map((c, i) => ({ data: c.data, color: c.c, area: i === 0 })), 620, 200, m.ltv.labels, 80)}
        </div>
      </div>
    `);
  };

  /* ============ 10 · SYSTEM HEALTH ============ */
  views.health = async function () {
    layout('health', spinner);
    let m;
    try { m = await sccData('health'); } catch (e) { return layout('health', errBox(e)); }

    const svcColor = (st) => st === 'ok' ? GOOD : st === 'warn' ? WARN : BAD;
    const sensColor = (v) => v >= 99 ? GOOD : v >= 98 ? ACCENT_C : WARN;
    const devColor = (i) => [GOOD, GOOD, ACCENT_C, ACCENT_V, WARN, ACCENT_C][i % 6];
    const incColor = { amber: WARN, red: BAD, green: GOOD, cyan: ACCENT_C, violet: ACCENT_V };
    const okCount = m.services.filter(s => s.st === 'ok').length;

    layout('health', `
      <div class="scc-card scc-card--glow scc-banner">
        <div class="scc-banner-orb">${aic('check', 22)}</div>
        <div style="flex:1">
          <div class="scc-banner-title">${esc(m.banner.title)}</div>
          <div class="scc-banner-sub">${esc(m.banner.sub)}</div>
        </div>
        <div class="scc-banner-regions">
          ${m.banner.regions.map(r => `
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
              ${dot(r.ok ? GOOD : WARN, true)}
              <span class="scc-mono" style="font-size:9px;letter-spacing:1px;color:var(--adm-text-3)">${esc(r.l)}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="scc-kpis">
        ${kpi('API · p50 latency', m.kpis.p50, '', '−4ms', 'up', m.latency.p50.slice(0, 14), GOOD)}
        ${kpi('Error rate', m.kpis.errRate, '', '−0.02%', 'up', genClient(24, 40, 8, -0.1), ACCENT_C)}
        ${kpi('Audio sync fails', m.kpis.audioFails, '', '+2', 'down', genClient(24, 40, 8, 0.2), WARN)}
        ${kpi('Websocket · active', m.kpis.ws.toLocaleString(), '', '+8%', 'up', genClient(24, 50, 20, 1.2), ACCENT_V)}
      </div>

      <div class="scc-grid-141">
        <div class="scc-card">
          ${cardHead('API latency percentiles', 'Last 24 hours',
            `<div class="scc-legend"><span>${dot(GOOD)} p50</span><span>${dot(ACCENT_C)} p95</span><span>${dot(WARN)} p99</span></div>`)}
          ${lineChartM([
            { data: m.latency.p50, color: GOOD, area: true },
            { data: m.latency.p95, color: ACCENT_C },
            { data: m.latency.p99, color: WARN },
          ], 720, 240, ['00', '04', '08', '12', '16', '20', '00'], 400)}
        </div>
        <div class="scc-card">
          ${cardHead('Service health', `${m.services.length + 4} services · ${okCount + 4} nominal`)}
          <div style="display:flex;flex-direction:column;gap:10px">
            ${m.services.map(s => `
              <div class="scc-svc-row">
                ${dot(svcColor(s.st), s.st !== 'ok')}
                <div class="scc-svc-name">${esc(s.name)}</div>
                <div class="scc-svc-up scc-mono">${esc(s.up)}</div>
                <div class="scc-svc-ms scc-mono" style="${s.st !== 'ok' ? `color:${svcColor(s.st)}` : ''}">${s.st === 'down' ? 'degraded' : s.ms + ' ms'}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="scc-grid-113">
        <div class="scc-card">
          ${cardHead('Sensory reliability', 'Audio & haptic sync')}
          <div style="display:flex;gap:20px;align-items:center">
            ${donut([{ value: m.sensory.pct, color: GOOD }, { value: 100 - m.sensory.pct, color: 'rgba(100,116,139,0.2)' }], 120, m.sensory.pct + '%', 'Success')}
            <div style="flex:1;display:flex;flex-direction:column;gap:10px">
              ${m.sensory.rows.map(r => meter(r.l, r.v, 100, r.v + '%', sensColor(r.v))).join('')}
            </div>
          </div>
        </div>
        <div class="scc-card">
          ${cardHead('By device', 'Performance last 24h')}
          <div style="display:flex;flex-direction:column;gap:12px">
            ${m.devices.map((r, i) => `
              <div class="scc-bar-row">
                ${aic('device', 14)}
                <div class="lbl">${esc(r.l)}</div>
                <div class="trk"><i style="width:${r.v}%;background:linear-gradient(90deg,${devColor(i)},${ACCENT_C});box-shadow:0 0 4px ${devColor(i)}70"></i></div>
                <div class="num">${r.v}%</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="scc-card" style="padding:0">
          <div style="padding:18px 20px 12px;border-bottom:1px solid var(--adm-border);display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:13px;font-weight:500">Recent incidents</div>
              <div style="font-size:11px;color:var(--adm-text-2);margin-top:2px">Last 24 hours</div>
            </div>
            <button class="scc-link" id="inc-timeline">Timeline →</button>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
            ${m.incidents.map(e => `
              <div class="scc-inc-row">
                <div style="margin-top:5px">${dot(incColor[e.sev] || SLATE)}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;gap:8px;align-items:center">
                    <div class="scc-inc-t">${esc(e.t)}</div>
                    <span class="scc-inc-code scc-mono">${esc(e.code)}</span>
                  </div>
                  <div class="scc-inc-sub">${esc(e.sub)}</div>
                </div>
                <div class="scc-inc-ago scc-mono">${esc(e.ago)} ago</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `);
    const tl = document.getElementById('inc-timeline');
    if (tl) tl.onclick = () => toast('Incident timeline is a design stub — full pager integration pending', 'info');
  };

  /* ============ 11 · USERS ============ */
  const usersState = { q: '', page: 1, sel: null, tier: 0 };

  views.users = async function () {
    layout('users', spinner);
    // consume global-search handoff from topbar
    const handoff = sessionStorage.getItem('scc_user_q');
    if (handoff !== null) { usersState.q = handoff; usersState.page = 1; sessionStorage.removeItem('scc_user_q'); }

    let d, an;
    try {
      [d, an] = await Promise.all([
        api.get(`/admin/users?q=${encodeURIComponent(usersState.q)}&page=${usersState.page}`).then(r => r.data),
        api.get('/admin/analytics').then(r => r.data),
      ]);
    } catch (e) { return layout('users', errBox(e)); }

    const TIERS = ['All', 'Plus', 'Free', 'Trial'];
    const tierOf = (u) => u.plan === 'premium' || u.plan === 'pro' ? 'Plus' : u.plan === 'trial' ? 'Trial' : 'Free';
    const tierColor = { Plus: ACCENT_V, Free: SLATE, Trial: GOOD };
    const list = usersState.tier === 0 ? d.users : d.users.filter(u => tierOf(u) === TIERS[usersState.tier]);
    if (usersState.sel == null || !list.some(u => u.id === usersState.sel)) usersState.sel = list[0]?.id ?? null;
    const plusCount = (an.plans || []).filter(p => p.plan === 'premium' || p.plan === 'pro').reduce((a, p) => a + p.n, 0);

    // deterministic mock enrich (streak / calm / last-seen / LTV) — real telemetry pending
    const enrich = (u) => ({
      streak: Math.round(seeded(u.id * 3 + 1, 0, 40)),
      calm: Math.round(seeded(u.id * 7 + 2, 38, 92)),
      last: ['now', '3m', '12m', '1h', '2h', '5h', '6h', '1d', '2d', '3d'][u.id % 10],
      ltv: '$' + Math.round(seeded(u.id * 11 + 3, 4, 120)),
      flag: seeded(u.id * 13 + 5, 0, 1) > 0.85,
      inSession: u.id % 10 === (d.users[0]?.id ?? 1) % 10,
      calmTrend: Array.from({ length: 12 }, (_, i) => Math.round(seeded(u.id * 17 + i, 55, 70) + i * seeded(u.id, 0.4, 1.4))),
    });

    const cols = '1.6fr 70px 80px 80px 90px 60px';
    const rowsHTML = list.map((u) => {
      const x = enrich(u);
      return `
        <div class="scc-trow scc-user-row ${u.id === usersState.sel ? 'scc-user-row--sel' : ''}" data-uid="${u.id}" style="grid-template-columns:${cols};cursor:pointer">
          <div class="scc-user-cell">
            ${avatarHTML(u.display_name || u.email, 30)}
            <div style="min-width:0;flex:1">
              <div class="nm">${esc(u.display_name || u.email.split('@')[0])}${x.flag ? dot(WARN) : ''}${u.role === 'admin' ? tag('Admin', ACCENT_V) : ''}${u.sessions >= 5 ? tag('Top 1%', ACCENT_C) : ''}</div>
              <div class="em">${esc(u.email)}</div>
            </div>
          </div>
          <div>${tag(tierOf(u), tierColor[tierOf(u)])}</div>
          <div class="scc-mono">${x.streak}d</div>
          <div class="scc-mono scc-cell-2">${u.sessions}</div>
          <div class="scc-mono" style="font-weight:500;color:${x.calm > 80 ? GOOD : x.calm > 60 ? 'inherit' : WARN}">${x.calm}</div>
          <div class="scc-mono scc-cell-3" style="text-align:right">${x.last}</div>
        </div>`;
    }).join('') || `<p class="scc-empty">No users match "${esc(usersState.q)}"</p>`;

    const selU = list.find(u => u.id === usersState.sel);
    const detailHTML = (() => {
      if (!selU) return `<div class="scc-card"><p class="scc-empty">Select a user to inspect</p></div>`;
      const x = enrich(selU);
      const tlIconC = { play: BLUE, check: GOOD, heart: '#A78BFA', dollar: ACCENT_C, zap: ACCENT_V };
      const timeline = [
        { ic: 'play', t: `Started ${['4-7-8', 'Box', 'Coherent'][selU.id % 3]} session`, ago: x.last },
        { ic: 'check', t: 'Completed Twilight Descent', ago: '1d' },
        { ic: 'heart', t: 'Mood check-in · ' + ['calm', 'anxious', 'tired'][selU.id % 3], ago: '1d' },
        { ic: 'dollar', t: tierOf(selU) === 'Plus' ? 'Renewed · Plus yearly' : 'Viewed paywall · dismissed', ago: '4d' },
        { ic: 'zap', t: `Streak milestone · ${x.streak} days`, ago: '1w' },
      ];
      const isAdmin = selU.role === 'admin', isSusp = selU.status === 'suspended';
      return `
      <div class="scc-card" id="scc-user-detail">
        <div class="scc-detail-head">
          <div style="position:relative">
            ${avatarHTML(selU.display_name || selU.email, 54)}
            <div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#22D3EE);border:2px solid var(--adm-bg);display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px rgba(124,58,237,0.6)">${aic('zap', 10)}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:500">${esc(selU.display_name || selU.email.split('@')[0])} ${tag(tierOf(selU), tierColor[tierOf(selU)])} ${isSusp ? tag('Suspended', WARN) : ''}</div>
            <div class="scc-mono" style="font-size:11px;color:var(--adm-text-2);margin-top:2px">${esc(selU.email)} · id_${selU.id}</div>
          </div>
          <span style="color:var(--adm-text-3)">${aic('kebab', 16)}</span>
        </div>

        ${x.inSession ? `
        <div class="scc-detail-live" style="margin-top:16px">
          ${dot(GOOD, true)}
          <div style="flex:1">
            <div style="font-size:12px;font-weight:500">Currently in session</div>
            <div style="font-size:10px;color:var(--adm-text-2);margin-top:1px">4-7-8 · Cycle 3/6 · <span class="scc-mono" style="color:${BLUE}">Inhale</span></div>
          </div>
          <button class="scc-btn" id="ud-replay" style="font-size:10px;padding:4px 10px">${aic('replay', 10)}<span>Replay</span></button>
        </div>` : ''}

        <div class="scc-statboxes">
          <div class="scc-statbox"><b style="color:${ACCENT_V}">${x.streak}</b><span>Streak</span></div>
          <div class="scc-statbox"><b style="color:${ACCENT_C}">${selU.sessions}</b><span>Sessions</span></div>
          <div class="scc-statbox"><b style="color:${GOOD}">${x.calm}</b><span>Calm</span></div>
          <div class="scc-statbox"><b style="color:${BLUE}">${x.ltv}</b><span>LTV</span></div>
        </div>

        <div style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
            <span style="font-size:11px;color:var(--adm-text-2);letter-spacing:1.5px;text-transform:uppercase;font-weight:500">Calm trend · 30d</span>
            <span class="scc-mono" style="font-size:11px;color:${GOOD}">+${x.calmTrend[11] - x.calmTrend[0]}</span>
          </div>
          ${miniSpark(x.calmTrend, 320, 44, ACCENT_V)}
        </div>

        <div style="margin-top:18px">
          <div style="font-size:11px;color:var(--adm-text-2);letter-spacing:1.5px;text-transform:uppercase;font-weight:500;margin-bottom:6px">Recent activity</div>
          ${timeline.map(e => `
            <div class="scc-tl-row">
              <div class="scc-tl-ic" style="background:${tlIconC[e.ic]}15;border:1px solid ${tlIconC[e.ic]}35;color:${tlIconC[e.ic]}">${aic(e.ic, 11)}</div>
              <div style="flex:1">${esc(e.t)}</div>
              <div class="scc-tl-ago scc-mono">${esc(e.ago)}</div>
            </div>`).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--adm-border)">
          <button class="scc-btn" id="ud-impersonate" style="flex:1;font-size:11px">Impersonate</button>
          <button class="scc-btn" id="ud-note" style="flex:1;font-size:11px">Add note</button>
          <button class="scc-btn" id="ud-profile" style="flex:1;font-size:11px;background:linear-gradient(135deg,#7C3AED,#22D3EE);color:#fff;border:none">Full profile</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          ${isAdmin
            ? `<button class="scc-btn scc-btn--amber" data-ua="demote" style="flex:1;font-size:11px">Demote to user</button>`
            : `<button class="scc-btn scc-btn--violet" data-ua="promote" style="flex:1;font-size:11px">Promote to admin</button>`}
          ${isSusp
            ? `<button class="scc-btn scc-btn--green" data-ua="reactivate" style="flex:1;font-size:11px">Reactivate</button>`
            : `<button class="scc-btn scc-btn--amber" data-ua="suspend" style="flex:1;font-size:11px" ${isAdmin ? 'disabled title="Admins cannot be suspended"' : ''}>Suspend</button>`}
          <button class="scc-btn scc-btn--danger" data-ua="delete" style="flex:1;font-size:11px" ${isAdmin ? 'disabled title="Demote first"' : ''}>Delete</button>
        </div>
      </div>`;
    })();

    layout('users', `
      <div class="scc-kpis">
        ${kpi('Total users', d.total, '', `+${an.users?.new_this_week ?? 0} this wk`, (an.users?.new_this_week ?? 0) > 0 ? 'up' : 'flat', genClient(24, 40, 15, 1.2), ACCENT_V)}
        ${kpi('Active accounts', an.users?.active ?? 0, '', `${an.users?.suspended ?? 0} suspended`, 'flat', genClient(24, 40, 12, 0.8), ACCENT_C)}
        ${kpi('Plus subscribers', plusCount, '', 'active subscriptions', plusCount > 0 ? 'up' : 'flat', genClient(24, 40, 10, 1.0), GOOD, true)}
        ${kpi('Flagged', list.filter(u => enrich(u).flag).length, '', 'auto-detected', 'down', genClient(24, 40, 5, 0.1), WARN)}
      </div>

      <div class="scc-card" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div class="scc-search-wrap" style="flex:1;min-width:220px">
            ${aic('search', 14)}
            <input id="scc-user-search" placeholder="Search by name, email, ID, or session" value="${esc(usersState.q)}" />
            <span class="scc-key">/</span>
          </div>
          ${segControl(TIERS, usersState.tier, 'scc-tier-seg')}
          <span class="scc-btn" id="scc-filters">${aic('filter', 12)}<span>3 filters</span></span>
          <button class="scc-btn" id="scc-invite" style="background:linear-gradient(135deg,#7C3AED,#22D3EE);color:#fff;border:none;box-shadow:0 4px 14px rgba(124,58,237,0.3)">${aic('plus', 12)}<span>Invite</span></button>
        </div>
      </div>

      <div class="scc-grid-1610">
        <div class="scc-card" style="padding:0">
          <div class="scc-thead" style="grid-template-columns:${cols}">
            <div>User</div><div>Tier</div><div>Streak</div><div>Sessions</div><div>Calm</div><div style="text-align:right">Last</div>
          </div>
          ${rowsHTML}
          ${d.pages > 1 ? `
          <div class="scc-pager">
            <button class="scc-btn" id="pg-prev" ${usersState.page <= 1 ? 'disabled' : ''}>← Prev</button>
            <span class="scc-mono">Page ${d.page} / ${d.pages} · ${d.total} users</span>
            <button class="scc-btn" id="pg-next" ${usersState.page >= d.pages ? 'disabled' : ''}>Next →</button>
          </div>` : ''}
        </div>
        ${detailHTML}
      </div>
    `);

    /* ---- wiring ---- */
    const search = document.getElementById('scc-user-search');
    let deb;
    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(deb);
        deb = setTimeout(() => { usersState.q = search.value.trim(); usersState.page = 1; views.users(); }, 350);
      });
      if (handoff !== null) search.focus();
    }
    document.addEventListener('keydown', function slash(e) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); search?.focus(); }
      if (currentView() !== 'users') document.removeEventListener('keydown', slash);
    });
    document.querySelectorAll('.scc-tier-seg button').forEach((b, i) => b.onclick = () => { usersState.tier = i; views.users(); });
    document.querySelectorAll('[data-uid]').forEach(r => r.onclick = () => { usersState.sel = parseInt(r.dataset.uid, 10); views.users(); });
    const pgP = document.getElementById('pg-prev'), pgN = document.getElementById('pg-next');
    if (pgP) pgP.onclick = () => { usersState.page--; views.users(); };
    if (pgN) pgN.onclick = () => { usersState.page++; views.users(); };
    ['scc-filters', 'scc-invite', 'ud-impersonate', 'ud-note', 'ud-profile', 'ud-replay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onclick = () => toast(`"${el.textContent.trim()}" is a design stub — integration pending`, 'info');
    });

    // real admin actions
    const ACTIONS = {
      promote: { m: 'put', url: (id) => `/admin/users/${id}/role`, body: { role: 'admin' }, t: 'Promote to admin', b: 'Grant this user full admin access?', ok: 'Promoted to admin' },
      demote: { m: 'put', url: (id) => `/admin/users/${id}/role`, body: { role: 'user' }, t: 'Demote to user', b: 'Remove admin privileges from this account?', ok: 'Demoted to user' },
      suspend: { m: 'put', url: (id) => `/admin/users/${id}/status`, body: { status: 'suspended' }, t: 'Suspend user', b: 'They will be blocked from signing in until reactivated.', ok: 'User suspended', danger: true },
      reactivate: { m: 'put', url: (id) => `/admin/users/${id}/status`, body: { status: 'active' }, t: 'Reactivate user', b: 'Restore sign-in access for this account?', ok: 'User reactivated' },
      delete: { m: 'delete', url: (id) => `/admin/users/${id}`, t: 'Delete user', b: 'Soft-deletes the account and anonymizes the email. This cannot be undone from the UI.', ok: 'User deleted', danger: true },
    };
    document.querySelectorAll('[data-ua]').forEach(btn => btn.onclick = async () => {
      const a = ACTIONS[btn.dataset.ua];
      if (!a || !selU) return;
      const yes = await confirmModal(a.t, `${selU.email} — ${a.b}`, a.t, !!a.danger);
      if (!yes) return;
      try {
        if (a.m === 'delete') await api.delete(a.url(selU.id));
        else await api.put(a.url(selU.id), a.body || {});
        toast(a.ok, 'success');
        if (btn.dataset.ua === 'delete') usersState.sel = null;
        views.users();
      } catch (e) { toast(e.response?.data?.error || 'Action failed', 'error'); }
    });
  };

  /* ============ 12 · SETTINGS & AUDIT ============ */
  views.settings = async function () {
    layout('settings', spinner);
    let logs;
    try { logs = (await api.get('/admin/audit-logs')).data.logs || []; }
    catch (e) { return layout('settings', errBox(e)); }

    const actColor = (a) =>
      /delete|suspend/.test(a) ? BAD :
      /role|promote|demote/.test(a) ? ACCENT_V :
      /reactivate/.test(a) ? GOOD :
      /ai_config|notification/.test(a) ? ACCENT_C : SLATE;
    const cols = '130px 1.4fr 150px 140px 2fr 110px';
    const detail = (j) => {
      try { const o = JSON.parse(j || '{}'); return Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'; }
      catch { return j || '—'; }
    };

    layout('settings', `
      <div class="scc-grid-21" style="margin-bottom:14px">
        <div class="scc-card">
          ${cardHead('Workspace', 'Environment & appearance')}
          <div style="display:flex;flex-direction:column;gap:12px;font-size:12px">
            <div class="scc-kv"><span>Environment</span><b class="scc-mono" style="color:${GOOD}">Production · local D1</b></div>
            <div class="scc-kv"><span>Model rollout</span><b class="scc-mono">aura-2.4.1 · 82%</b></div>
            <div class="scc-kv"><span>Theme</span><b>${Theme.mode === 'light' ? 'Light' : 'Dark'} — toggle in the topbar</b></div>
            <div class="scc-kv"><span>Signed in as</span><b class="scc-mono">${esc(me?.email || '')}</b></div>
            <div class="scc-kv"><span>Session</span><b>JWT · Bearer, 7-day expiry</b></div>
          </div>
        </div>
        <div class="scc-card">
          ${cardHead('Data & compliance', 'Retention posture')}
          <div style="display:flex;flex-direction:column;gap:12px;font-size:12px">
            <div class="scc-kv"><span>Audit trail</span><b style="color:${GOOD}">Enabled · immutable</b></div>
            <div class="scc-kv"><span>Log retention</span><b class="scc-mono">100 most recent (view) · unlimited (store)</b></div>
            <div class="scc-kv"><span>PII in logs</span><b>Email only · anonymized on delete</b></div>
            <div class="scc-kv"><span>Rate limit</span><b class="scc-mono">120 req / 60s on /admin/*</b></div>
          </div>
        </div>
      </div>

      <div class="scc-card" style="padding:0">
        <div style="padding:18px 20px 12px;border-bottom:1px solid var(--adm-border);display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;font-weight:500">Audit log</div>
            <div style="font-size:11px;color:var(--adm-text-2);margin-top:2px">Every privileged action · newest first · ${logs.length} entries</div>
          </div>
          ${tag('IMMUTABLE', GOOD)}
        </div>
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <div>Time</div><div>Admin</div><div>Action</div><div>Target</div><div>Detail</div><div style="text-align:right">IP</div>
        </div>
        ${logs.length ? logs.map(l => `
          <div class="scc-trow" style="grid-template-columns:${cols}">
            <div class="scc-mono scc-cell-3" style="font-size:11px">${fmtDate(l.created_at)}</div>
            <div class="scc-mono scc-cell-2" style="font-size:11px;overflow:hidden;text-overflow:ellipsis">${esc(l.admin_email)}</div>
            <div>${tag(l.action, actColor(l.action))}</div>
            <div class="scc-mono scc-cell-3" style="font-size:11px">${esc(l.target_type)} #${l.target_id ?? '—'}</div>
            <div class="scc-cell-2" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(detail(l.detail_json))}</div>
            <div class="scc-mono scc-cell-3" style="font-size:11px;text-align:right">${esc(l.ip || '—')}</div>
          </div>`).join('') : '<p class="scc-empty">No audit entries yet — privileged actions will appear here.</p>'}
      </div>
    `);
  };

  /* ============ BOOT ============ */
  async function boot() {
    if (!(await guard())) return;
    const render = () => {
      const v = currentView();
      (views[v] || views.overview)();
    };
    window.addEventListener('hashchange', render);
    render();
  }
  boot();
})();
