<#
Upload a GamepadOS APK to the Indus Appstore via the Update API.
Docs: Developer Platform > Tools & Resources > Indus Appstore Update API

Usage (from anywhere):
  powershell -File F:\hlooo\tools\indus-upload.ps1                  # upload 1.3.21 indusstore APK
  powershell -File F:\hlooo\tools\indus-upload.ps1 -Version 1.3.22  # upload a different release
  powershell -File F:\hlooo\tools\indus-upload.ps1 -Check           # list uploaded APKs + review state (no upload)
  powershell -File F:\hlooo\tools\indus-upload.ps1 -Stats           # installs / ratings (no upload)

API key: paste the full "O-Bearer ..." token (from the Enable API card) into
  F:\hlooo\secrets\indus-api-key.txt   (single line, with or without the O-Bearer prefix)
or set the INDUS_API_KEY environment variable. The secrets folder is outside
any git repo — never commit the key anywhere.

Notes:
- Initial submissions must go through the dashboard; this API only upgrades an
  app that already exists on Indus (404 = package not found there).
- 409 means a build is already in review; cancel it via the dashboard or the
  review/cancel endpoint before re-uploading.
#>
param(
    [string]$Version = "1.3.21",
    [string]$Package = "com.gamepad.client",
    [string]$KeyFile = "F:\hlooo\secrets\indus-api-key.txt",
    [switch]$Check,
    [switch]$Stats
)

$BaseUrl = "https://developer-api.indusappstore.com"

# ---- resolve API key ----
$key = $env:INDUS_API_KEY
if (-not $key -and (Test-Path $KeyFile)) { $key = (Get-Content $KeyFile -Raw).Trim() }
if (-not $key) {
    Write-Host "No API key found." -ForegroundColor Red
    Write-Host "Paste the O-Bearer token into $KeyFile (single line) or set INDUS_API_KEY."
    exit 1
}
if ($key -notmatch '^O-Bearer\s') { $key = "O-Bearer $key" }
$headers = @{ Authorization = $key }

if ($Check) {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/devtools/app/versions/$Package" -Headers $headers -Method Get
    $resp.data | Select-Object version_label, version_code, reviewState, filename, filesize |
        Format-Table -AutoSize
    exit 0
}

if ($Stats) {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/devtools/app/stats/$Package" -Headers $headers -Method Get
    $resp.data | Format-List
    exit 0
}

# ---- upload ----
$apk = "F:\hlooo\releases\store\$Version\GamepadOS-$Version-indusstore.apk"
if (-not (Test-Path $apk)) {
    Write-Host "APK not found: $apk" -ForegroundColor Red
    exit 1
}
$sizeMb = [math]::Round((Get-Item $apk).Length / 1MB, 2)
Write-Host "Uploading $apk ($sizeMb MB) -> $Package ..."

# curl.exe handles the multipart form; PS 5.1's Invoke-RestMethod has no -Form
$out = & curl.exe -s -w "`nHTTP %{http_code}" -X POST `
    -H "Authorization: $key" `
    -F "file=@$apk" `
    "$BaseUrl/devtools/apk/upgrade/$Package"
Write-Host $out

if ($out -match "HTTP 2\d\d") {
    Write-Host "Upload accepted - build goes into Indus review. Run with -Check to watch reviewState." -ForegroundColor Green
} else {
    Write-Host "Upload failed - see response above (403=bad key, 404=package not on Indus, 409=already in review, 433=bad file format)." -ForegroundColor Yellow
    exit 1
}
