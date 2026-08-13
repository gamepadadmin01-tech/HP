---
name: live-helpdesk-repo
description: "The live GamepadOS support helpdesk runs from a SEPARATE repo, far ahead of the monorepo's support-website copy"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5f913c96-5d10-47a3-b32c-e27c9985c4d6
---

The live support **helpdesk** ("GamepadOS Support", the admin portal the user
replies to tickets in) is deployed from a **separate GitHub repo**:
`github.com/gamepadadmin01-tech/gamepad` — backend on **Railway**
(`gamepad-production-9351.up.railway.app`), frontend on **Vercel**
(`gamepad.space`). The admin dashboard is `backend/admin.html` + `backend/server.js`,
gated by a **session-cookie login** at `/admin/login` (multi-admin: owner/agent
roles, teams, audit log, presence, canned replies, inbound-email threading).

**The user's local clone of this live repo is `F:\hlooo\website\`** (the "website"
project — `backend/` + `frontend/`, remote = the gamepad repo, edits & deploys
happen here). EDIT HERE, in this real folder — do not clone to a temp dir.

**This live repo is FAR AHEAD of `F:\hlooo\support-website`** (the copy inside the
apps monorepo). The monorepo copy is a stale, primitive Basic-Auth version — do
NOT treat it as the source of truth, and do NOT deploy it. `support-website/publish.ps1`
would overwrite production with the stale folder; it is now guarded and aborts
unless run with `-ForceOverwriteProduction`. **Fix the live helpdesk by editing
its own repo directly** (clone it, branch, PR/merge → Railway+Vercel auto-deploy
from `main`).

Custom subdomain **`admin.gamepad.space`** points at the Railway backend (DNS at
**Namecheap**, CNAME `admin` → Railway target). The backend root `/` returns a
health JSON. See [[project-layout]].

2026-06-14: added real-time SSE so emailed user replies show without a manual
refresh (was a relaxed 20s poll) — shipped on branch `realtime-inbox` (PR pending
merge at the time of writing).
