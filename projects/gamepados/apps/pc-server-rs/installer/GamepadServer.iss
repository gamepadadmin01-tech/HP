; ============================================================================
;  Gamepad Server v2 (Rust) — Windows installer (Inno Setup 6)
;
;  Successor to apps/pc-server/installer/GamepadServer.iss (the Python 1.1.17
;  installer, kept intact as the rollback). SAME AppId + AppMutex + exe name +
;  firewall rule names, so on a 1.1.17 machine this is an IN-PLACE UPGRADE:
;  the old server is closed via AppMutex, its files are replaced under the same
;  Program Files path, and the existing program-scoped firewall rules keep
;  matching because the path and name don't change.
;
;  What's NEW vs the Python installer:
;    * The app is the single Rust exe (7 MB) — no PyInstaller onefile unpack.
;    * adb.exe + its two DLLs are installed next to it: the Rust server does
;      not self-extract adb the way the Python exe did, and find_adb() looks
;      next to the binary first. Without these, USB-debugging (wired) mode is
;      dead on a fresh machine.
;
;  Build: apps\pc-server-rs\installer\build-installer.ps1
;         (or: cargo build --release, copy exe to staging\GamepadServer.exe,
;          then "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" GamepadServer.iss)
; ============================================================================

#define AppName        "Gamepad Server"
; ⚠️ Must equal http.rs APP_VERSION and the backend's pc.version at release —
; a skew makes the in-app updater loop forever (install → "update available").
#define AppVersion      "2.1.2"
#define AppPublisher    "GamepadOS"
#define AppURL          "https://gamepad.space"
#define ExeName         "GamepadServer.exe"

[Setup]
; FIXED AppId — identical to the Python installer's, and that is the whole
; upgrade story. Never change it.
AppId={{8F2A1C7B-9D3E-4A6F-B1C2-7E5D9A0F3B41}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/support
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#ExeName}
OutputDir=Output
OutputBaseFilename=GamepadServer-Setup
; The transparent mobile-app icon (assets/app_icon.ico) — same image as the
; exe icon (build.rs) and the window icon (ui.rs). Three places, one image.
SetupIconFile=..\assets\app_icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Admin: Program Files + driver MSI + firewall rules.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The server creates this mutex (singleton.rs) — Setup uses it to close a
; running instance (Python OR Rust; both use the same name) before replacing
; files. See REGRESSION_CHECKLIST.md A14.
AppMutex=RemoteGamepadServerSingleton
; In-app one-click updater runs this /SILENT. Setup closes the running server;
; RM must NOT relaunch it (the [Run] entry below does the single relaunch as
; the normal user) — RM-restart + [Run] would launch it twice.
CloseApplications=force
RestartApplications=no
VersionInfoVersion=2.1.2.0
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
; The Rust server, staged under its shipping name by build-installer.ps1.
Source: "staging\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion
; adb for USB-debugging (wired) mode — find_adb() probes {app}\adb.exe first.
Source: "..\..\..\tools\platform-tools\adb.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\tools\platform-tools\AdbWinApi.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\tools\platform-tools\AdbWinUsbApi.dll"; DestDir: "{app}"; Flags: ignoreversion
; ViGEmBus 1.22.0 — the FINAL release (the project was archived 2023-11-02, so
; there will never be a newer one). One signed package covering x64, x86 AND
; arm64; it replaces the two 1.17-era MSIs the Python installer shipped.
;
; WHY THIS CHANGED: a user reported "The controller driver (ViGEmBus) is not
; installed" on a current Windows 11 machine after a normal install. 1.17 predates
; Windows 11 and can fail to install or fail to load on it, and because the old
; [Run] entry never checked msiexec's result, setup reported complete success and
; the failure only surfaced later as a server that would not start.
; Installed to {app}, NOT {tmp}. Keeping the driver package on disk lets the
; server repair its own driver later without downloading anything — the
; difference between a dead end and a one-click fix when Windows drops or
; blocks the driver some time after install.
Source: "drivers\ViGEmBus_1.22.0_x64_x86_arm64.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
; 1) ViGEmBus driver — NOT here any more. It now runs from CurStepChanged in
; [Code], because a [Run] entry cannot see whether the driver installer actually
; succeeded, and silently shipping a PC with no driver is the exact bug this
; version fixes. See InstallVigem below.
; 2) Firewall: delete stale copies, then add program-scoped allow rules
; (UDP+TCP, any profile). Same rule names as 1.1.17 → upgrades stay clean.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (UDP)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (TCP)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""RemoteGamepad Server UDP"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Gamepad Server (UDP)"" dir=in action=allow program=""{app}\{#ExeName}"" protocol=UDP profile=any enable=yes"; \
  StatusMsg: "Adding firewall rule..."; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Gamepad Server (TCP)"" dir=in action=allow program=""{app}\{#ExeName}"" protocol=TCP profile=any enable=yes"; \
  StatusMsg: "Adding firewall rule..."; Flags: runhidden
; 3) Launch after install. runasoriginaluser → starts NON-elevated. No
; skipifsilent → also relaunches after the in-app silent update.
Filename: "{app}\{#ExeName}"; Description: "Launch {#AppName} now"; Flags: nowait postinstall runasoriginaluser

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (UDP)"""; Flags: runhidden; RunOnceId: "DelFwUDP"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (TCP)"""; Flags: runhidden; RunOnceId: "DelFwTCP"

[Code]
// ── ViGEmBus: install it, then PROVE it is there ────────────────────────────
// Without the driver there is no virtual gamepad and the server refuses to
// start, so this is not an optional extra — it is the product working or not.
//
// The old version ran msiexec from [Run] and never looked at the result. Any
// failure — a driver blocked by Windows, a pending reboot, an antivirus holding
// the temp file — produced a setup that reported complete success and a server
// that could never start. The user then had no way to tell what went wrong, and
// the app's own advice ("reinstall to restore the driver") sent them round the
// same loop. Fixed by installing from code, checking the exit code, and then
// verifying the service actually exists rather than trusting the exit code.

// ViGEmBus 1.22.0 as a comparable number. GetVersionNumbers packs major/minor
// into the high word: (major shl 16) or minor. 1.22 -> 65558, 1.17 -> 65553.
#define MinDriverMS 65558

// Is there an actual ViGEmBus DEVICE, not just an installed driver package?
//
// This is the check that was missing, and its absence is what produced the
// reported BusNotFound. A machine was found with the driver package installed
// (oem20.inf, Nefarius), the service registered AND "Running" — and no device
// node whatsoever. ViGEmBus is a root-enumerated software device; the client
// opens its device INTERFACE, so with no device there is nothing to open, no
// matter how healthy the package looks. Every file-and-registry check in the
// world says "installed" for that machine and every one of them is useless.
//
// pnputil is present on every supported Windows. findstr sets exit code 0 only
// on a match, so the result is the exit code and nothing has to be parsed.
function VigemDeviceNodePresent(): Boolean;
var
  rc: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'),
                 '/c pnputil /enum-devices | findstr /i "ViGEm" >nul 2>&1',
                 '', SW_HIDE, ewWaitUntilTerminated, rc) and (rc = 0);
end;

function VigemPresent(): Boolean;
var
  sysDir: String;
  ms, ls: Cardinal;
begin
  Result := False;

  // Three checks, because each one alone lies:
  //   - the service key survives an uninstall on some machines, so a key by
  //     itself is not proof the driver exists;
  //   - the .sys file can exist while the service is not registered;
  //   - and BOTH can be true while the driver is far too OLD to talk to, which
  //     is the failure this check was added for. A machine running ViGEmBus
  //     1.17 passed the first two, so setup skipped installing 1.22.0, left the
  //     old driver in place, and the server then failed with BusNotFound — the
  //     newer client library cannot reach a 1.17 bus. "Something is installed"
  //     was never the question; "can our server actually use it" is.
  sysDir := ExpandConstant('{sys}');
  if not RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\ViGEmBus') then exit;
  if not FileExists(sysDir + '\drivers\ViGEmBus.sys') then exit;

  // Unreadable version info means we cannot prove it is good enough, so treat it
  // as not present and reinstall. Reinstalling a healthy driver is harmless;
  // leaving an unusable one in place is exactly the bug being fixed.
  if not GetVersionNumbers(sysDir + '\drivers\ViGEmBus.sys', ms, ls) then exit;
  if ms < {#MinDriverMS} then exit;

  // Finally: a device must actually exist. Files and registry keys describe what
  // was installed once; only a device node means the server can open it today.
  Result := VigemDeviceNodePresent();
end;

// Runs the bundled 1.22.0 package silently. Returns True only when the driver is
// verifiably present afterwards.
function InstallVigem(): Boolean;
var
  rc: Integer;
begin
  if VigemPresent() then begin
    Result := True;   // already there — nothing to do, and re-running is pointless
    exit;
  end;

  // /qn = silent, /norestart = never reboot the machine out from under the user.
  if not Exec(ExpandConstant('{app}\ViGEmBus_1.22.0_x64_x86_arm64.exe'),
              '/qn /norestart', '', SW_HIDE, ewWaitUntilTerminated, rc) then begin
    Log('ViGEmBus: could not launch the driver installer at all.');
    Result := False;
    exit;
  end;
  Log('ViGEmBus: installer exit code ' + IntToStr(rc));

  // ONE GO, NO RESTART — as long as a device node actually appeared.
  //
  // ViGEmBus is a root-enumerated software device: on a clean machine Windows
  // creates the device and loads the driver during install, and nothing needs a
  // reboot. A restart is only genuinely required when Windows cannot replace a
  // driver that is currently LOADED AND BOUND to a live device — so the honest
  // test is not the exit code but whether a usable device exists now.
  //
  // Deliberately checked even for 3010 ("reboot required"): that code is
  // advisory, the installer returns it whenever anything was in flux, and on
  // most machines the device is present and working the moment it exits.
  // Believing 3010 blindly would send users to reboot for nothing, which is
  // exactly the friction we are removing.
  if VigemDeviceNodePresent() then begin
    Log('ViGEmBus: device node present after install — no restart needed.');
    Result := True;
    exit;
  end;

  // No device node. A reboot is now the honest answer rather than a hedge.
  if rc = 3010 then begin
    MsgBox('The controller driver was installed, but Windows needs to restart' + #13#10 +
           'before it can finish setting it up.' + #13#10 + #13#10 +
           'Please restart this PC, then start Gamepad Server.',
           mbInformation, MB_OK);
    Result := True;
    exit;
  end;

  Log('ViGEmBus: installer returned ' + IntToStr(rc) + ' but no device node appeared.');
  Result := False;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    if not InstallVigem() then begin
      // Tell the user NOW, while they are still in setup and can act, instead of
      // letting them discover it later as a server that will not launch.
      MsgBox('Setup could not install the controller driver (ViGEmBus).' + #13#10 + #13#10 +
             'Gamepad Server needs it to create a virtual gamepad, and will not' + #13#10 +
             'start without it. Everything else has been installed.' + #13#10 + #13#10 +
             'To fix it: install ViGEmBus 1.22.0 yourself from' + #13#10 +
             'https://github.com/nefarius/ViGEmBus/releases' + #13#10 +
             'then start Gamepad Server again.' + #13#10 + #13#10 +
             'If Windows blocked the driver, restarting the PC first often helps.',
             mbError, MB_OK);
    end;
  end;
end;
