# Google Play products — created 2026-08-26

The three in-app products backing the billing system, and how they map to the backend.
Created in Play Console on 2026-08-26.

## The mapping — these strings are load-bearing

The backend looks products up by `playProductId` on the Plan row
(`website/backend/billing/seed.js`). If a Console ID and a seed value disagree, the app
queries `ProductDetails` for something Play has never heard of and renders **no price**.

| Plan code | Play product ID | Purchase option / base plan | Price (India) | Type |
|---|---|---|---|---|
| `THREE_DAY` | `gpos_3day` | `gpos-3day-72h` | ₹19 | one-time |
| `QUARTERLY` | `gpos_quarterly` | `gpos-quarterly-3m` | ₹99 | subscription |
| `LIFETIME` | `gpos_lifetime` | `gpos-lifetime-perm` | ₹400 | one-time |

All three match `seed.js` exactly, so **nothing needs setting in the admin portal's Billing
panel** — an earlier note in `PLAY_ACTIVATION.md` said to fill `playProductId` by hand; that is
only true if you invent new IDs.

**IDs are permanent.** Play refuses to reuse a product ID or base plan ID, ever.

## Status as of 2026-08-26

| | State |
|---|---|
| Quarterly subscription + base plan | saved, **base plan not yet activated** |
| 3-Day Pass | **Draft** — needs Activate |
| Lifetime | **Draft** — needs Activate |
| Payments profile | ❌ **error on the Console** — nothing is purchasable until cleared |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | not set on Railway — purchase surface stays hidden by design |

## Pricing

**Quarterly** got tiered pricing: India ₹99, 44 wealthy markets ~$2.99-equivalent
(US/Eurozone/UK/AU/CA/JP/KR/SG/CH/NO/SE/DK/NZ/IL/Gulf and similar), every other market at the
₹99-converted rate. Rationale: ₹99 ≈ $1.15, which underprices the US/EU badly, while flat-cheap
is right for reach elsewhere.

**3-Day (₹19) and Lifetime (₹400) are flat** at the India-converted rate everywhere —
3-Day lands near $0.24 in the US, Lifetime near $5.03. **This is inconsistent with Quarterly**
and inverts the intended ladder, where the 3-Day pass is the premium impulse buy (it is
unlimited; Quarterly is capped at 6h/day). Worth a tiered pass over both before selling outside
India. Not done yet.

## Console gotchas that cost real time

- **"Bulk edit pricing" only responds to the Enter key.** Open Set prices, click the item to
  highlight it, then press Enter. A plain click just closes the menu. This is what turns 173
  individual price fields into one dialog.
- **Prices are mandatory before even "Save as draft"** on a one-time product — the save fails
  with "Your changes couldn't be saved" and every row turns into a red "Set a price".
- **The Console renderer wedges** on these long price tables — screenshots start timing out and
  clicks stop registering. A fresh browser tab fixes it; nothing else did.
- **Play "charms" prices**: ₹99 was silently stored as ₹100 and had to be edited back per-region.
  Check India after any bulk apply.
- Age rating is optional and would not stick on the one-time products; left unset.
- Classification defaulted to **Digital content** on both one-time products, while the
  subscription is **Service**. Harmless today, but inconsistent — worth aligning.

## Related

- `website/backend/billing/seed.js` — the source of truth for these IDs
- `context/PLAY_ACTIVATION.md` — Part B, switching billing on
- `projects/gamepados/docs/research/BILLING_DECISIONS.md` — why the plan ladder is what it is
