# Flexsquare — *Flex your space.*

A website that is almost nothing: a thin navbar over a big **white canvas**.
That white space is the product. Anyone can drag to select empty cells and **buy them**.
Once bought, a cell is theirs forever — their color/image/link/message live in it.

It's the [Million Dollar Homepage](https://en.wikipedia.org/wiki/The_Million_Dollar_Homepage)
idea, rebuilt for today with a real checkout flow (Razorpay or Stripe).

---

## Quick start (30 seconds, no payment setup)

```bash
cd F:\Flexspace
npm install
npm start
```

Open **http://localhost:4000**. Out of the box it runs in **Demo mode** — buying
instantly claims the space with no real charge, so you can try the whole flow.

## Turn on real payments — Razorpay (recommended for India)

1. Create a free account at <https://razorpay.com> → **Dashboard → Settings → API Keys**.
   Generate **Test** keys (they work instantly, no business verification needed).
   You'll get a `rzp_test_...` **Key Id** and a **Key Secret**.
2. Create `F:\Flexspace\.env` (copy `server/.env.example`) and set:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=yyyyyyyy
   CURRENCY=usd
   CURRENCY_SYMBOL=$
   ```
   (Charging USD via Razorpay needs "International payments" enabled on your
   account; for rupees use `CURRENCY=inr` / `₹` and a rupee `PRICE_PER_CELL`.)
3. Run with the env file (no extra packages needed):
   ```bash
   npm run start:env
   ```
   Now "Pay & claim" opens Razorpay Checkout (UPI / cards / netbanking / wallets).
   Test with UPI id `success@razorpay`, or card `4111 1111 1111 1111`, any future
   date, any CVC.

**How it stays safe:** the server creates the order, the browser pays, then the
server **verifies Razorpay's signature** before any cell is marked sold. Unpaid
selections release after 30 minutes.

> **Going live:** swap test keys for `rzp_live_...` keys. Accepting real money
> requires completing Razorpay's KYC / business activation (PAN, bank account).

### Stripe instead (optional)

Leave Razorpay keys empty, run `npm install stripe`, set `STRIPE_SECRET_KEY` and
`BASE_URL`. Stripe uses a hosted-checkout redirect. Razorpay takes priority if
both are configured.

---

## Deploying to the internet (you don't need your own server)

The app is one small Node process. Storage is pluggable: a **JSON file** by
default, or **Postgres** when you set `DATABASE_URL`. That second option is what
lets it run on a free always-on host with no disk. Pick a path:

### Path A — Render free + free Postgres (₹0/month, always-on) ⭐ recommended

1. Put this folder on **GitHub** (free).
2. Make a **free Postgres** at [Neon](https://neon.tech); copy its connection string.
3. Create a **Web Service** on [Render](https://render.com), connect the repo
   (Build `npm install`, Start `npm start` — auto-detected).
4. Add env vars: `DATABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `CURRENCY=usd`, `CURRENCY_SYMBOL=$`.
5. Deploy → a free `https://your-app.onrender.com` URL. Data lives in Postgres, so
   nothing is lost on sleep/redeploy. The `pg` driver already ships with the app.

Prefer the simple JSON file instead? Use the included `render.yaml` (it adds a
persistent disk) on a paid instance, or a Railway **Volume** + `DATA_DIR=/data`.

### Path B — Free, from your own potato PC: **Cloudflare Tunnel**

No port-forwarding, no static IP, free HTTPS. Keep the PC on and:

1. Run the app: `npm run start:env` (listening on `localhost:4000`).
2. Install `cloudflared`, then: `cloudflared tunnel --url http://localhost:4000`.
3. It prints a public `https://something.trycloudflare.com` URL that anyone can open.

Trade-off: the site is only up while your PC + internet are up.

Full click-by-click instructions, including the payment webhook, are in
**[DEPLOY.md](DEPLOY.md)**.

> Note: true *serverless* hosts (Vercel/Netlify Functions) aren't a fit even with
> `DATABASE_URL` — the canvas is held in memory in one long-lived process. Use a
> normal Node host (Path A).

---

## Make it yours

Tunables live at the top of `server/server.js` or in `.env`:

| Setting | Default | Meaning |
|---|---|---|
| `BRAND` | `Flexsquare` | Name in navbar + title |
| `GRID_COLS` × `GRID_ROWS` | `64 × 32` | Canvas size (2,048 cells) |
| `PRICE_PER_CELL` | `0.5` | Price of one cell |
| `CURRENCY` / `CURRENCY_SYMBOL` | `usd` / `$` | Currency |
| `DATA_DIR` | `server/data` | Where the JSON store is written (file mode) |
| `DATABASE_URL` | _(unset)_ | If set, store in Postgres instead of a file |

At defaults the whole canvas is worth **$1,024** (2,048 × $0.50). Change `BRAND` and it re-themes
everywhere.

## Layout

```
frontend/   index.html · app.js · styles.css   ← static site  → deploy to VERCEL
backend/    server.js                           ← API + Razorpay/Stripe  → deploy to RAILWAY
            store.js                            ← storage: JSON file or Postgres (Supabase)
            package.json                        ← backend deps + start
            data/state.json                     ← placements in file mode (local dev)
package.json                                     ← local all-in-one launcher (runs backend/)
```

Deploy split: **frontend/ → Vercel**, **backend/ → Railway**, **Postgres + image storage → Supabase**. See [DEPLOY.md](DEPLOY.md).

- `GET  /api/state`            → canvas config + which cells are sold
- `POST /api/checkout`         → reserve cells, start payment (or claim in demo)
- `POST /api/razorpay/verify`  → confirm Razorpay signature, finalize cells
- `POST /api/razorpay/webhook` → server-to-server payment backstop
- `GET  /api/checkout/success` → Stripe redirect target (Stripe path only)
