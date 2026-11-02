// ─── Google Play's own prices ────────────────────────────────────────────────
//
// On the Play build the price of a Play product belongs to Google Play: it is set in Play Console, per
// country and currency, and Google charges exactly that. So the plan card shows the price Play itself
// reports for the product (BillingBridge.queryPlayPrices -> window.onPlayPrices), in the player's own
// currency. Asked once per product per app run; a product Play cannot find is simply left out and the
// card falls back (see PlanPanel's PlanCard).

import { queryPlayPrices } from "../platform/native";

const prices = new Map<string, string>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function install() {
  const w = window as unknown as { onPlayPrices?: (json: string) => void };
  if (w.onPlayPrices) return;
  w.onPlayPrices = (json: string) => {
    try {
      const o = JSON.parse(json) as Record<string, unknown>;
      for (const [id, price] of Object.entries(o)) if (typeof price === "string" && price.trim()) prices.set(id, price.trim());
    } catch { /* an unreadable answer: keep what we had */ }
    version++;
    listeners.forEach((fn) => fn());
  };
}

/** The price Google Play shows for this product, e.g. "₹19.00", or null when Play has not said (yet). */
export function getPlayPrice(productId: string | undefined): string | null {
  return productId ? prices.get(productId) ?? null : null;
}

/** For useSyncExternalStore: changes whenever Play answers. */
export function getPlayPricesVersion(): number {
  return version;
}

export function onPlayPricesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Ask Play for these products' prices (each one only once). Does nothing in a build without Play Billing. */
export function requestPlayPrices(ids: (string | undefined)[]): void {
  const fresh = ids.filter((id): id is string => !!id && !asked.has(id));
  if (!fresh.length) return;
  install();
  if (queryPlayPrices(fresh)) fresh.forEach((id) => asked.add(id));
}
