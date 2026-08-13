$targetDir = "f:\hlooo\Screenshots"
if (-Not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$files = Get-ChildItem -Path "f:\hlooo\screenshot_*.png" | Sort-Object CreationTime
$i = 1
foreach ($file in $files) {
    Move-Item -Path $file.FullName -Destination "$targetDir\$i.png"
    $i++
}
