// Website account + checkout.
//
// WHY THIS PAGE EXISTS, beyond convenience: five of the seven app builds
// (amazonstore, aptoide, uptodown, indusstore, apkpure) are forbidden from
// showing any purchase surface at all — Amazon and Aptoide mandate their own
// billing, and a single "manage your plan at gamepad.space" inside those builds
// is already a policy breach. The design answer was to put entitlements on the
// ACCOUNT rather than the install, which only works if there is somewhere to
// buy. This is that somewhere. It is also the only channel with no store cut.
//
// The token is the same 64-hex bearer token the app uses. Kept in localStorage
// rather than a cookie because the API is on a different origin from the site,
// so a cookie would be third-party and dropped — the same reason the app uses
// bearer tokens. It is scoped to this browser and cleared on sign-out.

import { API_BASE } from './config.js';

const TOKEN_KEY = 'gpos_token';
const RAZORPAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';

const $ = (id) => document.getElementById(id);
const show = (id) => { const el = $(id); if (el) el.hidden = false; };
const hide = (id) => { const el = $(id); if (el) el.hidden = true; };

const STATES = ['state-loading', 'state-auth', 'state-verify', 'state-forgot', 'state-account'];
function goto(state) {
  STATES.forEach((s) => hide(s));
  show(state);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function say(id, text, kind = 'error') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'acc-msg acc-msg-' + kind;
  el.hidden = !text;
}

const token = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * One fetch wrapper for the whole page.
 *
 * A 401 always means the same thing — the session is gone — so it is handled
 * here rather than in eight call sites that would each get it slightly wrong.
 */
async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + token.get();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    token.clear();
    goto('state-auth');
    throw new Error('Your session ended. Sign in again.');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * These strings come from our own server, not from a user — but they are the
 * only place free text reaches innerHTML on this page, and "it is trusted
 * today" is exactly the assumption that stops being true later.
 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (minor, currency) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 })
    .format((minor || 0) / 100);

/** Seconds → "1h 30m" / "45m" / "30s". Never "0h 0m". */
function duration(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function whenResets(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  let h = d.getHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Resets at ${h}:${mm} ${ap}` : `Resets ${d.getDate()} ${mon}, ${h}:${mm} ${ap}`;
}

// ── Signed-in view ─────────────────────────────────────────────────────────

/**
 * Fill and show the account view.
 *
 * `knownUser` is the user object the caller already has — /api/account/login
 * and /api/account/verify both return it. Passing it skips /api/account/me
 * entirely, which was a round trip spent asking the server for something the
 * previous response had already handed us. Only the cold path (a page load
 * with a stored token and no user in hand) still needs to ask.
 *
 * All three requests now start together. The plan list does not depend on the
 * account at all, yet renderPlans used to fire only AFTER me+billing resolved,
 * making a third wait out of something that could have overlapped the first two.
 */
async function loadAccount(knownUser) {
  const plansPromise = fetchPlans();          // starts NOW, awaited at the end
  const [me, billing] = await Promise.all([
    knownUser ? { user: knownUser } : api('/api/account/me', { auth: true }),
    api('/api/billing/me', { auth: true }),
  ]);

  $('acc-name').textContent = me.user?.displayName ? `Hi, ${me.user.displayName}` : 'Your account';
  $('acc-email').textContent = me.user?.email || '';

  $('plan-name').textContent = PLAN_LABEL[billing.plan] || billing.plan;

  const t = billing.today || {};
  if (billing.unlimited) {
    // Unlimited plans show NO countdown at all — a limit that does not apply
    // should not be on screen implying it might.
    $('plan-today').textContent = 'Unlimited';
    hide('plan-meter');
    $('plan-resets').textContent = billing.endsAt
      ? 'Active until ' + new Date(billing.endsAt).toLocaleDateString()
      : 'Active — no expiry';
  } else {
    const used = Math.max(0, t.usedSeconds || 0);
    const limit = t.limitSeconds || 0;
    $('plan-today').textContent = `${duration(t.remainingSeconds)} left of ${duration(limit)}`;
    show('plan-meter');
    const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
    $('plan-meter-fill').style.width = pct + '%';
    $('plan-meter-fill').classList.toggle('is-low', pct >= 85);
    $('plan-resets').textContent = whenResets(billing.resetsAt);
  }

  renderSubscription(billing);

  await renderPlans(billing, plansPromise);
  goto('state-account');
}

const PLAN_LABEL = { FREE: 'Free', THREE_DAY: '3-Day Pass', QUARTERLY: 'Quarterly', LIFETIME: 'Lifetime' };

const onDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  : null);

/**
 * The subscription block: only present while something is actually renewing.
 *
 * A one-off purchase (3-Day Pass, Lifetime) has nothing to cancel, so offering
 * a cancel button there would invite a click that can only disappoint. The
 * block is driven by `autoRenew`, which is the only thing cancelling changes.
 */
function renderSubscription(billing) {
  const wrap = $('sub-manage');
  if (!wrap) return;
  hide('sub-confirm');
  say('sub-msg', '');

  if (!billing.autoRenew) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const name = PLAN_LABEL[billing.plan] || billing.plan;
  const when = onDate(billing.endsAt);
  $('sub-renews').textContent = when
    ? `${name} renews automatically on ${when}.`
    : `${name} renews automatically.`;

  // The confirm text spells out what they KEEP. "Cancelled" is the word people
  // fear means "gone now", and the single most common support question after
  // cancelling is whether they just lost what they paid for.
  $('sub-confirm-detail').textContent = when
    ? `You keep ${name} until ${when} — nothing is lost and you will not be charged again. After that you move to Free, with 1 hour a day.`
    : `You will not be charged again. You keep ${name} until the end of the period you have paid for, then move to Free.`;
}

/**
 * Kicked off before the account requests so it overlaps them rather than
 * queueing behind them. Resolves to a plan array, or null if the call failed —
 * it never rejects, so an unhandled rejection cannot escape while it is in
 * flight unawaited.
 */
function fetchPlans() {
  // channel=direct: this is our own storefront, so purchases are allowed and
  // the price in our database is the authoritative one.
  //
  // Sent WITH the token: what is on sale now depends on what you already own,
  // and the server decides that. It answers 200 either way — an absent or stale
  // token just gets the plain catalogue, never a 401.
  //
  // The whole payload comes back rather than a filtered array. Plans you cannot
  // buy are no longer dropped: a card that vanishes looks like a bug, whereas a
  // card that stays and says why reads as a deliberate rule.
  return api('/api/billing/plans?channel=direct', { auth: true })
    .then((out) => out)
    .catch(() => null);
}

async function renderPlans(billing, plansPromise) {
  const wrap = $('plan-cards');
  wrap.innerHTML = '<p class="acc-muted">Loading plans…</p>';

  const payload = await (plansPromise || fetchPlans());
  if (!payload) {
    wrap.innerHTML = '<p class="acc-muted">Plans are unavailable right now. Try again shortly.</p>';
    return;
  }
  // Top-level `purchasable` is the CHANNEL gate — whether this storefront may
  // sell at all (it goes false while Razorpay is unconfigured). That is a
  // different question from whether a given plan suits this user, which each
  // plan answers for itself below.
  if (!payload.purchasable) {
    wrap.innerHTML = '<p class="acc-muted">Plans are not on sale right now.</p>';
    return;
  }
  const plans = payload.plans || [];
  if (!plans.length) {
    wrap.innerHTML = '<p class="acc-muted">No plans are on sale right now.</p>';
    return;
  }

  // The orange ring FOLLOWS THE SELECTION. It used to be welded to Lifetime as
  // a "featured" marker, which every user read as "this is the plan I have
  // picked" — so clicking the 3-Day card and seeing the ring stay on ₹400 felt
  // like the page was buying the wrong plan. It never was (each button is bound
  // to its own plan), but a highlight that ignores your click is
  // indistinguishable from one. Lifetime keeps its emphasis as a "Best value"
  // pill, which recommends without claiming to be chosen.
  wrap.innerHTML = '';
  const select = (card) => {
    wrap.querySelectorAll('.acc-plan-card').forEach((c) => {
      c.classList.toggle('is-featured', c === card);
      c.setAttribute('aria-pressed', String(c === card));
    });
  };
  for (const p of plans) {
    const owned = p.code === billing.plan;
    const blocked = !p.purchasable;
    const discounted = p.creditMinor > 0 && p.effectivePriceMinor !== p.priceMinor;

    const card = document.createElement('div');
    card.className = 'acc-plan-card'
      + (blocked ? ' is-blocked' : '')
      + (owned ? ' is-current' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', 'false');
    const limit = p.unlimited ? 'Unlimited playtime' : `${duration(p.dailySeconds)} a day`;
    const term = p.durationHours ? `${p.durationHours / 24} days`
      : p.durationMonths ? `${p.durationMonths} months`
      : 'Forever';

    // On an upgrade the list price stays visible with a line through it, so the
    // discount is something the buyer can SEE rather than a smaller number they
    // have to take on trust.
    const priceHtml = discounted
      ? `<span class="acc-plan-was">${money(p.priceMinor, p.currency)}</span>
         ${money(p.effectivePriceMinor, p.currency)}`
      : money(p.priceMinor, p.currency);

    const badge = owned ? ' <span class="acc-plan-badge">Your plan</span>'
      : p.code === 'LIFETIME' ? ' <span class="acc-plan-badge">Best value</span>'
      : '';

    card.innerHTML = `
      <div class="acc-plan-card-name">${p.displayName}${badge}</div>
      <div class="acc-plan-card-price">${priceHtml}</div>
      <ul class="acc-plan-card-list">
        <li>${limit}</li>
        <li>${term}</li>
      </ul>
      ${discounted ? `<p class="acc-plan-note acc-plan-credit">${money(p.creditMinor, p.currency)} off — what you paid for your current plan.</p>` : ''}
      ${blocked && p.reason ? `<p class="acc-plan-note">${escapeHtml(p.reason)}</p>` : ''}`;

    const btn = document.createElement('button');
    btn.className = 'btn ' + (p.code === 'LIFETIME' ? 'btn-dark' : 'btn-ghost');
    btn.textContent = owned ? 'Your current plan'
      : blocked ? 'Not available'
      : p.isUpgrade ? 'Upgrade'
      : 'Get it';
    btn.disabled = blocked || owned;
    // Anywhere on the card selects it — people tap the card, not the button.
    card.addEventListener('click', () => select(card));
    if (!blocked) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();   // buying should not re-run selection underneath
        select(card);
        buy(p, btn);
      });
    }
    card.appendChild(btn);
    wrap.appendChild(card);
  }
}

// ── Checkout ───────────────────────────────────────────────────────────────

/** Load Razorpay's script only when someone actually buys. */
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = RAZORPAY_SDK;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

async function buy(plan, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Opening…';
  say('acc-msg', '');

  try {
    if (!(await loadRazorpay())) throw new Error("Couldn't load the payment window. Check your connection.");

    // The AMOUNT comes from the server, never from this page. Anything the
    // browser can set, a buyer can change.
    const order = await api('/api/billing/razorpay/order', {
      method: 'POST', auth: true, body: { planCode: plan.code },
    });

    const opts = {
      key: order.keyId,
      name: 'GamepadOS',
      description: plan.displayName,
      theme: { color: '#111111' },
      // Razorpay hands the browser a signature; it proves the ids are genuine
      // and nothing else. The server re-fetches the payment and checks the
      // amount before granting anything.
      handler: async (r) => {
        try {
          say('acc-msg', 'Confirming your payment…', 'info');
          await api('/api/billing/razorpay/verify', {
            method: 'POST', auth: true,
            body: {
              planCode: plan.code,
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_order_id: r.razorpay_order_id,
              razorpay_subscription_id: r.razorpay_subscription_id,
              razorpay_signature: r.razorpay_signature,
            },
          });
          say('acc-msg', "Done — your plan is active. Open the app and you're set.", 'ok');
          await loadAccount();
        } catch (e) {
          // The webhook is the backstop: if this call failed but the money
          // moved, the server credits it independently. Say so rather than
          // implying the payment is lost.
          say('acc-msg',
            'Payment received, but confirming it here failed: ' + e.message
            + ' It should appear within a minute — refresh, and contact support if it does not.',
            'warn');
        }
      },
      modal: {
        ondismiss: () => { btn.disabled = false; btn.textContent = original; },
      },
    };
    if (order.kind === 'subscription') opts.subscription_id = order.subscriptionId;
    else opts.order_id = order.orderId;

    const rz = new window.Razorpay(opts);
    rz.on('payment.failed', (resp) => {
      say('acc-msg', 'Payment failed: ' + (resp?.error?.description || 'please try again.'));
      btn.disabled = false;
      btn.textContent = original;
    });
    rz.open();
    btn.textContent = original;
  } catch (e) {
    say('acc-msg', e.message);
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────

/**
 * Wire a form's submit WITH a visible busy state.
 *
 * Every form on this page used to run its request with no feedback at all: the
 * button stayed lit, kept its label, and nothing moved for the 1-3 seconds the
 * request took. The click read as "nothing happened", so people clicked again —
 * which fired a second request and made it genuinely twice as slow, then read
 * as confirmation that the page was broken. The buy button (see `buy` above)
 * had always done this correctly; the auth forms never got the same treatment.
 *
 * `busy` also blocks re-entry, so a double-click can no longer produce a second
 * in-flight request even before the button paints as disabled.
 */
function onSubmit(formId, busyText, handler) {
  const form = $(formId);
  if (!form) return;
  const btn = form.querySelector('[type="submit"]');
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = busyText; btn.classList.add('is-busy'); }
    try {
      await handler(e);
    } finally {
      // Always restores, including on the success path that navigates away —
      // the form is hidden by then, but it must be correct if the user signs
      // out and comes back without a reload.
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = original; btn.classList.remove('is-busy'); }
    }
  });
}

/** Same busy contract for the plain buttons that fire a request (Send it again). */
function onClick(id, busyText, handler) {
  const btn = $(id);
  if (!btn) return;
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText;
    try {
      await handler();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

let pendingEmail = '';

function wire() {
  $('year').textContent = new Date().getFullYear();

  document.querySelectorAll('.acc-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.acc-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const signup = tab.dataset.tab === 'signup';
      $('form-signin').hidden = signup;
      $('form-signup').hidden = !signup;
      say('auth-msg', '');
    });
  });

  onSubmit('form-signin', 'Signing in…', async () => {
    say('auth-msg', '');
    try {
      const out = await api('/api/account/login', {
        method: 'POST',
        body: { email: $('si-email').value, password: $('si-pass').value },
      });
      token.set(out.token);
      // login already returned the user — hand it straight to loadAccount so it
      // does not spend a round trip on /api/account/me asking for what we hold.
      await loadAccount(out.user);
    } catch (err) {
      // An unverified account is not an error — it is the next step.
      if (err.code === 'unverified') {
        pendingEmail = $('si-email').value.trim().toLowerCase();
        $('verify-email').textContent = pendingEmail;
        goto('state-verify');
        return;
      }
      say('auth-msg', err.message);
    }
  });

  onSubmit('form-signup', 'Creating…', async () => {
    say('auth-msg', '');
    try {
      await api('/api/account/register', {
        method: 'POST',
        body: {
          email: $('su-email').value,
          password: $('su-pass').value,
          displayName: $('su-name').value,
        },
      });
      pendingEmail = $('su-email').value.trim().toLowerCase();
      $('verify-email').textContent = pendingEmail;
      goto('state-verify');
    } catch (err) {
      say('auth-msg', err.message);
    }
  });

  onSubmit('form-verify', 'Confirming…', async () => {
    say('verify-msg', '');
    try {
      const out = await api('/api/account/verify', {
        method: 'POST',
        body: { email: pendingEmail, code: $('vf-code').value },
      });
      if (out.token) {
        token.set(out.token);
        await loadAccount(out.user);
      } else {
        goto('state-auth');
        say('auth-msg', 'Confirmed — sign in to continue.', 'ok');
      }
    } catch (err) {
      say('verify-msg', err.message);
    }
  });

  onClick('go-resend', 'Sending…', async () => {
    say('verify-msg', '');
    try {
      await api('/api/account/resend', { method: 'POST', body: { email: pendingEmail } });
      say('verify-msg', 'Sent. Check your email.', 'ok');
    } catch (err) {
      say('verify-msg', err.message);
    }
  });

  $('go-forgot').addEventListener('click', () => { goto('state-forgot'); say('forgot-msg', ''); });
  $('back-signin').addEventListener('click', () => { goto('state-auth'); say('auth-msg', ''); });

  onSubmit('form-forgot', 'Sending…', async () => {
    say('forgot-msg', '');
    try {
      pendingEmail = $('fg-email').value.trim().toLowerCase();
      await api('/api/account/password/forgot', { method: 'POST', body: { email: pendingEmail } });
      $('form-forgot').hidden = true;
      $('form-reset').hidden = false;
      say('forgot-msg', 'If that address has an account, a code is on its way.', 'ok');
    } catch (err) {
      say('forgot-msg', err.message);
    }
  });

  onSubmit('form-reset', 'Saving…', async () => {
    say('forgot-msg', '');
    try {
      await api('/api/account/password/reset', {
        method: 'POST',
        body: { email: pendingEmail, code: $('rs-code').value, password: $('rs-pass').value },
      });
      goto('state-auth');
      say('auth-msg', 'Password changed — sign in with the new one.', 'ok');
    } catch (err) {
      say('forgot-msg', err.message);
    }
  });

  onSubmit('form-promo', 'Redeeming…', async () => {
    say('promo-msg', '');
    try {
      await api('/api/billing/promo/redeem', {
        method: 'POST', auth: true, body: { code: $('promo-code').value },
      });
      say('promo-msg', 'Code applied.', 'ok');
      $('promo-code').value = '';
      await loadAccount();
    } catch (err) {
      say('promo-msg', err.message);
    }
  });

  // Cancelling is two steps: reveal what it means, then do it. It is not
  // reversible from this page, so a single stray click must not perform it.
  $('go-cancel-sub').addEventListener('click', () => {
    show('sub-confirm');
    say('sub-msg', '');
  });
  $('go-cancel-keep').addEventListener('click', () => hide('sub-confirm'));

  onClick('go-cancel-confirm', 'Cancelling…', async () => {
    say('sub-msg', '');
    try {
      const out = await api('/api/billing/subscription/cancel', { method: 'POST', auth: true });
      hide('sub-confirm');
      const when = onDate(out.endsAt);
      // Reload FIRST: the panel, the renewal line and the plan cards all have to
      // reflect the new state. renderSubscription clears this message box as it
      // redraws, so the confirmation is written after it, not before.
      await loadAccount();
      say('sub-msg', when
        ? `Done — you will not be charged again, and you keep your plan until ${when}.`
        : 'Done — you will not be charged again.', 'ok');
    } catch (err) {
      say('sub-msg', err.message);
    }
  });

  onClick('go-signout', 'Signing out…', async () => {
    try { await api('/api/account/logout', { method: 'POST', auth: true }); } catch { /* leaving anyway */ }
    token.clear();
    goto('state-auth');
  });
}

async function start() {
  wire();
  // (The app→website one-time sign-in handoff, #app_login=…, was removed on
  // 2026-09-30: its only caller, the Play build's "Explore plans on website"
  // button, is gone. The WebsiteLoginGrant table is left in the schema on
  // purpose — dropping it would make every deploy's db push refuse to run.)
  if (!token.get()) { goto('state-auth'); return; }
  try {
    await loadAccount();
  } catch {
    // api() already redirected on a 401; anything else lands here.
    goto('state-auth');
  }
}

start();
