// AURA pricing page — high-conversion 3-tier layout with monthly/yearly toggle
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, bgHTML, handleApiError } = window.Aura;
  const root = document.getElementById('app');
  let cycle = 'yearly';
  let plans = null;

  const TIER_META = {
    free: { cta: 'Get Started', tagline: 'Begin your practice', accent: 'rgba(255,255,255,0.4)' },
    pro: { cta: 'Upgrade to Pro', tagline: 'For a daily practice', accent: '#A78BFA', popular: true },
    premium: { cta: 'Go Premium', tagline: 'The complete experience', accent: '#22D3EE' },
  };

  const FAQ = [
    ['Can I cancel anytime?', 'Yes. Cancel in one tap from your billing page. You keep access until the end of your billing period, then move to the Free plan. No questions, no retention flows.'],
    ['What payment methods do you support?', 'We support all major cards via Stripe worldwide, and Paystack for cards, bank transfer, and USSD in Nigeria. All payments are encrypted and PCI-compliant.'],
    ['What happens when I hit the free limit?', 'The Free plan includes 3 sessions per day. When you reach it, the orb rests until tomorrow, or upgrade for unlimited practice.'],
    ['Is there a free trial for paid plans?', 'Yearly plans include a 7-day free trial. You can cancel during the trial and pay nothing.'],
    ['Do you offer refunds?', "If AURA isn't right for you, contact us within 14 days of purchase for a full refund."],
  ];

  async function load() {
    try { const { data } = await api.get('/billing/plans'); plans = data.plans; }
    catch (err) { handleApiError(err, 'Could not load plans.'); return; }
    render();
  }

  function priceFor(p) {
    if (p.id === 'free') return { n: '$0', sub: 'forever' };
    if (cycle === 'monthly') return { n: `$${p.monthly_usd}`, sub: 'per month' };
    return { n: `$${p.yearly_monthly_equiv}`, sub: `per month · $${p.yearly_usd} billed yearly` };
  }

  function render() {
    const user = AuraState.user;
    root.innerHTML = `${bgHTML('deep')}
    <div class="screen screen--wide" style="padding:0 24px 80px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding:22px 0 0">
        <a href="/" style="font-size:14px;font-weight:500;letter-spacing:6px">AURA</a>
        <a href="${user ? '/#home' : '/#login'}" class="chip">${user ? 'Back to app' : 'Sign in'}</a>
      </header>

      <section id="pricing-hero" style="text-align:center;padding:56px 0 40px">
        <div style="display:flex;justify-content:center;margin-bottom:28px">${orbHTML(120, 'hold', { intensity: 0.85 })}</div>
        <h1 style="font-size:clamp(30px,5vw,44px);font-weight:600;letter-spacing:-1px;margin-bottom:14px">Simple, Transparent Pricing</h1>
        <p style="font-size:16px;color:var(--text-tertiary);max-width:460px;margin:0 auto 34px;line-height:1.6">Start free. Upgrade when your practice deepens. Every plan keeps the orb. Paid plans make it smarter.</p>
        <div class="billing-toggle" role="tablist">
          <button role="tab" class="${cycle === 'monthly' ? 'active' : ''}" data-cycle="monthly">Monthly</button>
          <button role="tab" class="${cycle === 'yearly' ? 'active' : ''}" data-cycle="yearly">Yearly <span style="font-size:11px;opacity:0.9">· save 40%</span></button>
        </div>
      </section>

      <section class="pricing-grid" id="pricing-cards">
        ${plans.map((p) => {
          const meta = TIER_META[p.id];
          const price = priceFor(p);
          return `
          <article class="price-card glass ${meta.popular ? 'price-card--popular' : ''}" id="plan-${p.id}">
            ${meta.popular ? '<span class="popular-badge">✦ MOST POPULAR</span>' : ''}
            <h2 style="font-size:18px;font-weight:600;color:${meta.accent}">${p.name}</h2>
            <p style="font-size:13px;color:var(--text-tertiary);margin:4px 0 20px">${meta.tagline}</p>
            <div style="margin-bottom:6px"><span class="tabular" style="font-size:42px;font-weight:300;letter-spacing:-1px">${price.n}</span></div>
            <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:24px">${price.sub}</p>
            <div style="flex:1;margin-bottom:24px">
              ${p.features.map((f) => `<div class="feat-row"><span style="color:#34D399;flex-shrink:0;margin-top:1px">${icon('check', 15)}</span>${f}</div>`).join('')}
            </div>
            <button class="${p.id === 'free' ? 'btn-ghost' : 'btn-primary'}" data-buy="${p.id}" ${meta.popular ? '' : p.id !== 'free' ? 'style="background:var(--glass-heavy);box-shadow:none;border:1px solid rgba(255,255,255,0.18)"' : ''}>${meta.cta}</button>
          </article>`;
        }).join('')}
      </section>

      <section id="trust-signals" style="display:flex;flex-wrap:wrap;justify-content:center;gap:28px;padding:40px 0;color:var(--text-tertiary);font-size:13px">
        <span style="display:flex;align-items:center;gap:8px">${icon('shield', 16)} Secure payments with Stripe & Paystack</span>
        <span style="display:flex;align-items:center;gap:8px">${icon('check', 16)} Cancel anytime, keep your data</span>
        <span style="display:flex;align-items:center;gap:8px">${icon('heart', 16)} 7-day free trial on yearly plans</span>
      </section>

      <section id="plan-compare" style="max-width:640px;margin:0 auto 56px">
        <h2 style="font-size:22px;font-weight:600;text-align:center;margin-bottom:24px">Why practitioners choose Pro</h2>
        <div class="glass" style="padding:24px">
          ${[
            ['Sessions per day', '3', 'Unlimited', 'Unlimited'],
            ['Guided programs', '2 beginner', 'All 6+', 'All + early access'],
            ['AI adaptive pacing', '—', '✓', '✓ + weekly plans'],
            ['Deep analytics', '—', '✓', '✓ + exports'],
            ['Spatial soundscapes', '—', '—', '✓'],
          ].map(([f, a, b, c]) => `
          <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:8px;padding:11px 0;border-bottom:1px solid var(--hairline-soft);font-size:13px;align-items:center">
            <span style="color:var(--text-secondary)">${f}</span>
            <span style="text-align:center;color:var(--text-disabled)">${a}</span>
            <span style="text-align:center;color:#A78BFA;font-weight:500">${b}</span>
            <span style="text-align:center;color:#22D3EE">${c}</span>
          </div>`).join('')}
          <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:8px;padding-top:12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-tertiary)">
            <span></span><span style="text-align:center">Free</span><span style="text-align:center">Pro</span><span style="text-align:center">Premium</span>
          </div>
        </div>
      </section>

      <section id="pricing-faq" style="max-width:640px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:600;text-align:center;margin-bottom:16px">Questions, answered</h2>
        ${FAQ.map(([q, a], i) => `
        <div class="faq-item" data-faq="${i}">
          <button class="faq-q">${q}<span class="faq-chev">${icon('back', 15)}</span></button>
          <div class="faq-a">${a}</div>
        </div>`).join('')}
      </section>
    </div>`;

    // rotate chevron down
    document.querySelectorAll('.faq-chev svg').forEach((s) => s.style.transform = 'rotate(-90deg)');
    document.querySelectorAll('[data-cycle]').forEach((b) => b.onclick = () => { cycle = b.dataset.cycle; render(); });
    document.querySelectorAll('[data-faq]').forEach((f) => f.querySelector('.faq-q').onclick = () => f.classList.toggle('open'));
    document.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => buy(b.dataset.buy));
  }

  async function buy(planId) {
    const user = AuraState.user;
    if (!user) { location.href = '/#signup'; return; }
    if (planId === 'free') { location.href = '/#home'; return; }

    // Provider picker (Stripe global / Paystack Nigeria)
    const veil = document.createElement('div');
    veil.className = 'modal-veil modal-veil--center';
    veil.innerHTML = `
      <div class="sheet sheet--center" style="max-width:380px">
        <h3 style="font-size:19px;font-weight:600;margin-bottom:6px">Choose payment method</h3>
        <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:22px">AURA ${planId === 'pro' ? 'Pro' : 'Premium'} · billed ${cycle}</p>
        <button class="btn-primary" data-p="stripe" style="margin-bottom:12px">${icon('card', 18)} Pay with card (Stripe)</button>
        <button class="btn-ghost" data-p="paystack" style="margin-bottom:14px">🇳🇬 Paystack · cards, transfer, USSD</button>
        <button style="width:100%;font-size:13px;color:var(--text-tertiary)" data-x>Cancel</button>
      </div>`;
    document.body.appendChild(veil);
    veil.onclick = (e) => { if (e.target === veil) veil.remove(); };
    veil.querySelector('[data-x]').onclick = () => veil.remove();
    veil.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
      const provider = b.dataset.p;
      b.disabled = true; b.style.opacity = '0.6';
      try {
        const { data } = await api.post('/billing/checkout', { plan: planId, cycle, provider });
        if (data.checkout_url) { location.href = data.checkout_url; return; }
        if (data.activated) {
          veil.remove();
          const u = AuraState.user; u.plan = planId; AuraState.user = u;
          toast(`${data.message} You're now on ${planId === 'pro' ? 'Pro' : 'Premium'}. ✦`);
          setTimeout(() => location.href = '/billing', 1600);
        }
      } catch (err) { veil.remove(); handleApiError(err, 'Checkout failed.'); }
    });
  }

  load();
})();
