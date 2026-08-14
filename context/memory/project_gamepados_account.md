---
name: project-gamepados-account
description: The account/identity system — it lives in the MAIN tree; the separate fork was deleted 2026-08-14
metadata: 
  node_type: memory
  type: project
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-14T04:34:02.116Z
---

## Where it lives now

**In the main tree**, `projects/gamepados/apps/controller-ui/src/app/`:

- `components/AccountAuth.tsx`
- `components/TabAccount.tsx`
- `api/account.ts`
- `store/account.ts`
- `platform/native.ts`

There is also an `App.tsx.bak-20260722-preaccount` marking where the work started.

## The fork is gone — do not go looking for it

`projects/gamepados-account/` (formerly `App with login`, GitHub
`gamepadadmin01-tech/app-with-login`) was **deleted 2026-08-14**. It was a full 7 GB duplicate of
the main tree and it was **superseded**: it never had `AccountAuth.tsx`, `TabAccount.tsx`,
`api/account.ts` or `store/account.ts`. Its newest source was 2026-07-24; main carried on past it.

Its 3 unpushed commits were exported as patches before deletion —
`context/archive/gamepados-account-unpushed-commits/` — along with its `native.ts` and Gradle
wrapper at `context/archive/gamepados-account-unique/`. The GitHub repo still exists and still
holds everything up to `origin/main`.

**The one thing worth recovering from it:** patch `0002` (Phase 1) adds `getInstallId`,
`getDeviceInfo`, `getDeviceLabel`, `getHapticCapabilities` and a `DeviceInfo` type to `native.ts`.
Main's `native.ts` has none of those — main added `testRumble` instead and dropped the
device-identity surface on 2026-07-25. If installation identity is ever needed, that patch is the
starting point rather than a rewrite.

## Security note

`release.keystore` is committed in that GitHub repo's history. The repo is **private** (an
unauthenticated request returns 404), so it is not publicly leaked, but anyone with repo access
holds the Play signing key. It cannot be rotated without orphaning every existing install — see
[[reference_release_checklist]] — so the mitigation is keeping the repo private and limiting access.

Related: [[project_grx_crypto]], [[project_website_backend]].
