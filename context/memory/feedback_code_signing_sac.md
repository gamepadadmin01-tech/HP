---
name: code-signing-smart-app-control
description: "Windows 11 Smart App Control BLOCKS the unsigned GamepadServer — a distribution blocker no code change can fix"
metadata:
  type: project
---

**2026-09-03. Measured, not theorised.** On Akhil's own laptop:

- `GamepadServer.exe` — **NotSigned**
- `GamepadServer-Setup.exe` — **NotSigned**
- `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 1`
  (Smart App Control **on and enforcing**)
- Result: *"We blocked ...GamepadServer.exe because we could not verify its publisher."*

SAC does **not warn** about an unverifiable publisher — it refuses to run the file.
The bundled ViGEmBus installer ran fine on that same machine because Nefarius signs theirs.

## This is not a code problem and no code change fixes it

Microsoft: **"There is currently no way to bypass Smart App Control protection for
individual apps."** Specifically ruled out:

- **A ZIP does not help.** SAC judges the executable's signature and reputation, not the
  container it arrived in. Unzipping yields the same unsigned exe and the same block.
- Renaming, self-extracting archives, installing to a different folder: all irrelevant.
- Even a *signed* app is blocked while it has no reputation, unless the cert is EV.

## The only real fixes, cheapest first

1. **Azure Trusted Signing** ~$10/month — Microsoft's own service, built for this.
2. **EV certificate** ~$300–600/yr — instant reputation, hardware token.
3. **OV certificate** ~$100–250/yr — signs it, but reputation accrues slowly.
4. **Microsoft Store** — Store apps bypass SAC entirely.

## Who is affected

SAC is ON by default on **clean Windows 11 installs** (off on upgrades, and off once a
user disables it). So: new laptops, fresh reinstalls — a growing share over time, not a
rare edge case. Akhil's own machine and his friend's both hit it.

## Already done

`installer/build-installer.ps1` signs both binaries when `GPOS_SIGN_PFX` +
`GPOS_SIGN_PASS` (or `GPOS_SIGN_THUMBPRINT`) are set, and warns loudly when they are
not. Installer is signed BEFORE its SHA-256 is taken — signing rewrites the file, so
hashing first would publish a hash nobody can reproduce. `/tr` timestamping included, or
signatures die when the cert expires. **Buying a certificate is the remaining step and
it is a purchase decision, not an engineering one.**

⚠️ Turning SAC off is a **one-way door** — it can only be re-enabled by resetting
Windows. Fine as a developer testing choice; never advice to give a user.

Related: [[project_pending_tasks]], [[project_downloads_feedback]].
