// ─── The subscription zone ────────────────────────────────────────────────────
//
// What plan you are on, how much of today is left, and how to change it.
//
// The copy leads with the free hour as a TRIAL rather than as a restriction —
// "1 hour free, every day" is the offer; "you have 42m left" is the status. A
// panel that opens with what the user cannot do reads as a paywall even to
// someone who was never going to hit the limit.
//
// Two gates decide whether any price or button appears at all, and BOTH must
// agree:
//
//   • the server's `purchasable` flag for this build's channel — amazonstore,
//     aptoide, uptodown, indusstore and apkpure mandate the store's own billing,
//     and even a "manage your plan at gamepad.space" link is a policy breach
//     there, so those builds get status and nothing else;
//   • `priceFromStore`, set on the playstore flavour, where Play Console holds
//     the authoritative price and rendering our own number beside a Play SKU is
//     a violation in its own right.
//
// Neither is second-guessed locally. If the server says no, this renders status.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Infinity as InfinityIcon, Clock, Ticket, RefreshCw, Check, ChevronDown, Zap } from "lucide-react";
import type { CataloguePlan, PlanCode } from "../api/billing";
import {
  getBillingState, onBillingChange, refresh, redeemPromo,
  formatDuration, formatPrice, formatResetsAt,
} from "../store/billing";
import { purchase, restorePurchases, canRestore } from "../store/purchase";
import { localUsedSeconds } from "../store/playtime";
import { Collapse } from "./Collapse";
import { FADE } from "../motion";
import { getAppInfo } from "../platform/native";
import { AdRewardButton } from "./AdRewardButton";

const ACCENT = "var(--calm-accent, #abc8db)";
const MUTED = "var(--calm-muted, #a6b0b3)";
const DANGER = "var(--calm-error, #ffaba6)";
const GOOD = "var(--calm-good, #a7cfb6)";

/** Fallback labels for the plan the user is ON. `/billing/me` answers with a
 *  code, not a name; the catalogue carries the real display name and wins when
 *  it has loaded. */
const PLAN_LABEL: Record<PlanCode, string> = {
  FREE: "Free",
  THREE_DAY: "3-Day Pass",
  QUARTERLY: "Quarterly",
  LIFETIME: "Lifetime",
};

/**
 * Ordering of the plans, worst to best. Only used to decide what counts as an
 * UPGRADE — see `offers` below. Anything at or below the user's current rank is
 * never offered, so a Lifetime holder is shown no purchase rail at all.
 *
 * Keep this in step with PlanCode. A new code missing from here falls back to
 * rank 0, which means it is treated as the lowest tier and simply never shown as
 * an upgrade — the safe direction to fail, since the alternative is offering an
 * existing customer a downgrade.
 */
const PLAN_RANK: Record<PlanCode, number> = {
  FREE: 0,
  THREE_DAY: 1,
  QUARTERLY: 2,
  LIFETIME: 3,
};

/** What each plan actually gives, in the terms the buyer is deciding in. */
function planBullets(p: CataloguePlan): string[] {
  const out: string[] = [];
  if (p.unlimited) out.push("Unlimited playtime");
  else if (p.dailySeconds) out.push(`${Math.round(p.dailySeconds / 3600)} hours a day`);
  if (p.durationHours) out.push(`Lasts ${p.durationHours} hours`);
  else if (p.durationMonths) out.push(`Lasts ${p.durationMonths} months`);
  else if (p.code === "LIFETIME") out.push("Yours forever");
  return out;
}

export function PlanPanel() {
  const state = useSyncExternalStore(onBillingChange, getBillingState, getBillingState);

  // One read on mount. The panel is not on the input path, so a network call
  // here costs nothing that matters.
  useEffect(() => { void refresh(); }, []);

  const ent = state.entitlement;

  if (state.status === "loading" && !ent) {
    return (
      <Section title="Your plan">
        <Panel>
          <div className="p-4 flex items-center gap-3">
            <RefreshCw size={16} className="animate-spin" style={{ color: MUTED }} />
            <span className="text-sm" style={{ color: MUTED }}>Checking your plan…</span>
          </div>
        </Panel>
      </Section>
    );
  }

  if (state.status === "error" && !ent) {
    return (
      <Section title="Your plan">
        <Panel>
          <div className="p-4">
            <p className="text-sm font-medium" style={{ color: DANGER }}>{state.message}</p>
            <button onClick={() => void refresh()}
              className="mt-3 px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "rgba(79,134,198,0.12)", color: ACCENT }}>
              Try again
            </button>
          </div>
        </Panel>
      </Section>
    );
  }

  if (!ent) return null;

  const catalogue = state.catalogue;
  // Show what is ENFORCED, not what the server last heard about.
  //
  // The playtime clock bills max(local, server) so that clearing app data
  // cannot restore a spent quota. This panel used to render the server's
  // usedSeconds alone, which is lower than the effective figure for as long as
  // the device has un-synced time — up to a whole heartbeat in normal play, and
  // indefinitely after playing offline. The result was an Account tab promising
  // minutes that the controller then refused to hand over.
  const serverUsed = ent.today.usedSeconds;
  const deviceUsed = localUsedSeconds(ent.resetsAt);
  const usedSeconds = Math.max(serverUsed, deviceUsed);
  const limitSeconds = ent.today.limitSeconds;
  const remainingSeconds = ent.unlimited || limitSeconds === null
    ? null
    : Math.max(0, limitSeconds - usedSeconds);
  // Ad time (1.4.6): banked, never expires, spent once the free time is gone.
  // "Out of time" means BOTH are gone; free time gone with a bank left is just
  // playing from the bank.
  const bankSeconds = ent.unlimited ? 0 : ent.adTime?.bankSeconds ?? 0;
  const freeGone = remainingSeconds !== null && remainingSeconds <= 0;
  const exhausted = freeGone && bankSeconds <= 0;

  // A granted entitlement borrows a plan's POLICY, not its identity. The launch
  // bonus is 24h of unlimited built on the 3-Day Pass policy, and calling it
  // "3-Day Pass" would tell the user they own something they never bought — and
  // that expires two days earlier than the name implies. Anything granted is
  // described by what it does instead.
  const isGift = ent.source === "PROMO" || ent.source === "MANUAL";
  const name = isGift
    ? (ent.unlimited ? "Unlimited" : PLAN_LABEL[ent.plan] || ent.plan)
    : (catalogue?.plans.find((p) => p.code === ent.plan)?.displayName
        || PLAN_LABEL[ent.plan] || ent.plan);

  // The upgrade rail is offered only for plans that are actually a step UP from
  // where the user already is, so a Lifetime holder is never shown a way to buy
  // something worse.
  //
  // That was the stated intent, but the filter only excluded the user's CURRENT
  // plan — so someone on Lifetime was still shown Three-Day and Quarterly, i.e.
  // invited to pay again for strictly less than they already own. Ranking the
  // codes is what actually implements the comment: Lifetime outranks everything,
  // so `offers` comes back empty and the whole disclosure below is hidden.
  //
  // `unlimited` covers the gift/promo path (source PROMO or MANUAL), where the
  // plan code can still be a lower tier while the entitlement is effectively
  // uncapped — those users must not be sold a "limit" they do not have either.
  const offers = (getAppInfo().channel !== "playstore" && catalogue?.purchasable && !ent.unlimited ? catalogue.plans : [])
    .filter(
      (p) =>
        p.code !== "FREE" &&
        p.purchasable &&
        (PLAN_RANK[p.code] ?? 0) > (PLAN_RANK[ent.plan] ?? 0)
    );

  return (
    <>
      <Section title="Your plan">
        <Panel>
          {/* ── What you have ── */}
          <div className="flex items-center gap-3 p-4">
            <div className="p-2.5 rounded-xl"
              style={{
                background: ent.unlimited ? "rgba(95,191,143,0.10)" : "rgba(79,134,198,0.10)",
                color: ent.unlimited ? GOOD : ACCENT,
              }}>
              {ent.unlimited ? <InfinityIcon size={18} /> : <Clock size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold calm-ink">{name}</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                {ent.unlimited
                  ? (ent.endsAt
                      ? `${isGift ? "Gift · unlimited until" : "Unlimited until"} ${formatDate(ent.endsAt)}`
                      : "Unlimited playtime")
                  : ent.plan === "FREE"
                    ? "1 hour free, every day"
                    : `${formatDuration(ent.today.limitSeconds || 0)} a day`}
              </p>
            </div>
            <button onClick={() => void refresh()} aria-label="Refresh plan"
              className="p-2 rounded-lg" style={{ color: MUTED }}>
              <RefreshCw size={14} className={state.status === "loading" ? "animate-spin" : ""} />
            </button>
          </div>

          {/* ── Today ── Only for a capped plan: an unlimited plan has no
              meaningful meter, and drawing an empty one implies a limit. */}
          {!ent.unlimited && ent.today.limitSeconds !== null && (
            <div className="p-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-semibold" style={{ color: MUTED }}>Today</span>
                <span className="text-sm font-bold tabular-nums"
                  style={{ fontFamily: "system-ui, sans-serif", color: exhausted ? DANGER : "var(--calm-ink, #f0f2ed)" }}>
                  {formatDuration((remainingSeconds ?? 0) + bankSeconds)} left
                </span>
              </div>
              <Meter
                used={usedSeconds}
                limit={limitSeconds}
                exhausted={exhausted}
              />
              <p className="text-xs mt-2" style={{ color: exhausted ? DANGER : MUTED }}>
                {exhausted
                  ? "You're out of time — watch an ad for 30 more minutes, upgrade, or wait for your next quota."
                  : freeGone
                    ? `Today's free time is used — playing from your ad time. ${formatResetsAt(ent.resetsAt)}`
                    : formatResetsAt(ent.resetsAt)}
              </p>
              <div className="mt-4 flex justify-center"><AdRewardButton /></div>
            </div>
          )}
        </Panel>
      </Section>

      {/* ── Upgrade ── Absent entirely where the channel forbids it, and
          collapsed by default: three full-height cards pushed the rest of the
          account page below the fold, so the plans read as the point of the
          screen rather than as an option. The cheapest price stays on the
          closed row, which is the one number worth showing unprompted. */}
      {offers.length > 0 && (
        <PlansDisclosure
          title={ent.plan === "FREE" ? "Play without the limit" : "Change plan"}
          offers={offers}
        />
      )}

      {ent.plan !== "LIFETIME" && <Section title="Have a code?">
        <Panel><PromoRow /></Panel>
      </Section>}

      {/* Play only. A purchase can complete while the app is dead -- Play holds
          it and re-delivers on the next query, which is what this asks for. */}
      {canRestore() && (
        <Section title="Bought already?">
          <Panel><RestoreRow /></Panel>
        </Section>
      )}
    </>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/**
 * The upgrade rail, closed until asked for.
 *
 * Animates height rather than swapping display, so it reads as one surface
 * opening instead of the page jumping. `overflow-hidden` on the animated
 * wrapper is what keeps the cards clipped while it grows.
 */
function PlansDisclosure({ title, offers }: { title: string; offers: CataloguePlan[] }) {
  const [open, setOpen] = useState(false);

  // The cheapest thing on offer. Shown closed so the row still answers "what
  // would this cost me?" without being opened. Suppressed when any plan takes
  // its price from the store, since we must not render our own figure there.
  const anyFromStore = offers.some((p) => p.priceFromStore);
  const cheapest = anyFromStore
    ? null
    : offers.reduce((a, b) => (a.priceMinor <= b.priceMinor ? a : b));

  return (
    <Section title={title}>
      <div className="rounded-xl overflow-hidden"
        style={{ background: "var(--calm-surface, #202527)", border: "1px solid var(--calm-line, #343c3f)" }}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between p-4 text-left">
          <div className="min-w-0">
            <p className="text-sm font-bold calm-ink">
              {offers.length} plan{offers.length > 1 ? "s" : ""}
            </p>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              {cheapest
                ? `From ${formatPrice(cheapest.priceMinor, cheapest.currency)} · tap to compare`
                : "Tap to see what is available"}
            </p>
          </div>
          {/* A CSS transform, not a Framer animation: rotation is a compositor
              property and this avoids running a second animation loop next to
              the one opening the panel. */}
          <span style={{
            color: MUTED, display: "flex",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
          }}>
            <ChevronDown size={17} />
          </span>
        </button>

        {/* Was animate={{ height: "auto" }}. Framer writes a pixel height every
            frame and height is a LAYOUT property, so each frame reflowed the
            whole account column underneath — that was the stutter. Collapse
            transitions a grid row in CSS instead, with no JS in the loop. */}
        <Collapse open={open}>
          <div className="px-3 pb-3 space-y-2.5">
            {offers.map((p) => <PlanCard key={p.code} plan={p} />)}
            <p className="text-xs leading-relaxed px-1" style={{ color: MUTED }}>
              Prices include GST. Access starts immediately, so purchases are final
              and non-refundable — try the free hour a day first.
            </p>
          </div>
        </Collapse>
      </div>
    </Section>
  );
}

/** The quota bar. Turns red only when the time is actually gone: a bar that
 *  warns at 80% reads as a problem while the user still has twelve minutes. */
function Meter({ used, limit, exhausted }: { used: number; limit: number; exhausted: boolean }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--calm-soft, #292f31)" }}>
      {/* scaleX, not width. Width is a layout property, so animating it reflows
          the row on every frame; a transform is composited and costs nothing.
          The bar is full-width and scaled down from the left edge, which looks
          identical and animates on the GPU. */}
      <div
        className="h-full w-full rounded-full"
        style={{
          background: exhausted ? DANGER : ACCENT,
          transform: `scaleX(${pct / 100})`,
          transformOrigin: "left center",
          transition: "transform 400ms ease-out, background 200ms ease",
          willChange: "transform",
        }}
      />
    </div>
  );
}

export function PlanCard({ plan, onChoose }: { plan: CataloguePlan; onChoose?: (plan: CataloguePlan) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  async function buy() {
    if (onChoose) { onChoose(plan); return; }
    setBusy(true);
    setMsg("");
    const out = await purchase(plan);
    setBusy(false);
    if (out.ok) {
      setDone(true);
      return;
    }
    // A cancellation is a decision, not a failure — saying nothing is the
    // correct amount to say about it.
    if (!out.cancelled) setMsg(out.message);
  }

  return (
    <motion.div className="console-plan-card" data-plan={plan.code} data-testid={`plan-${plan.code.toLowerCase()}-card`}
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
      <div className="console-plan-topline">{plan.code === 'LIFETIME' ? <InfinityIcon size={23} /> : <Zap size={20} />}<span className="console-eyebrow">{plan.code === 'LIFETIME' ? 'ONE TIME. ALL YOURS.' : plan.code === 'THREE_DAY' ? 'MAKE A WEEKEND OF IT' : 'YOUR EVERYDAY COMPANION'}</span></div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold calm-ink">{plan.displayName}</p>
          <ul className="mt-1.5 space-y-0.5">
            {planBullets(plan).map((b) => (
              <li key={b} className="text-xs" style={{ color: MUTED }}><Check size={12} aria-hidden="true" />{b}</li>
            ))}
          </ul>
        </div>
        {/* On Play the price belongs to Play. Showing ours next to a Play SKU
            is a policy violation, so the sheet is the only place it appears. */}
        {!plan.priceFromStore && (
          <p className="console-plan-price text-xl font-bold shrink-0"
            style={{ fontFamily: "system-ui, sans-serif", color: "var(--calm-ink, #f0f2ed)" }}>
            {formatPrice(plan.priceMinor, plan.currency)}
          </p>
        )}
      </div>

      <button
        data-testid={`choose-${plan.code.toLowerCase()}-button`}
        onClick={() => void buy()}
        disabled={busy || done}
        className="console-plan-buy mt-3 w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
        style={{
          background: done ? "rgba(95,191,143,0.14)" : "rgba(79,134,198,0.14)",
          border: `1px solid ${done ? "rgba(95,191,143,0.35)" : "rgba(79,134,198,0.35)"}`,
          color: done ? GOOD : ACCENT,
        }}>
        {done ? <span className="inline-flex items-center gap-1.5"><Check size={14} /> Active</span>
          : busy ? "Opening…"
          : plan.priceFromStore ? "See price and buy"
          : `Get ${plan.displayName}`}
      </button>

      <AnimatePresence>
        {msg && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} className="text-xs mt-2 leading-relaxed" style={{ color: DANGER }}>
            {msg}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Ask Google Play to hand back anything this account already owns.
 *
 *  Results arrive on the same callback the purchase flow uses and are credited
 *  by the store, so this reports only that the request went out -- the plan row
 *  above updates by itself when the entitlement lands. */
function RestoreRow() {
  const [asked, setAsked] = useState(false);

  return (
    <button
      onClick={() => { restorePurchases(); setAsked(true); void refresh(); }}
      className="w-full flex items-center justify-between p-4 text-left">
      <div className="min-w-0">
        <p className="text-sm font-medium calm-ink">Restore purchases</p>
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>
          {asked
            ? "Asked Google Play — your plan will appear here if it finds one."
            : "Bring back a plan bought on another device or before a reinstall."}
        </p>
      </div>
      <RefreshCw size={15} style={{ color: MUTED }} />
    </button>
  );
}

/** Promo redemption. Also the surface the admin portal's hand-granted free
 *  trials arrive through, which is why it is shown on every channel — a granted
 *  entitlement is not a purchase and no store objects to it. */
function PromoRow() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const plan = await redeemPromo(code);
      setOk(true);
      setMsg(`Done — you're on ${PLAN_LABEL[plan] || plan}.`);
      setCode("");
    } catch (err) {
      setOk(false);
      setMsg(err instanceof Error ? err.message : "That code could not be used.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-4">
      <div className="flex gap-2">
        <div className="calm-promo-field flex-1 flex items-center gap-2 px-3 rounded-lg"
          style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
          <Ticket size={14} style={{ color: MUTED }} />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Promo code" placeholder="Enter code"
            maxLength={40}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent py-2.5 text-sm calm-ink outline-none placeholder:text-white/25"
          />
        </div>
        <button type="submit" disabled={busy || !code.trim()}
          className="px-4 rounded-lg text-sm font-semibold disabled:opacity-40"
          style={{ background: "rgba(79,134,198,0.14)", border: "1px solid rgba(79,134,198,0.35)", color: ACCENT }}>
          {busy ? "…" : "Redeem"}
        </button>
      </div>
      <AnimatePresence>
        {msg && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} className="text-xs mt-2" style={{ color: ok ? GOOD : DANGER }}>
            {msg}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

// ─── Shared shells ────────────────────────────────────────────────────────────
// Same shapes TabAccount uses. Duplicated rather than exported across files so
// this panel can be moved without dragging the account tab's layout with it.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-bold mb-2 px-1" style={{ color: MUTED }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden divide-y divide-white/5"
      style={{ background: "var(--calm-surface, #202527)", border: "1px solid var(--calm-line, #343c3f)" }}>
      {children}
    </div>
  );
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
