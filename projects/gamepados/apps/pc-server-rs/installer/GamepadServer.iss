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
#define AppVersion      "2.0.1"
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
VersionInfoVersion=2.0.1.0
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
; Driver MSIs — referenced from the Python installer's tree (single source of
; truth); extracted to temp and removed after install.
Source: "..\..\pc-server\installer\drivers\ViGEmBusSetup_x64.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "..\..\pc-server\installer\drivers\ViGEmBusSetup_x86.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
; 1) ViGEmBus driver — silent, no reboot, and actually SKIPPED when the driver
; service already exists (the Python iss defined VigemInstalled but never
; wired it into a Check; fixed here so upgrades don't re-run msiexec).
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\ViGEmBusSetup_x64.msi"" /qn /norestart"; \
  StatusMsg: "Installing controller driver (ViGEmBus)..."; Flags: runhidden waituntilterminated; \
  Check: NeedVigem64
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\ViGEmBusSetup_x86.msi"" /qn /norestart"; \
  StatusMsg: "Installing controller driver (ViGEmBus)..."; Flags: runhidden waituntilterminated; \
  Check: NeedVigem86
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
function VigemInstalled(): Boolean;
begin
  // The ViGEmBus driver registers this service once installed.
  Result := RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\ViGEmBus');
end;

function NeedVigem64(): Boolean;
begin
  Result := Is64BitInstallMode and not VigemInstalled();
end;

function NeedVigem86(): Boolean;
begin
  Result := (not Is64BitInstallMode) and not VigemInstalled();
end;
