# Wi-Fi / USB handoff repair — 2026-09-20

Owner reported Wi-Fi -> tether/debug switching stuck at No reply, suspected the subscription rollout. The original coordinator was executed against a simulated Android bridge with a live Wi-Fi connection: both tether and usbdebug preferences produced only close-debug, never stop/connect. This reproduces a transport policy bug without an account or quota.

## Causes and changes

- Wi-Fi protection overrode explicit USB choices forever. USB tab/mode choices now notify a single coordinator immediately. Automatic cable discovery still preserves a working Wi-Fi link.
- Native connectToPC is deliberately a no-op while its transition guard is held. The coordinator now stops the old engine and waits for telemetry to acknowledge the stop before starting a replacement.
- The tether callback owned independent six-second teardown timers. Those timers are gone; notifications and polls use one coordinator with a 12-second recovery window and 4–30-second retry backoff.
- A queued native start can precede its telemetry update. Pending starts are tracked, so a rapid switch to debugging still cancels the native start first.
- Old WebSocket close callbacks could clear a newer socket. Callbacks now check their socket identity.
- Manual connection and QR scanning establish wireless intent and release the old transport. Scanning keeps that intent alive until closed: Android's scanner ignores decoded QR data while its engine is running. Duplicate scan callbacks are ignored during verification.

Subscription accounting, guest quotas, ticket signatures, pairing tokens, native input and PC-server authorization were not weakened or changed. This is not a claim of a complete billing/security audit. Existing native-only capability-ticket forwarding for the debugging path and native rediscovery using limited broadcast remain separate areas for follow-up; neither is needed to reproduce the verified Wi-Fi protection failure.

## Evidence

- transport-switch.test.mjs: 13 cases passed (explicit switching, automatic preservation, delayed native start/stop, backoff, reply-gap recovery, interface changes, QR override, slow manual Wi-Fi, stale socket callback).
- Actual React UI in isolated Chrome with a simulated Android bridge: Wi-Fi -> USB Auto -> Debugging -> Tethering -> QR Wi-Fi passed; stored USB preference retained and no runtime errors. External traffic blocked.
- TypeScript and Vite production build passed. Wheel unwrap: nine groups passed.
- Android direct-debug unit tests: eight passed (five GuestQuota, three ScreenAwakePolicy). Direct release assembly passed; the final packaging is verified separately below.
- No phone attached to adb. Real RNDIS/ADB, firewall, USB cable, packet return path and on-device subscription behavior remain unverified.
- Recovery: HP/context/recovery/transport-switch-2026-09-20/ preserves pre-edit UI sources and Android UI asset. Earlier compact two-column UI is retained.

Run the new direct test APK with GamepadServer open, establish Wi-Fi, then choose USB/Tethering, Debugging, and finally scan Wi-Fi again. Check connection status and actual controls after each switch. Also try a brief server restart, cable replug, and switching before the previous attempt finishes. Do not uninstall or clear app data to test this.

## Verified test package

- releases/test-builds/GamepadOS-1.4.4-transport-switch-TEST-direct.apk
- 1.4.4 / 58, com.gamepad.client, 2,865,369 bytes.
- SHA-256: A177D65A2B284592E32398CFCD1BEACFDCE829136420B24B0EF0CC5D71A87AD6.
- APK signature verifies and signer matches the Astra v2 direct test APK.
- Embedded assets/dist/index.html matches the final UI bundle: F35E72CB9F44E592184C054F0D07240F0C02EA7DDB00737D2B6CEB12B345F658.
- Native engine present for arm64-v8a, armeabi-v7a, x86_64. Final direct assembly passed.
- No install, production release, commit or push.
