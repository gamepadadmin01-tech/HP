# gamepados-account — the 3 unpushed commits

`projects/gamepados-account/` (GitHub: `gamepadadmin01-tech/app-with-login`) was **deleted on
2026-08-14** at the user's instruction. It was a 7 GB fork of the main tree, superseded as a
project — but it had **3 commits that were never pushed**, so those are preserved here as patches
rather than lost with the folder.

Also preserved separately, at `../gamepados-account-unique/`: the fork's `native.ts` and its Gradle
wrapper.

## Why the fork was superseded

The account system was continued in the **main** tree, not here. Main has the complete
implementation — `components/AccountAuth.tsx`, `components/TabAccount.tsx`, `api/account.ts`,
`store/account.ts` — and **none of those files exist in the fork**. Main also carries an
`App.tsx.bak-20260722-preaccount` backup marking where that work started. Main's newest source is
2026-08-13; the fork's is 2026-07-24.

## The patches

| Patch | Size | What it is |
|---|---|---|
| `0001` Phase 0 | 54 KB | Removes the Supabase account prototype and its unsafe tooling (13 files) |
| `0002` Phase 1 | 25 KB | **The one with real value** — typed native façade + installation identity (5 files) |
| `0003` | 3.0 MB | Stops tracking NDK `.cxx` build artifacts (335 files, nearly all binary deletions of regenerable output) |

**Patch 0002 is the substantive one.** It is where `getInstallId`, `getDeviceInfo`,
`getDeviceLabel`, `getHapticCapabilities` and the `DeviceInfo` type live — five exports that the
main tree's `native.ts` does **not** have. Main went a different direction on 2026-07-25 (it added
`testRumble` and dropped the device-identity surface), so this is abandoned-but-real work, not a
duplicate.

Verified before archiving: no patch touches `.env`, a keystore, a `.pem`, `local.properties` or
`secrets/`.

## Restoring

The commits sit on top of `origin/main` of `app-with-login`. To get them back:

```bash
git clone https://github.com/gamepadadmin01-tech/app-with-login.git
```

```bash
git am /path/to/0001-*.patch /path/to/0002-*.patch /path/to/0003-*.patch
```

To take only the useful part, apply `0002` alone.

## One security note

`apps/android-client/app/release.keystore` **is committed in that repo's git history.** The repo
is private (an unauthenticated request returns 404), so this is not a public leak — but anyone with
access to the repo has the Play Store signing key. Rotating it is not possible without orphaning
every existing install, so the practical mitigation is to keep the repo private and limit access.
