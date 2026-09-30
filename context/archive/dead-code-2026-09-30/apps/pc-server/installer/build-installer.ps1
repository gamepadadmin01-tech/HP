# Build the Gamepad Controllers Windows installer
# Run this script from the installer\ folder
# It downloads Inno Setup if needed, then compiles the .iss script

Set-Location $PSScriptRoot

$iscc = if (Test-Path "F:\Inno Setup 6\ISCC.exe") { "F:\Inno Setup 6\ISCC.exe" } elseif (Test-Path "C:\Program Files (x86)\Inno Setup 6\iscc.exe") { "C:\Program Files (x86)\Inno Setup 6\iscc.exe" } else { $null }
$innoInstaller = "$env:TEMP\innosetup-6-installer.exe"

# Download and install Inno Setup if not present
if (-not (Test-Path $iscc)) {
    Write-Host "Inno Setup not found — downloading..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://jrsoftware.org/download.php/is.exe" -OutFile $innoInstaller -UseBasicParsing
    Write-Host "Installing Inno Setup silently..." -ForegroundColor Cyan
    Start-Process -FilePath $innoInstaller -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait
    Remove-Item $innoInstaller -ErrorAction SilentlyContinue
}

if (-not (Test-Path $iscc)) {
    Write-Error "Inno Setup install failed. Please install manually from https://jrsoftware.org/isdl.php"
    exit 1
}

# Compile
Write-Host "Compiling installer..." -ForegroundColor Cyan
& $iscc "GamepadServer.iss"

if ($LASTEXITCODE -eq 0) {
    $out = Get-Item "Output\GamepadServer-Setup.exe"
    Write-Host ""
    Write-Host "SUCCESS: $($out.FullName)" -ForegroundColor Green
    Write-Host "Size   : $([math]::Round($out.Length/1MB, 1)) MB" -ForegroundColor Green
} else {
    Write-Error "Inno Setup compile failed (exit code $LASTEXITCODE)"
    exit 1
}
