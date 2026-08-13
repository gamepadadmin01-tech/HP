# Dynamic Pricing — Future Idea (PARKED, not implemented)

Status: **idea only — NOT built.** Captured for a later redesign. The live site
currently uses flat pricing (`PRICE_PER_PIXEL`, `MIN_PRICE`). Read the **Risks**
section before building any of this.

---

## The core idea
Make the price per pixel **rise as the canvas fills up**, like a bonding curve
(the mechanic crypto tokens use). Early buyers pay less; later buyers pay more.

- Good for **our revenue**: the more that sells, the more each new square earns.
- Intended to let **early buyers "profit"** — BUT see the catch below.

## The catch — "early buyers profit" is NOT automatic
Dynamic pricing alone does **not** give early buyers any profit. A square bought
cheap is only "worth more" later **if the owner can sell it to someone else.**
Today, squares are permanent and there is **no resale**, so an early buyer never
realises any gain — only we collect the higher price from the next buyer.

➡️ To actually let early buyers profit, we must ALSO build a **resale / secondary
market** (owners list a square, a new buyer pays the current higher price,
ownership transfers, we take a 5–10% fee). That is the hard, risky part.

---

## Price must ONLY ever increase (never drop)
Decision: price is **monotonic upward**. Never decreases.

Trap: if price is computed from *current* occupancy, then a **refund, removed
image, or expired reservation frees space → occupancy drops → price would drop.**
Not wanted.

Fix: anchor price to a **high-water-mark counter** that only ever increments:

```
totalPixelsEverSold   // only goes UP, even on refund/removal
S = totalPixelsEverSold / totalPixels        // 0 .. 1 (can exceed canvas over time)
```

| Event              | Canvas space | Price            |
|--------------------|--------------|------------------|
| New paid purchase  | fills up     | ↑ rises          |
| Refund / removal   | frees up     | → stays (no drop)|
| Reservation expires| frees up     | → stays          |

So the canvas can free up (re-buyable), but the price ratchets up forever.

---

## The equations

Let `p₀` = base price/pixel (currently 0.5), `S` = sold fraction (from the
monotonic counter), `k` = steepness, `N` = total pixels.

**Model 1 — Linear (simplest):**
```
p(S) = p₀ · (1 + k · S)
```
e.g. k = 4 → empty 0.5/px, half-full 1.5/px, full 2.5/px (5× rise).

**Model 2 — Exponential (steeper / more hype):**
```
p(S) = p₀ · e^(k · S)
```
e.g. k = 1.6 → empty 0.5/px, full ≈ 2.48/px.

**Exact bonding-curve cost** (buyer nudges price as they buy, from cumulative
pixel x₁ to x₂, linear model):
```
cost = p₀ · [ (x₂ − x₁) + (k / (2N)) · (x₂² − x₁²) ]
```

**Simpler version that's fine in practice** — snapshot the marginal price at
purchase time:
```
priceNow = p₀ · (1 + k · S_current)
cost     = area · priceNow
```
After the sale, `S` increases, so the next buyer automatically sees a higher price.

---

## Real-time / concurrency notes
- Price MUST be computed **server-side** in `/api/checkout` at the instant the
  order is created — never trust a price sent by the browser.
- Two simultaneous buyers each get priced off the current counter at their moment;
  the existing overlap check already stops them grabbing the same space, so it's
  race-safe.
- Store `totalPixelsEverSold` in `state`, increment it inside `finalize()` on each
  paid sale, never decrement it (not in `removePlacement`).

---

## ⚠️ Risks — READ before building (this is why it's parked)
1. **Legal (India):** marketing it as "buy early and earn profit" is a
   **financial-return promise** and can look like an **unregistered investment /
   collective investment scheme (SEBI territory).** Frame it ONLY as a fun
   speculative game — never as income/returns.
2. **Greater-fool economics:** early buyers only profit if new buyers keep coming.
   When demand stops, late buyers are stuck and lose. Inherent to the model.
3. **Reputation / nuisance:** speculative "flip for profit" framing can attract
   complaints, chargebacks, and angry late buyers. This is the "nuisance later"
   concern — the reason we're shelving it.
4. **Resale market = much more complexity:** ownership transfer, payouts to
   sellers, fee handling, disputes, KYC on sellers receiving money, etc.

---

## Suggested build order IF revisited
1. **Dynamic pricing only** (Model 1 snapshot, monotonic counter) — low risk,
   grows our revenue, legitimate. ~15 lines in `/api/checkout`.
2. **Live price indicator** on the site ("Price now ₹X/px — rising as it fills")
   for FOMO. Low risk.
3. **Resale market** — only with real demand AND legal advice. High risk.

Recommendation when revisited: do 1 + 2, hold 3 and the "users profit" pitch.
