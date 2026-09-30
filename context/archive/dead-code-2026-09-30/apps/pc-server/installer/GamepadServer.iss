; ============================================================================
;  Gamepad Server — Windows installer (Inno Setup 6)
;  Produces Output\GamepadServer-Setup.exe, which:
;    1. installs GamepadServer.exe to Program Files,
;    2. silently installs the ViGEmBus virtual-gamepad driver (skipped if present),
;    3. adds a PROGRAM-scoped Windows Firewall rule (allow the exe on ANY port /
;       ANY profile, incl. Public) so Wi-Fi pairing works with zero runtime prompts.
;  Build:  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" GamepadServer.iss
; ============================================================================

#define AppName        "Gamepad Server"
#define AppVersion      "1.1.17"
#define AppPublisher    "GamepadOS"
#define AppURL          "https://gamepad.space"
#define ExeName         "GamepadServer.exe"

[Setup]
; A FIXED AppId keeps upgrades/uninstall consistent across versions — never change it.
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
SetupIconFile=..\app_icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Admin is required for Program Files + the driver MSI + the firewall rule.
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; If the server is already running, ask the user to close it before installing
; (matches the single-instance mutex the app creates).
AppMutex=RemoteGamepadServerSingleton
; In-app one-click updater runs this /SILENT. Let Setup close the running server
; via Restart Manager, but DON'T let RM relaunch it — the [Run] entry below does the
; single relaunch (as the normal user). RM-restart + [Run] would launch it twice.
CloseApplications=force
RestartApplications=no
VersionInfoVersion=1.1.17.0
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "..\dist\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion
; Driver MSIs are extracted to a temp dir and removed after install.
Source: "drivers\ViGEmBusSetup_x64.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "drivers\ViGEmBusSetup_x86.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
; 1) ViGEmBus driver — silent, no reboot. Skipped if the driver service already exists.
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\ViGEmBusSetup_x64.msi"" /qn /norestart"; \
  StatusMsg: "Installing controller driver (ViGEmBus)..."; Flags: runhidden waituntilterminated; \
  Check: Is64BitInstallMode
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\ViGEmBusSetup_x86.msi"" /qn /norestart"; \
  StatusMsg: "Installing controller driver (ViGEmBus)..."; Flags: runhidden waituntilterminated; \
  Check: not Is64BitInstallMode
; 2) Firewall: delete any stale copies, then add program-scoped allow rules (UDP+TCP, any profile).
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (UDP)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (TCP)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""RemoteGamepad Server UDP"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Gamepad Server (UDP)"" dir=in action=allow program=""{app}\{#ExeName}"" protocol=UDP profile=any enable=yes"; \
  StatusMsg: "Adding firewall rule..."; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Gamepad Server (TCP)"" dir=in action=allow program=""{app}\{#ExeName}"" protocol=TCP profile=any enable=yes"; \
  StatusMsg: "Adding firewall rule..."; Flags: runhidden
; 3) Launch the server after install. runasoriginaluser → starts NON-elevated (no
; lingering admin). No skipifsilent → also relaunches after the in-app silent update.
Filename: "{app}\{#ExeName}"; Description: "Launch {#AppName} now"; Flags: nowait postinstall runasoriginaluser

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (UDP)"""; Flags: runhidden; RunOnceId: "DelFwUDP"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Gamepad Server (TCP)"""; Flags: runhidden; RunOnceId: "DelFwTCP"

[Code]
function VigemInstalled(): Boolean;
begin
  // The ViGEmBus driver registers this service once installed — skip the MSI if so.
  Result := RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\ViGEmBus');
end;
