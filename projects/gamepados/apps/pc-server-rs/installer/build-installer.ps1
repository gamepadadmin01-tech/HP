# Build the Gamepad Server v2 (Rust) installer.
#   1. cargo build --release
#   2. stage the exe under its shipping name (GamepadServer.exe)
#   3. compile the Inno script
#   4. print the SHA-256 the backend Releases panel needs
# Run from anywhere: paths are anchored to this script's location.
#
# NOT "Stop": cargo and ISCC write PROGRESS to stderr, and under
# ErrorActionPreference=Stop Windows PowerShell 5.1 turns each such line into a
# terminating NativeCommandError even when the tool exits 0. Failures are
# detected the reliable way — $LASTEXITCODE after every native call.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here   # apps\pc-server-rs

# ── Version agreement gate ──────────────────────────────────────────────────
# The version is written in three places that MUST match; if they drift, the
# in-app updater loops forever (install -> relaunch -> "update available"
# again), which is the trap http.rs documents. This used to be a printed
# reminder at the end — i.e. advice, after the installer already existed. It is
# now a hard precondition, because a reminder cannot fail a build.
Write-Host "== version check =="
$httpRs  = Get-Content "$root\src\http.rs" -Raw
$buildRs = Get-Content "$root\build.rs" -Raw
$iss     = Get-Content "$here\GamepadServer.iss" -Raw

$mHttp  = [regex]::Match($httpRs,  'macro_rules!\s+app_version\s*\{\s*\(\)\s*=>\s*\{\s*"([0-9]+\.[0-9]+\.[0-9]+)"')
$mIss   = [regex]::Match($iss,     '#define\s+AppVersion\s+"([0-9]+\.[0-9]+\.[0-9]+)"')
$mIssVi = [regex]::Match($iss,     'VersionInfoVersion=([0-9]+\.[0-9]+\.[0-9]+)\.0')
$mBuild = [regex]::Match($buildRs, 'res\.set\("FileVersion",\s*"([0-9]+\.[0-9]+\.[0-9]+)\.0"\)')

foreach ($pair in @(@("http.rs APP_VERSION",$mHttp), @("iss AppVersion",$mIss),
                    @("iss VersionInfoVersion",$mIssVi), @("build.rs FileVersion",$mBuild))) {
  if (-not $pair[1].Success) { Write-Error "could not read version from $($pair[0])"; exit 1 }
}

$versions = @{
  "http.rs APP_VERSION"    = $mHttp.Groups[1].Value
  "iss AppVersion"         = $mIss.Groups[1].Value
  "iss VersionInfoVersion" = $mIssVi.Groups[1].Value
  "build.rs FileVersion"   = $mBuild.Groups[1].Value
}
$versions.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-24} {1}" -f $_.Key, $_.Value) }
# @() is load-bearing: when every version agrees the pipeline yields ONE string,
# and PowerShell then treats $distinct[0] as the first CHARACTER of it ("2"),
# not the first element. That printed "version = 2" into the Register & Activate
# instructions — a wrong version there breaks the updater contract this gate
# exists to protect.
$distinct = @($versions.Values | Sort-Object -Unique)
if ($distinct.Count -ne 1) {
  Write-Error "VERSION MISMATCH across $($distinct.Count) values: $($distinct -join ', ') — fix before shipping"
  exit 1
}
$AppVersion = $distinct[0]
Write-Host "  -> all agree on $AppVersion"

Write-Host "== cargo build --release =="
Push-Location $root
cargo build --release
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error "cargo build failed"; exit 1 }
Pop-Location

Write-Host "== staging =="
New-Item -ItemType Directory -Force "$here\staging" | Out-Null
Copy-Item "$root\target\release\pc-server-rs.exe" "$here\staging\GamepadServer.exe" -Force

Write-Host "== ISCC =="
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "$here\GamepadServer.iss"
if ($LASTEXITCODE -ne 0) { Write-Error "ISCC failed"; exit 1 }

$out = "$here\Output\GamepadServer-Setup.exe"
$sha = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ""
Write-Host "Installer : $out ($size MB)"
Write-Host "SHA-256   : $sha"
Write-Host ""
Write-Host "Version   : $AppVersion  (http.rs / iss / build.rs verified identical above)"
Write-Host ""
Write-Host "Remaining release step — the ONE thing this script cannot check, because"
Write-Host "it lives on the server, not in this tree:"
Write-Host "  backend Releases panel -> PC column -> Register & Activate"
Write-Host "     version = $AppVersion"
Write-Host "     sha256  = $sha"
Write-Host "     url     -> the copy of this exe you upload"
Write-Host ""
Write-Host "Until that is activated, /api/version still advertises the OLD version and"
Write-Host "no running server will be offered the update."
