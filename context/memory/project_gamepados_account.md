---
name: project-gamepados-account
description: "GamepadOS Account System rebuild in D:\AKHIL\HP\App with login — repo, architecture decisions, phase plan"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8a4bab65-1128-46ca-9fc1-f0c5a999be83
  modified: 2026-07-25T07:35:52.405Z
---

**GamepadOS Account/identity system.** Started 2026-07-24.

🚩 **ALL WORK HAPPENS IN `D:\AKHIL\HP\hlooo`** (Akhil's call, 2026-07-24 — "everything preserved,
one tree"). `D:\AKHIL\HP\App with login` was a partial fork holding Phases 0–1; that work is now
ported into hlooo and the fork is **abandoned** — do not edit it.
- App source (`D:\AKHIL\HP\hlooo\apps\**`): has **no version control**. Backups only, e.g.
  `App.tsx.bak-20260722-preaccount`. Take one before every App.tsx edit.
- Backend (`D:\AKHIL\HP\hlooo\website` = repo `gamepadadmin01-tech/gamepad`): **make changes,
  never commit** — Akhil commits and decides what deploys and when.
- Fork repo `gamepadadmin01-tech/app-with-login` holds commits a025342 (Phase 0),
  12df162 (Phase 1), 51ec2dd (untrack .cxx) — historical reference only, unpushed.

**Origin:** another AI (Antigravity) wrote an account prototype + a HANDOFF.md that was
largely false — components existed but `App.tsx` was byte-identical to the hlooo baseline,
so nothing rendered; it shipped 222 KB of Supabase SDK and a `setIsGuest()` call with no
such setter. Removed in Phase 0.

**Decisions (made with Akhil, do not re-litigate):**
- Identity lives on **our own Railway backend**, not Supabase. Reuses the existing
  scrypt + `AdminSession` + email-verification patterns in `website/backend`.
- **Database STAYS on Supabase** (reversed 2026-07-24 — "railway takes cost"). No migration.
  `DATABASE_URL` = `aws-1-ap-south-1.pooler.supabase.com:6543?pgbouncer=true` (the pgBouncer
  flag Prisma needs is already set). Backend still runs on Railway; only the DB is Supabase.
  Schema changes reach it via `prisma db push` in `prestart` on deploy.
- Three separate identities: **pairing** (GRX, exists), **installation** (new, guests have
  one, no login), **account** (optional, cloud only). The controller path must never read
  account state.
- `App.tsx` (4,700 lines, mixed CRLF) is edited **surgically with unique anchors only** —
  never regex/Node patchers. See [[project-grx-crypto]] for the July 14 corruption.

**Phase plan:** 0 delete prototype ✅ · 1 typed native façade + install id ✅ · 2 store/
repositories over all 11 localStorage keys ✅ · 3 Account tab + guest menu, **no auth**,
all data real ✅ **verified on device 2026-07-24** (1.3.23/build 47 on DAIFEYGEKB89V4QG) ·
4 backend User/UserSession/UserDevice +
auth — flip `accountsAvailable()` in `capabilities/features.ts` to turn accounts on ·
5 per-pad layout sync (LWW on `updatedAt` + `deviceId`, never blob) · 6+ ecosystem
features via the registry.

⚠️ **`App.tsx` contains 1,212 non-breaking spaces (U+00A0) used as indentation.** Edit
anchors that look like leading spaces will silently fail to match. Always verify the
bytes, or anchor on an ASCII-only substring, and count occurrences before replacing.

**Scope cut, 2026-07-24 (Akhil):** the goal is **simple login so users can save their
gamepads** — nothing broader. Dropped: device management/identity entirely (no install id,
no `deviceId` on pads, no Devices section, Kotlin `prefGet`/`prefSet` removed), "Copy my
data" export, Standard-layout count (built-ins are ours, not the user's), Build + Channel
in About. **The whole Advanced/Session tab is gone** — nav is now Home · System · Account —
and its About text, `UpdateChecker` and `FeedbackCard` moved into Account (feedback would
otherwise have vanished from the app). Pads still carry `updatedAt` for last-write-wins on
cloud save. Account also has a **Test rumble** button (`testRumble()` → bridge
`triggerRumble`).

🚩 **GUEST MODE REVERSED, 2026-07-24 (Akhil):** "completely remove the guest mode, it was
not in my plan, antigravity did that." There is **no Guest identity anywhere**. Signed out,
the Account tab is a *sign-in screen* and shows no profile and no settings; the header pill
reads "Sign in". The rest of the app (Home/System/controller) still works signed out — only
the Account surface is gated. The app-info block (version, update checker, feedback) stays
visible in both states deliberately: someone who cannot sign in must still be able to
update and report a bug. Earlier guest-first work in this file is superseded.

**Auth built app-side 2026-07-24:** `api/account.ts` (bearer-token client, `ApiError`),
`store/account.ts` (session persist + startup `revalidate()`; a *network* failure keeps the
session, only an explicit reject signs out), `components/AccountAuth.tsx` (sign in · create
· 6-digit email verify · forgot · reset, with show-password, per-field validation, verbatim
server errors, `unverified` routed to the verify step).

**Phase 4 backend WRITTEN 2026-07-24, UNCOMMITTED in `D:\AKHIL\HP\hlooo\website`** (Akhil commits +
deploys). Prisma models `User` / `UserSession` / `Layout`; 8 routes under `/api/account/*`
(register · resend · verify · login · me · logout · password/forgot · password/reset),
reusing `auth.js` scrypt + `newSessionToken` + `sendMailSafe`/Brevo. Bearer tokens, 90-day
sessions. **`/api/account` had to be added to `publicCors`** — the app's WebView origin
`appassets.androidplatform.net` is not on the admin allowlist, and that (not a 404) was why
early probes returned "Failed to fetch". Also dropped `--accept-data-loss` from `prestart`,
which could have dropped user tables on any deploy. Tables auto-create on first deploy via
`prisma db push`. Nothing works end-to-end until Akhil deploys.
Also fixed: `SLabel` was `font-mono`, which made the About cards read as a different app —
now sans, matching the Account panels.

**Akhil's rule, 2026-07-24 (hard):** the Account tab shows **actual data only**. No
"coming soon", no locked/planned rows, no Integrations section. A feature appears on
screen only once it works. This deleted `capabilities/features.ts` and
`components/GuestAccountMenu.tsx`; the header Guest button now navigates straight to the
Account tab. Account is a *minor* part of the app — keep it cheap and never let it slow
the controller.

**controller-ui dead-weight purge (2026-07-24):** deleted the unused shadcn scaffold
`src/app/components/ui/` (48 files), `components/figma/`, `GamepadWidgets.tsx` (dead —
`Widgets.tsx` is live) and `src/imports/` — 64 files, 615 KB. **This cut the bundle by
62.9 KB (575→510 KB): the JS was byte-identical, the saving was all Tailwind CSS**, which
had been emitting utility classes only those 48 unrendered files referenced. `package.json`
deps went 57 → 4 (framer-motion, lucide-react, react, react-dom); also dropped
`@capacitor/*` devDeps — `apps/controller-ui/android/` is a vestigial Capacitor project,
the real APK builds from `apps/android-client`. Restore with `npm i -D @capacitor/cli
@capacitor/android` if anything turns out to need it.

**Release state 2026-07-25:** account work is **1.3.24 / code 48**, built as a signed
`assembleDirectRelease` (2.04 MB, not debuggable, key `5b5537c6…67b7cc` = same production
key as shipped 1.3.7-direct), bundle hash-matches dist, zero "Guest"/demo strings. In
downloads as `GamepadOS-1.3.24.apk` + `GamepadOS.apk`.
⚠️ **Version-collision lesson:** 1.3.23/47 was Register+Activated at 2026-07-24T17:55Z and
then its APK file was overwritten at 17:31Z+ with account content — same versionCode, two
different binaries, and anyone on 47 would never be offered an update. Hence the bump to 48.
`GamepadOS-1.3.23.apk` in downloads still reports code 47 but carries account content; no
pristine pre-account 47 artifact exists anywhere (`releases/` has none). Also note **code 47
has no changelog comment** in build.gradle.kts — every other code does.
**Release table still says `app 1.3.23` ACTIVE — 1.3.24 needs Register & Activate.**
**`/api/account/*` backend is still UNDEPLOYED**, so sign-in shows "Couldn't reach
GamepadOS" until Akhil deploys. PC server: `pc 1.1.17` (Python) active; Rust
`GamepadServer-Setup-2.0.0.exe` in downloads **unregistered**. Test data removed: rating
ticket `2105a850…` deleted from the live DB (a genuine 5/5 from 2026-07-22 left alone).

**Phase 5 layout sync WRITTEN 2026-07-25 (uncommitted):** backend `GET /api/account/layouts`
+ `POST /api/account/layouts/sync` (merge, last-write-wins on `updatedAt` per padId);
client `store/sync.ts` + tombstones (`gp_deleted_pads`) + `gp_last_sync`, `onPadsReplaced`
so React adopts a sync result, debounced `scheduleSync()` on pad change, pull on sign-in,
and a "Backup → Cloud backup" row in Account with real status + manual retry.
**Key invariant: an absent pad NEVER means delete** — only a tombstone does — otherwise a
fresh install would push emptiness up and wipe the account. Verified with 10 logic checks.
Why it was needed: Akhil reinstalled and lost his custom pad (layouts were local-only);
that pad is unrecoverable.

**Open items:** `apps/android-client/app/release.keystore` is committed to GitHub (password
is not — it comes from gitignored `local.properties`); needs history purge if the repo is
public. Backend `prestart` still runs `prisma db push`; full migration baseline lands with
the Railway DB move.
