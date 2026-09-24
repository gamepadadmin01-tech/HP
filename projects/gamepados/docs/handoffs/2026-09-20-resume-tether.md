# Resume, Manage, camera and tether repair — 2026-09-20

Owner requested fixes for Manage disconnecting, slow reopen, forgotten PC, USB/tether transitions reporting no reply, camera obstruction, and square rounded controller cards (two per row).

## Confirmed code defects and repairs

- App.tsx called native exitSession when opening Manage (scanner view). Removed that teardown. The earlier transport test did not represent this native callback; the new browser harness does.
- MainActivity cleared the entire WebView cache on every creation. Removed that clear. Bundled fonts replace the blocking Google Fonts import. Back now backgrounds the task rather than finishing it; singleTask avoids duplicate launcher activities. Resume reacquires network locks for a running engine.
- New connectionMemory store retains only confirmed Wi-Fi pairing, explicit transport mode, selected controller and dashboard tab. Cold start restores saved Wi-Fi once; USB choice prevents Wi-Fi restoration. Warm resume leaves a running engine alone. Pairing tokens still must match the PC; a rotated PC key requires pairing again.
- Light theme shell covered the native camera. Scanner shell is explicitly transparent; CameraX uses COMPATIBLE preview compositing. Browser transparency passed; actual camera image remains unverified.
- Android classified every connection as wired whenever a tether interface existed. Classification now follows the requested connection mode.
- Native discovery assumed broadcast addresses end in .255. Explicit discovery state now accepts directed broadcasts for other subnet sizes, locks to the responding PC/port, and reuses the tether broadcast during recovery. Old Activity JNI reference is released after stopping the worker.
- PC reply source could be a directed broadcast address. Winsock source failures now retry using a real unicast address on the receiving interface. Unspecified source is resolved explicitly too: an initial attempted zero-source fallback produced 0.0.0.0 in a real socket test and was replaced before completion.
- Cards now use square aspect ratio, rounded corners, two columns, constrained previews and adjusted title sizes.
- Existing egui 0.35 compilation failures in the redesigned server were corrected using theme-specific style accessors. Existing UI work was preserved.

## Validation and limitations

TypeScript/Vite passed. Browser bridge simulation: Manage, visibility resume, confirmed pairing/reload, USB preference/reload, light camera transparency, square cards at 320/412/768, no remote font requests and no runtime errors passed. Evidence: `docs/resume-tether-2026-09-20/`.

All 131 Rust tests passed (97 library, 12 + 18 + 4 integration); includes a Windows socket test for receiving-interface source fallback with .15/.31/.63/.127/.255 candidates. 13 transport regressions, 9 steering groups and 8 Android unit tests passed. Android C++ compiled for arm64-v8a, armeabi-v7a and x86_64.

ADB repeatedly listed no phone; Windows showed no phone/tether network device. Therefore no installation, actual camera check, physical tether/debug transition, Android process-kill recovery or payment/account test was performed. Browser results simulate the native bridge, not hardware. Android may still end a background process; the saved pairing restores a new session rather than preserving a dead socket.

The PC build environment has no SESSION_TICKET_PUBLIC_KEY. Existing server behavior leaves ticket enforcement off in such builds. Do not distribute this test server as a production subscription-enforcing build. No billing/crypto verification rules were relaxed. Installed server D:/Gamepad Server/GamepadServer.exe was left untouched.

Original source and prior embedded UI snapshots: `context/recovery/resume-tether-2026-09-20/`. No deletion, commit, push or production release.

## Final builds

Android direct release BUILD SUCCESSFUL; 1.4.4/code 58; signer matches the prior direct APK; embedded UI byte-equals current Vite output; all three native architecture libraries verified. APK: `releases/test-builds/GamepadOS-1.4.4-resume-tether-TEST-direct.apk`, SHA256 `56B0DB1CC26EDE1F80192592E4C0CA210C43F78243376810954D9231DF176E37`.

Rust release build succeeded. Test bundle: `releases/test-builds/resume-tether-pc-TEST/`, including ADB and its two DLLs. Executable SHA256 `15E695845E7BC0B83B1FBF6BB41B61FFF4C5A76892E84E960876575B82CA468A`. Read its README before use; production public key is not configured.

Real release executable UDP loopback on isolated port 7788 passed ACK/timestamp echo, stale and malformed input rejection, bad token rejection, and newest-frame burst echo. The old burst test initially failed because it expected 200 replies while main.rs deliberately coalesces queued input; corrected the test to require the final timestamp and unique ordered valid echoes. No server behavior was changed to satisfy that test. Python WebSocket integration script was not run: this Python environment lacks websockets. Rust WebSocket tests passed as part of cargo test.
