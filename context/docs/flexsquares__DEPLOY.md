# Deploy Flexsquare

Two ways to host it:
- **Option A — Everything on Railway** (recommended, simplest). One service + Railway
  Postgres + a Railway Volume. No Vercel, no Supabase.
- **Option B — Split** across Vercel + Railway + Supabase (more pieces; further below).

---

# Option A — Everything on Railway ⭐

```
  Browser ──> Railway service (serves frontend/ AND /api on flexsquares.space)
                 ├─ Railway Postgres   (placements)        ← DATABASE_URL
                 └─ Railway Volume      (uploaded images)   ← UPLOAD_DIR=/data/uploads
```

1. **Push to GitHub**, then on [Railway](https://railway.app): **New Project →
   Deploy from GitHub repo**. Leave **Root Directory empty** (repo root) — `npm start`
   runs the backend, which also serves the frontend.
2. **Add Postgres:** in the project, **New → Database → Add PostgreSQL**. Then in your
   service's **Variables**, add a reference: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
3. **Add a Volume (for images):** service → Settings → **Volumes** → mount path `/data`.
   Then set variable `UPLOAD_DIR=/data/uploads`.
4. **Other variables** (service → Variables): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `CURRENCY` (`inr` or `usd`), `CURRENCY_SYMBOL` (`₹`/`$`). That's it — no `FLEX_API`,
   no `ALLOWED_ORIGIN`, no `SUPABASE_*` needed (everything's one origin).
   **Don't set `PORT`** — Railway injects it.
5. **Domain:** service → Settings → **Networking → Custom Domain** → add
   `flexsquares.space` and `www.flexsquares.space`. Railway shows the DNS records
   (an `A`/`CNAME` for the apex + a `CNAME` for `www`) — add them at your registrar.
6. **Payments:** start in Razorpay test mode; for real money finish KYC, switch to live
   keys, and add a webhook → `https://flexsquares.space/api/razorpay/webhook`
   (set `RAZORPAY_WEBHOOK_SECRET` to match).

Done — that's the whole thing on Railway.

---

# Option B — Split: Vercel + Railway + Supabase

(Only if you want the frontend on a separate CDN. More moving parts.)

## 1) Supabase — database + image storage  **(you)**

1. Create a project at <https://supabase.com>.
2. **Database URL:** Project Settings → Database → *Connection string* → **URI**.
   Copy it (looks like `postgresql://postgres:[pw]@db.[ref].supabase.co:5432/postgres`).
   The app auto-creates its table on first run.
3. **Storage bucket:** Storage → **New bucket** → name it `placements` → make it **Public**.
4. **API keys:** Project Settings → API → copy the **Project URL** and the
   **`service_role`** key (secret — backend only, never in the frontend).

## 2) Railway — backend  **(you)**

1. Push this repo to GitHub, then on [Railway](https://railway.app):
   **New Project → Deploy from GitHub repo**.
   - **Root Directory:** `backend`  (Settings → Root Directory)
   - It auto-detects Node (`npm install` + `npm start`).
2. **Variables** (Settings → Variables):
   - `DATABASE_URL` = the Supabase URI from step 1.2
   - `SUPABASE_URL` = Supabase Project URL
   - `SUPABASE_SERVICE_KEY` = the `service_role` key
   - `SUPABASE_BUCKET` = `placements`
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (test keys are fine to start)
   - `CURRENCY` = `inr`, `CURRENCY_SYMBOL` = `₹`  (or `usd`/`$`)
   - `ALLOWED_ORIGIN` = `*` for now (tighten to your Vercel URL after step 3)
3. Deploy → you get a URL like `https://flexsquare-production.up.railway.app`.
   Open `…/api/state` — you should see JSON. ✅ Backend live.

## 3) Vercel — frontend  **(you)**

1. **Point the frontend at the backend:** edit `frontend/index.html`, find
   ```html
   <script>window.FLEX_API = "";</script>
   ```
   and set it to your Railway URL:
   ```html
   <script>window.FLEX_API = "https://flexsquare-production.up.railway.app";</script>
   ```
   Commit + push.
2. On [Vercel](https://vercel.com): **Add New → Project** → import the repo.
   - **Root Directory:** `frontend`
   - **Framework Preset:** Other  (no build step — it's static)
3. Deploy → you get `https://flexsquare.vercel.app`. That's your live site.
4. Back in **Railway**, set `ALLOWED_ORIGIN` to your Vercel URL (e.g.
   `https://flexsquare.vercel.app`) so only your frontend can call the API. Redeploy.

## 4) Payments — go live  **(you)**

- Start in Razorpay **Test mode** (works immediately). Test UPI `success@razorpay`.
- For real money: finish Razorpay **KYC**, switch to **Live mode**, swap in
  `rzp_live_…` keys on Railway. Add a **webhook** → `https://<railway>/api/razorpay/webhook`
  with a secret, and set `RAZORPAY_WEBHOOK_SECRET` to match.
- Charging **USD** via Razorpay needs "International payments" enabled; otherwise use
  `CURRENCY=inr`.

## 5) Custom domain — flexsquares.space  **(you)**

Plan: **`flexsquares.space` → Vercel (frontend)**, **`api.flexsquares.space` → Railway (backend)**.

1. **Vercel** → Project → Settings → **Domains** → add `flexsquares.space` and
   `www.flexsquares.space`. Vercel shows the exact DNS records to create.
2. **Railway** → backend service → Settings → **Networking** → **Custom Domain** →
   add `api.flexsquares.space`. Railway shows a CNAME target.
3. At your **domain registrar** (where you bought flexsquares.space) add these DNS records:

   | Type  | Name  | Value                         | For |
   |-------|-------|-------------------------------|-----|
   | A     | `@`   | `76.76.21.21`                 | Vercel apex (use the value Vercel shows) |
   | CNAME | `www` | `cname.vercel-dns.com`        | Vercel www |
   | CNAME | `api` | *(the target Railway shows)*  | Railway backend |

4. After DNS propagates (minutes–hours), set on **Railway**:
   - `ALLOWED_ORIGIN=https://flexsquares.space`
   - `BASE_URL=https://api.flexsquares.space`
   The frontend already auto-points to `https://api.flexsquares.space` in production
   (see the `window.FLEX_API` script in `frontend/index.html`).

## Variables reference (set all of these on Railway)

| Variable | Example | Where it comes from |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:…@db.[ref].supabase.co:5432/postgres` | Supabase → Settings → Database → URI |
| `SUPABASE_URL` | `https://[ref].supabase.co` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | `eyJhbGciOi…` | Supabase → Settings → API → **service_role** (secret) |
| `SUPABASE_BUCKET` | `placements` | the public bucket you created |
| `ALLOWED_ORIGIN` | `https://flexsquares.space` | your Vercel domain (`*` while testing) |
| `BASE_URL` | `https://api.flexsquares.space` | your Railway domain |
| `RAZORPAY_KEY_ID` | `rzp_test_…` / `rzp_live_…` | Razorpay → API Keys |
| `RAZORPAY_KEY_SECRET` | `…` | Razorpay → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | *(you choose)* | match it in Razorpay → Webhooks |
| `CURRENCY` / `CURRENCY_SYMBOL` | `inr` / `₹` | your choice (`usd` / `$`) |
| `PRICE_PER_PIXEL` | `0.5` | your pricing |
| `MIN_PRICE` | `50` | smallest charge |
| `MIN_IMAGE_DIM` | `200` | reject images smaller than this (long side) |
| `CANVAS_WIDTH` / `CANVAS_HEIGHT` | `1920` / `1080` | canvas size (optional) |

> **Do NOT set `PORT`** on Railway — it injects that automatically.
> **Vercel needs no variables** — the API URL is baked into `frontend/index.html`.

---

### Notes
- **Why the backend can't go on Vercel:** it's a long-lived stateful Node process
  (keeps the canvas in memory). Vercel is serverless/stateless — so the backend lives
  on Railway. Vercel only serves the static frontend.
- **Local dev (all-in-one):** leave `window.FLEX_API = ""` and run `npm run start:env`
  from the project root — the backend serves the frontend at <http://localhost:4000>.
- Without `SUPABASE_*` set, uploads fall back to local disk (fine for dev, wiped on
  cloud redeploys — so always set Supabase Storage in production).
