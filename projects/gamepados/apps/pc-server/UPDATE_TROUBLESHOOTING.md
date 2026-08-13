# PC Server Update Troubleshooting

## Issues Fixed (v1.1.17+)

### Problem: "Downloading update…" then the app goes blank/disappears

**Root causes addressed:**
1. **Timeout too short** — increased from 30s to 60s (large files + slow connections)
2. **Incomplete download detection** — now verifies file size matches Content-Length
3. **Silent crashes** — errors are now logged to `GamepadServer_error.log` next to the exe
4. **Installer not launching** — better error handling when UAC is declined

### What changed in the code:

**Before:** App would silently exit with `os._exit(0)` if anything went wrong, leaving no trace.

**After:** 
- All errors logged to `GamepadServer_error.log`
- Progress updates shown on screen
- Timeout increased to 60 seconds
- Better validation of downloaded file
- Graceful error messages if installer can't run

---

## Diagnostics

If updates still don't work, check these in order:

### 1. Is the update server reachable?

The server checks: `https://supportportal.gamepad.space/api/version`

This should return JSON like:
```json
{
  "pc": {
    "version": "1.1.18",
    "url": "https://...GamepadServer-Setup-1.1.18.exe",
    "sha256": "abc123...",
    "notes": "Bug fixes..."
  }
}
```

**If the endpoint is down**, the "Check for updates" button will show "Update server unavailable".

### 2. Check the error log

After a failed update, look for:
```
D:\temp\GamepadServer_error.log
```
(or your Windows `%TEMP%\GamepadServer_error.log`)

It will contain the exact failure reason:
- `HTTP 404` — update file not found
- `download failed: timeout` — server took too long
- `checksum mismatch` — corrupted download
- `not a valid Windows installer` — wrong file type
- `incomplete download (X/Y bytes)` — connection cut off

### 3. Manual update

If auto-update is blocked:
1. Click "Check for updates" → "Update failed (...) — opening download page…"
2. Download `GamepadServer-Setup-*.exe` from the page
3. Run it with Admin privileges
4. The installer will close the server, install, and restart

---

## Is this a universal issue?

**If you see "Update server unavailable":**
- YES — affects all users, backend needs restart/fix
- Check: Can anyone ping `supportportal.gamepad.space`?
- Check: Is the `/api/version` endpoint implemented?

**If your error log says something else:**
- NO — local issue (network, firewall, disk space)
- Share the error log for diagnosis

**If you're on v1.1.16 or earlier:**
- Upgrade to v1.1.17+ (the one just built) — this fixes the blank-screen issue
- Test: "Check for updates" button should now show clear messages
