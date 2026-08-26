Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap $s.Width, $s.Height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$filename = "f:\hlooo\screenshot_$timestamp.png"
$b.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$b.Dispose()

Write-Host "Screenshot saved to $filename"
