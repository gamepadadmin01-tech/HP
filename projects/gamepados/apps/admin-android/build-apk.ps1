$ErrorActionPreference='Stop'
$env:JAVA_HOME='D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.20.1+1'
$env:ANDROID_USER_HOME=Join-Path $PSScriptRoot '.android-build'
& 'D:\AKHIL\HP\projects\gamepados\tools\gradle-9.8.2\bin\gradle.bat' --no-daemon -p $PSScriptRoot assembleRelease lintRelease
if($LASTEXITCODE -ne 0){throw 'Android build failed.'}
Write-Output (Join-Path $PSScriptRoot 'app\build\outputs\apk\release\app-release.apk')
