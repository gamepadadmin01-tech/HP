---
name: c-drive-disk-audit
description: "C: disk-space map for this PC + the MSIX double-counting trap that makes Claude Desktop look like a 15GB duplicate"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2b8aef37-3c1b-4fc2-ad11-607539c22d4c
  modified: 2026-07-26T07:29:28.651Z
---

Audited 2026-07-26 when the user asked to reclaim C: space they believed GamepadOS had consumed.

## 🚨 MSIX REDIRECT TRAP — never delete "duplicate" Claude/Store-app data
`C:\Users\akhil\AppData\Roaming\Claude\...` and
`C:\Users\akhil\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\...`
are **the same files on disk**, seen through the MSIX (Store app) path redirect — proven with
`fsutil file queryfileid` (identical ID `0x...1e000000030ba0` for both `rootfs.vhdx` paths).
A naive `Get-ChildItem -Recurse` over the profile **counts them twice**, so the 7.51 GB
`claudevm.bundle\rootfs.vhdx` reads as 15.02 GB of "duplicates". It is not. Deleting either path
would kill the live Claude Desktop VM. `fsutil hardlink list` shows links=1 for both and is
NOT sufficient to detect this — redirection is a filter driver, not hardlinks. **Always compare
file IDs before calling two paths duplicates.**

## Where C: space actually goes (200.69 GB volume)
GamepadOS's real C: footprint is only ~6 GB and is mostly toolchain you need: npm-cache 1.66,
Android SDK (Studio's copy) 1.54, `.rustup` 1.21 + `.cargo` 0.31, `.gradle` 1.03, `.android` 0.21.
Clearing these breaks **offline** builds — bad idea before travel. The big consumers are AI tooling,
not the project: `pagefile.sys` 14 GB (leave alone), Claude VM 7.51, Google/Chrome 9.04,
`.gemini` 5.33, NVIDIA Qwen ggufs ~5.4, `.vscode` 2.15.

## Reclaimed 2026-07-26 (18.32 → 24.14 GB free, +5.82)
Chrome `OptGuideOnDeviceModel\...\weights.bin` 3.98 GB (Chrome silently re-downloads it later),
Recycle Bin 0.94 GB, user+Windows Temp ~0.9 GB.

## Needs an ELEVATED shell (failed with "Access denied" unelevated)
- `C:\ProgramData\NVIDIA Corporation\nvtopps\rise\Qwen*.gguf` — 5.38 GB, G-Assist models, re-downloadable.
- `C:\Windows\Temp` — ~1 GB of in-use leftovers.

## Deliberately NOT deleted
`C:\ProgramData\Package Cache` (1.35 GB) — caches the original MSI/EXE for EA app, Intel Graphics
and several .NET desktop runtimes. Removing it breaks repair/uninstall/update for those apps and
can make Windows Installer prompt for original media. Not worth 1.35 GB.

## Gotcha from this session
Deleting `%LOCALAPPDATA%\Temp` contents wipes `Temp\claude\...`, which holds the Claude Code
scratchpad AND the harness's own tool-output files → the running tool call returns
"output file could not be read (ENOENT)". Exclude the `claude` folder by exact name
(`Where-Object Name -ne 'claude'`); a `*\claude\*` wildcard does NOT match the top-level folder.

Related: [[f-drive-overview]]
