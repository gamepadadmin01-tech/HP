# Document Index — 108 files

Every markdown document that existed anywhere under `D:\AKHIL\HP`, copied here on
**2026-08-13**. The originals are all still in place — these are copies, not moves.

Filenames are the original path with `\` replaced by `__`, so you can always tell where a
document came from. `_manifest.csv` has the exact original path, size, and modified date for
every file.

---

## Read these first

If you are a new session (or a new laptop) and need to get oriented, read these seven in order:

| # | File | Why |
|---|---|---|
| 1 | `hlooo__RELEASE.md` | Release process and current version state |
| 2 | `hlooo__MOVE_LOG.md` | How `projects/gamepados/` is organised and why; what deliberately did NOT move |
| 3 | `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-21.md` | Most recent full handoff — where work stopped |
| 4 | `hlooo__apps__docs__ARCHITECTURE.md` | How GamepadOS actually works, end to end |
| 5 | `hlooo__apps__docs__GRX_PROTOCOL.md` | The encrypted input wire protocol |
| 6 | `hlooo__docs__REGRESSION_CHECKLIST.md` | What to test after any significant change |
| 7 | `App with login__HANDOFF.md` | State of the account-system rebuild |

---

## GamepadOS — architecture & protocol

| File | Covers |
|---|---|
| `hlooo__apps__docs__ARCHITECTURE.md` | Full system architecture (16.5 KB) |
| `hlooo__apps__docs__GRX_PROTOCOL.md` | GRX encrypted input protocol spec |
| `hlooo__apps__docs__GRX_INTEGRATION.md` | Integrating GRX into the clients |
| `hlooo__apps__docs__GRX_ANDROID_WIRING.md` | Android-side GRX wiring |
| `hlooo__apps__docs__LOW_LATENCY_GUIDE.md` | The latency work — what actually moved the needle |
| `hlooo__apps__docs__AOA_REQUIREMENTS.md` | Android Open Accessory (wired mode) requirements |
| `hlooo__apps__docs__SETUP_AOA.md` | AOA setup steps |
| `hlooo__apps__docs__SKILL.md` | Largest single doc (31.6 KB) — updated 2026-08-13 |
| `hlooo__apps__docs__README-Gamepad.md` | Short overview |

## PC server

| File | Covers |
|---|---|
| `hlooo__apps__pc-server-rs__README.md` | Rust server v2 (15.7 KB) |
| `hlooo__apps__pc-server__SETUP.md` | Python server setup |
| `hlooo__apps__pc-server__UPDATE_TROUBLESHOOTING.md` | Self-updater failure modes |
| `hlooo__releases__archive__pc-server-python-2026-07-21__*` | The archived Python server + why it was preserved |
| `App with login__apps__GamepadServer-linux__LINUX.md` | Linux port |
| `App with login__apps__GamepadServer-linux__PORT_NOTES.md` | Linux porting notes |

## iOS / Mac port

Both `GamepadOS-iOS` and `ios-client` sets are here. **Resolved 2026-08-13:** `GamepadOS-iOS` is a
strict superset — `ios-client` has zero unique files and every differing file is newer and larger
in `GamepadOS-iOS`. Treat `GamepadOS-iOS` as the real one; `ios-client` is superseded (kept for
now, not deleted). See `../INVENTORY.md` §5.

| File | Covers |
|---|---|
| `hlooo__apps__ios-client__spec__WIRE_PROTOCOL.md` | Wire format (16.3 KB) |
| `hlooo__apps__ios-client__spec__GRX_CLIENT.md` | GRX on iOS via CryptoKit |
| `hlooo__apps__ios-client__spec__JS_BRIDGE_USAGE.md` | WKWebView ↔ Swift bridge |
| `hlooo__apps__ios-client__spec__SENSORS_LIFECYCLE.md` | Gyro/motion lifecycle |
| `hlooo__apps__ios-client__IOS_PORT_SPEC.md` | Port specification |
| `hlooo__apps__ios-client__README_MAC_SETUP.md` | What you need a Mac for |
| `hlooo__apps__GamepadOS-iOS__CHANGES_MAC.md` | Mac-side changes (only in the GamepadOS-iOS copy) |

## Controller UI

| File | Covers |
|---|---|
| `hlooo__apps__controller-ui__guidelines__Guidelines.md` | UI guidelines |
| `hlooo__apps__controller-ui__README.md` | Short readme |
| `hlooo__apps__controller-ui__ATTRIBUTIONS.md` | Asset attributions |
| `App with login__apps__controller-ui__src__imports__pasted_text__gamepad-blueprint.md` | Original design blueprint |
| `App with login__…__performance-optimization-notes.md` | Early perf notes |
| `hlooo__apps__android-client__LARGE_SCREEN_TASK_FOR_ANTIGRAVITY.md` | Large-screen task written for the Antigravity AI |

## Website / support platform

| File | Covers |
|---|---|
| `hlooo__website__README.md` | The gamepad.space site + support portal |
| `hlooo__website__frontend__STYLEGUIDE.md` | Signal design system (11.3 KB, updated 2026-08-12 — newer than the App-with-login copy) |
| `hlooo__website__backend__INBOUND_EMAIL_SETUP.md` | Brevo inbound email → ticket threading |

## Releases & store submissions

| File | Covers |
|---|---|
| `hlooo__RELEASE.md` | The release process |
| `hlooo__releases__store__1.3.0…1.3.7__RELEASE_NOTES.md` | Per-version release notes (8 files) |
| `hlooo__releases__store__1.3.0__STORE_LISTING_TEXT.md` | Store listing copy |
| `hlooo__releases__archive__README.md` | What's in the archive and why |
| `hlooo__marketing__APKPURE_SUBMISSION.md` | APKPure submission |
| `hlooo__marketing__UPTODOWN_SUBMISSION.md` | Uptodown submission |

## Marketing & video

| File | Covers |
|---|---|
| `hlooo__marketing__GamepadOS_Instagram_Reel_Kit.md` | Instagram reel kit |
| `hlooo__marketing__GamepadOS_YouTube_Reveal_Kit.md` | YouTube reveal kit |
| `hlooo__marketing__ad-footage__A_gameplay__*` | Gameplay ad: script, storyboard, frame spec, reviews (10 files) |
| `hlooo__marketing__ad-footage__reels__controller-replacement__*` | Controller-replacement reel: brief + agent notes (4 files) |

## Session handoffs — the project's diary

| File | Date |
|---|---|
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-04.md` | Jul 4 |
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-11.md` | Jul 11 |
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-20.md` | Jul 20 |
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-20B-gyrofix.md` | Jul 20 — gyro fix |
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-20C-phase3.md` | Jul 21 — native touch input Phase 3 |
| `hlooo__docs__handoffs__SESSION_HANDOFF_2026-07-21.md` | Jul 21 — **most recent** |

## Study material & research

| File | Covers |
|---|---|
| `hlooo__docs__notes__GamepadOS_Study_Plan.md` | The study plan (93.2 KB — the largest doc here) |
| `hlooo__docs__notes__ERRATA_2026-07-12.md` | Corrections to the guide PDFs |
| `hlooo__docs__notes__ios-design-system-reference.md` | iOS design system reference |
| `hlooo__iphone liquid display research__FIDELITY-ANALYSIS.md` | Liquid-glass refraction fidelity analysis |
| `hlooo__iphone liquid display research__CLAUDE.md` | Context for that research |

> The three guide **PDFs** (`GamepadOS_Complete_Book.pdf`, `The_Complete_Guide.pdf`,
> `Interdisciplinary_Analysis.pdf`) are not markdown, so they are not copied here. They remain at
> `projects\gamepados\docs\notes\`. **They have no other backup** — see `../INVENTORY.md`.

## Other projects

| File | Covers |
|---|---|
| `App with login__HANDOFF.md` | Account-system rebuild state (13.5 KB) |
| `flexsquares__README.md` | Flexsquares — sell-the-white-space site |
| `flexsquares__DEPLOY.md` | Flexsquares deployment |
| `flexsquares__DYNAMIC_PRICING_IDEA.md` | Parked bonding-curve pricing idea |

---

## Note on duplicates

`App with login` is a git fork of `projects/gamepados`, so ~25 documents appear twice. Where the two differ,
the `projects/gamepados` copy is generally newer — the one clear exception is noted above
(`website__frontend__STYLEGUIDE.md`). Both copies are kept deliberately; do not dedupe without
comparing dates in `_manifest.csv`.
