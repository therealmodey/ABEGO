// AURA billing dashboard — current plan, payment history, cancel/upgrade
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, confirmModal, bgHTML, handleApiError } = window.Aura;
  const root = document.getElementById('app');

  async function load() {
    if (!AuraState.user) { location.href = '/#login'; return; }
    root.innerHTML = `${bgHTML()}<div class="screen" style="align-items:center;justify-content:center"><div class="orb-loading">${orbHTML(140, 'idle')}</div></div>`;
    let d;
    try { ({ data: d } = await api.get('/billing/me')); }
    catch (err) { handleApiError(err, 'Could not load billing.'); return; }

    // Refresh cached plan
    const u = AuraState.user; u.plan = d.plan; AuraState.user = u;
    render(d);

    const params = new URLSearchParams(location.search);
    if (params.get('status') === 'success') {
      toast('Payment received. Welcome to AURA Plus ✦');
      history.replaceState({}, '', '/billing');
    }
  }

  function render(d) {
    const planNames = { free: 'Free', pro: 'AURA Pro', premium: 'AURA Premium' };
    const sub = d.subscription || {};
    const isPaid = d.plan !== 'free';
    const fmtMoney = (p) => p.currency === 'NGN' ? `₦${(p.amount_cents / 100).toLocaleString()}` : `$${(p.amount_cents / 100).toFixed(2)}`;
    const fmtDate = (s) => s ? new Date(s + (s.includes('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    root.innerHTML = `${bgHTML()}
    <div class="screen screen--scroll" style="padding:24px 20px 60px;max-width:640px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:28px">
        <a href="/#profile" class="btn-icon" aria-label="Back">${icon('back', 17)}</a>
        <span class="overline">Billing</span><span style="width:40px"></span>
      </header>

      <section class="glass ${isPaid ? 'price-card--popular' : ''}" id="current-plan" style="padding:26px;margin-bottom:20px;border-radius:24px">
        <div style="display:flex;align-items:center;gap:18px">
          <div>${orbHTML(64, isPaid ? 'hold' : 'idle', { intensity: 0.7, showAura: false })}</div>
          <div style="flex:1">
            <div class="overline" style="margin-bottom:6px">Current plan</div>
            <h1 style="font-size:24px;font-weight:600">${planNames[d.plan]}</h1>
            ${isPaid ? `<p style="font-size:12px;color:var(--text-tertiary);margin-top:4px">
              ${sub.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly'} · ${sub.status === 'canceled' ? `ends ${fmtDate(sub.end_date)}` : `renews ${fmtDate(sub.end_date)}`} · via ${sub.provider || '—'}
            </p>` : '<p style="font-size:12px;color:var(--text-tertiary);margin-top:4px">3 sessions/day · beginner programs</p>'}
          </div>
          ${isPaid ? `<span class="badge badge--${d.plan}">${d.plan.toUpperCase()}</span>` : ''}
        </div>
        <div style="display:flex;gap:12px;margin-top:24px">
          ${d.plan !== 'premium' ? `<a href="/pricing" class="btn-primary" style="flex:1">${d.plan === 'free' ? 'Upgrade' : 'Go Premium'}</a>` : ''}
          ${isPaid && sub.status !== 'canceled' ? `<button class="btn-ghost" id="cancel-btn" style="flex:1">Cancel subscription</button>` : ''}
          ${d.plan === 'premium' ? `<a href="/pricing" class="btn-ghost" style="flex:1">View plans</a>` : ''}
        </div>
      </section>

      <section id="payment-history">
        <div class="overline" style="margin-bottom:12px">Payment history</div>
        ${(d.payments && d.payments.length) ? `
        <div class="glass" style="padding:4px 20px">
          ${d.payments.map((p) => `
          <div style="display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid var(--hairline-soft)">
            <span style="width:34px;height:34px;border-radius:10px;flex-shrink:0;background:${p.status === 'succeeded' ? 'rgba(52,211,153,0.15)' : 'rgba(245,158,11,0.15)'};display:flex;align-items:center;justify-content:center;color:${p.status === 'succeeded' ? '#6EE7B7' : '#FCD34D'}">${icon(p.status === 'succeeded' ? 'check' : 'close', 15)}</span>
            <span style="flex:1"><span style="display:block;font-size:13px;font-weight:500">${p.description || 'Payment'}</span>
            <span style="display:block;font-size:11px;color:var(--text-tertiary);margin-top:2px">${fmtDate(p.created_at)} · ${p.provider}</span></span>
            <span class="tabular" style="font-size:14px;font-weight:500">${fmtMoney(p)}</span>
          </div>`).join('')}
        </div>` : `
        <div class="glass" style="padding:36px;text-align:center">
          <p style="font-size:14px;color:var(--text-tertiary)">No payments yet.</p>
          <a href="/pricing" style="font-size:13px;color:#22D3EE;display:inline-block;margin-top:8px">Explore plans →</a>
        </div>`}
      </section>

      <p style="font-size:11px;color:var(--text-disabled);text-align:center;margin-top:28px;line-height:1.7">
        Payments secured by Stripe & Paystack · Cancel anytime<br/>Questions? support@aura.app
      </p>
    </div>`;

    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) cancelBtn.onclick = async () => {
      const ok = await confirmModal(
        'Cancel your subscription?',
        `You'll keep ${planNames[d.plan]} until ${fmtDate(sub.end_date)}, then move to the Free plan. Your history and insights stay safe.`,
        'Yes, cancel', true
      );
      if (!ok) return;
      try {
        const { data } = await api.post('/billing/cancel');
        toast(data.message);
        const u = AuraState.user; u.plan = 'free'; AuraState.user = u;
        load();
      } catch (err) { handleApiError(err, 'Could not cancel.'); }
    };
  }

  load();
})();
