# Memory index

- [User: Akhil](user-akhil.md) — the user is Akhil (GamepadOS dev/owner); "Aukstea" is his customer, not him; vibe coder, avoid terminals

- [Project layout](project-layout.md) — F:\hlooo has exactly two projects: apps (PC server + Android client) and website (Signal design, local git, no remote)
- [Edit directly, no worktrees](edit-directly-no-worktrees.md) — work in the user's real folders via absolute paths; junctions for previews; F:\ is Drive-synced
- [Live helpdesk repo](live-helpdesk-repo.md) — the live support portal runs from a SEPARATE repo (gamepadadmin01-tech/gamepad), far ahead of the stale monorepo support-website; edit the live repo, never publish.ps1
- [Reference app: Remote Gamepad](reference-app-remote-gamepad.md) — SmartFusionLabs app at C:\Program Files\…; Kotlin/Native+Ktor, plain LAN UDP (no relay); wireless works via program-scoped firewall rule added at install time
