# Cold entrance and Android Back — 2026-09-21

User reports animations only work after visiting Connect and Back always goes to Connect. Source confirmed the route AnimatePresence disabled initial animation and the root Back handler routed Dashboard to scanner, treating scanner as root.

- Initial dashboard entrance now mounts after fonts settle and the native splash's 360ms fade (380ms allowance), with initial animation enabled. No extra delay on normal page transitions. Reduced-motion mode starts at full opacity without movement.
- Every fresh dashboard mount defaults to Play. Live tab history takes Account back to Settings if that was the preceding tab; otherwise back to Play. Warm activity/task state remains in memory.
- Home Back invokes Android exitApp, whose existing native implementation backgrounds the task. It does not navigate to Connect or disconnect the engine.
- Controller Back returns to Play. Scanner overlay Back closes the camera first; Connect Back returns to Play.
- Open focus-managed overlays consume Back first. Auth subpages return to sign-in before closing. Preset editor closes in place. Custom editor closes its active panels first and uses its existing dirty-state confirmation before leaving unsaved edits.

Validation: TypeScript and Vite passed. startup-back.test.mjs passed cold entrance timing/opacity, default Play despite saved Account, tab history, auth subpage, creation dialog, gameplay return, unchanged custom editor return, QR overlay/Connect return, Home exit, and reduced motion. Manual/redeem browser regression and 13 transport cases passed. These are Chromium tests with an Android bridge stub; ADB still lists no phone.

Initial reduced-motion assertion caught a zero-duration opacity-zero initial frame; corrected both shell and dashboard initial opacity. An initial Gradle invocation used HP instead of android-client and was cancelled during daemon start; corrected working directory for actual build. No file removal, commit, push, store build, or PC change. Source backups: context/recovery/startup-back-2026-09-21/.

Direct release build passed; APK signature matched previous signer; 1.4.5/code59; embedded UI and three ABIs verified. Artifact releases/test-builds/GamepadOS-1.4.5-startup-back-TEST-direct.apk SHA256 10475E5B90C8A6ADC8D525425C2D459E888E549CC6186D7C21EB6864B4BC989A.
