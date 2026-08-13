---
name: website-backend-architecture
description: "GamepadOS website/support-platform backend architecture — stack, subsystems, key gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2eb8022d-fde2-405c-89f1-4aee6551258f
---

The `D:\AKHIL\HP\hlooo\website\` half of GamepadOS is a **support/ticketing platform** (separate from the realtime gamepad product in `apps/`). Mapped in depth 2026-06-21.

**Why:** User wants beast-level mastery of it; full study plan saved at `D:\AKHIL\HP\hlooo\GamepadOS_Study_Plan.md`. Reference this for any website/backend work. See [[fdrive-overview]].

## Stack
- **backend/** — Express 5 + Prisma ORM, single `server.js` (~1148 lines, ~38 routes). Postgres in prod (Railway), SQLite local (`schema.local.prisma`).
- **frontend/** — Vite static multi-page site (Vercel), 4 HTML pages, hand-authored MPA.
- **Email** — Brevo HTTP API (Railway blocks SMTP). Inbound email → webhook at `POST /api/email/inbound?token=`.

## Local dev gotcha (2026-07-18, verified)
- DB is **Supabase Postgres (aws-1-ap-south-1 pooler)**, shared by prod (Railway) and local dev via `backend/.env`. **This PC's network BLOCKS outbound port 5432** (TCP test: 5432 fails, 6543 succeeds) → local `.env` DATABASE_URL now uses **port 6543 (transaction pooler) + `?pgbouncer=true`** and the password's `@` is URL-encoded (`%40`). Symptom when broken: server boots but every admin page 302s to a login that can't work ("can't see admin pages / analytics"). Prod was never affected. `npm run dev` locally (prestart's `db push` may not work through the transaction pooler — DDL needs 5432, which is blocked; schema changes must be pushed by deploy).
- Self password change now needs an emailed 6-digit code: `POST /api/admin/me/password/code` (current pw → code to account email, 10-min TTL, 5 tries, 60s cooldown, 5/hr) then `POST /api/admin/me/password {current,next,code}`. Email-disabled hosts waive the code. Commit 85b10fe (UNPUSHED with f86b665).

## DNS / hosting
- Custom subdomain **`admin.gamepad.space`** → the Railway backend. **DNS is at Namecheap**
  (CNAME `admin` → the Railway target). Frontend on Vercel at `gamepad.space`. Backend root `/`
  returns a health JSON.
- `D:\AKHIL\HP\hlooo\website\` **is** the local clone of the live repo
  `github.com/gamepadadmin01-tech/gamepad`. Edit here directly — never clone to a temp dir. The
  old, stale `support-website` copy inside the apps monorepo no longer exists.

## Two glue config strings
- `VITE_API_BASE` — baked into frontend at BUILD time (public). Wrong → site can't reach backend.
- `FRONTEND_URL` — backend CORS allowlist (Railway runtime). Wrong → form fails in browser but curl works.

## Key subsystems
- Data: Ticket, TicketMessage, Admin, AdminSession, AuditLog, Setting, CannedResponse.
- Auth (`auth.js`): scrypt+salt+timingSafeEqual, opaque session token as cookie `gp_admin`. Bearer `ADMIN_PASSWORD` = synthetic-owner back door (no audit trail, reaches SSE stream).
- **3 UNPUSHED commits on main (2026-07-18/19), ahead of origin by 3 — user pushes when ready:** `f86b665` 3-role portal + email verify + test-mail removal; `85b10feb` password-change email-code (Antigravity-authored, reviewed OK); `9495115` intelligent scored ticket assigner + review fix.
- **Password self-change requires an emailed 6-digit code** (POST /api/admin/me/password/code → /api/admin/me/password with `code`). In-memory `pwChangeCodes` Map: SHA-256-hashed code, 10-min expiry, 5-try lockout, 60s resend cooldown, 5 sends/hr, timingSafeEqual, audited. Waived when EMAIL_ENABLED is false. Portal modal is 2-step (pwStep1 current+new → pwStep2 code+resend). Single-instance assumption like presence.
- **Intelligent auto-assigner** (`pickAssignee(ticketData)`): scored, lower=better. load penalty `activeTickets²×50` (quadratic → even spread), affinity `−300×min(resolvedFromSameEmail,5)` (returning customer → prior agent; email match is case-INSENSITIVE), expertise `−20×min(resolvedSameSubject,10)`. Business→owners only. Validated by `backend/test-assigner.js` sim (1000 tix/100 agents: active load ~4 avg balanced, 0 business→non-owner). Called from POST /api/support/ticket.
- **LOCAL DEV DB GOTCHA:** this PC BLOCKS outbound TCP 5432 (Supabase session pooler) → local `node server.js` throws "Can't reach database server". FIX applied in `.env` (gitignored, local-only): DATABASE_URL uses port **6543** (transaction pooler) + `?pgbouncer=true`, and the `@` in the password is `%40`. Live Railway host uses 5432 fine (not blocked). Prod DB = Supabase `aws-1-ap-south-1.pooler.supabase.com`.
- **"Admin pages / analytics won't open" is NOT a bug:** `/admin` and `/admin/analytics` correctly 302→`/admin/login` when not authenticated; analytics also 302→`/admin` for agent role (staff-only). Live backend healthy (auth-state 200). If pages "don't open" the session is just unauthenticated/expired → sign in. Demo preview: file:// role switcher (bottom-right) is sticky via localStorage; works in real Chrome (Claude's snapshot pane doesn't round-trip localStorage through reload, so role-switch can't be verified there — drive ME in-memory instead).
- **Roles (since 2026-07-18, commit f86b665 — UNPUSHED until user pushes): owner / admin / agent.** `requireStaff` = owner+admin. Admin = everything EXCEPT creating/managing admins+owners and activating releases (releases view-only). Agent = tickets only; GET team returns fellow agents only (no emails); overview/analytics/downloads/releases/broadcast/audit/contacts are staff-gated; ticket delete = staff. SSE clients map stores `{token, role}`; `download:update` broadcasts staff-only. Role is a plain String column — no schema change was needed.
- Team-email creation runs `checkAdminEmail`: strict regex + explicit duplicate pre-check + DNS MX→A/AAAA probe (ENOTFOUND/ENODATA rejects; DNS infra errors/timeouts fail OPEN; 10-min `_mxCache`). `POST /api/admin/email-test` REMOVED (test-mail button gone); `/api/admin/email-status` survives as an Overview status line.
- Admin portal: `admin.html` single-file vanilla-JS SPA, optimistic updates, SSE live stream + 20s poll. 2026-07-18 refactor: role-aware left sidebar (agent sees only Inbox+Team), dedicated Overview view (staff), per-role Team modal, view-only Releases for admin. Demo preview: open the file via file:// with `?role=` or `#role=` owner|admin|agent.
- Inbound webhook (`inbound.js`): ack-200-first then background; 3-tier ticket matching; split DB write to survive missing columns.
- CSAT: `GET /api/csat` + `POST /api/csat/:ticketId/feedback`.

## Known gotchas / weaknesses (real, verified)
- `/downloads` is served publicly UNAUTHENTICATED but multer admin uploads also land there → support attachments publicly downloadable by filename guess.
- `uploads/` dir is DEAD (multer writes to `downloads/`).
- No rate limiting on login, no CSRF tokens, no idempotency on inbound email (dup possible).
- `db push` (no migrations/rollback) runs in `prestart`; `node server.js` directly skips schema sync.
- Single-instance assumptions: in-memory presence Map + settings cache break under horizontal scaling.
- `GamepadServer-Setup.exe` vs `GamepadServer.exe` — version manifest must point at the right committed binary.
