---
name: project-blankspace
description: "Flexsquares — sell-the-white-space website (buy rectangles on a shared canvas) with Razorpay payments, at D:\AKHIL\HP\flexsquares"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ce526a-2bf2-46af-a3b7-5bf759494971
---

**Flexsquares** ("Flex your square.") — a Million-Dollar-Homepage–style site: a navbar over a big white canvas; buyers select an empty rectangular area and buy it (their color/image/link/message fill it forever). Brand is the `BRAND` env (default "Flexsquares"). Name history: Blankspace → Flexspace → **Flexsquares**. **Project folder is `D:\AKHIL\HP\flexsquares`** (the earlier `F:\Blankspace` / `F:\Flexspace` no longer exist). Git remote: `github.com/gamepadadmin01-tech/flexspace.git`. Preview launch config name "flexsquares" (port 4000) in `D:\AKHIL\HP\.claude\launch.json`.

Stack: Express, no build step. **Restructured into `backend/` + `frontend/` for split deploy** (Vercel frontend + Railway backend + Supabase Storage for images). Root also has a `package.json`. Run locally: `cd D:\AKHIL\HP\flexsquares\backend && npm install && npm start` → http://localhost:4000 (backend serves the frontend statically too in the combined Railway deploy).

- **Canvas/pricing**: rectangles, not fixed cells — `validPlacement` allows rotation, image scale/offset; overlap uses Separating-Axis-Theorem OBB intersection. Price is **₹0.5 per pixel** (`PRICE_PER_PIXEL`=0.5, INR, canvas 1920×1080, `MIN_PRICE` floor). Computed server-side from the rect area (not client-trusted).
- **Payments**: Razorpay primary (REST via fetch, no npm pkg) + Stripe optional + demo fallback. `/api/checkout` creates a Razorpay order; `/api/razorpay/verify` checks HMAC-SHA256(`order_id|payment_id`) before finalizing; `/api/razorpay/webhook` (raw body, HMAC-verified) is the backstop and also handles refund events. Plus: refund→remove placement, admin CSV/JSON export, abandoned-`pending` expiry after RESERVE_MS (10 min).
- **Storage** (`backend/store.js`): JSON file `backend/data/state.json` (default) OR Postgres when `DATABASE_URL` set (`pg` optional dep, whole-doc JSONB in `flexspace_state`). In-memory state, writes queued+coalesced → one long-lived process, NOT serverless. ⚠️ Known scaling smell: full-document rewrite on every purchase (O(n²) over time) — left as-is, fine at small scale.
- **Security hardening applied 2026-06-28** (this session): CSP (site-wide + strict `default-src 'none'; sandbox` on `/uploads`), upload validation by magic bytes (rejects SVG → kills stored-XSS) + 5 MB cap, in-memory IP rate limits on `/upload` + `/checkout`, constant-time admin-key compare, overlap re-check in `finalize` (late-payment double-claim), orphaned-upload cleanup on cancel/expire. `nodemailer` was added-but-unused → removed.

Part of the user's cluster of F-drive projects — see [[project-fdrive-overview]]. NOTE: the GamepadOS project ([[project-realtime-latency-stack]], [[project-downloads-feedback]]) briefly lived nested at `F:\flexsquares\hlooo` (on the old F: drive) but was moved out to what is now **`D:\AKHIL\HP\hlooo`** on 2026-06-28. (An earlier note claimed F: was a Google Drive mount — it was not; it was a local NTFS disk with no cloud sync and no version history.)
