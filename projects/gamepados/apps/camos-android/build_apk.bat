@echo off
REM CamOS (phone-as-webcam) - prototype build. Same toolchain as GamepadOS (see apps\android-client\build_apk.bat).
REM 1. In apps\controller-ui:  npm run build:camos
REM 2. copy controller-ui\dist-camos\camos.html  to  app\src\main\assets\dist\index.html
REM 3. run this file. Output: app\build\outputs\apk\debug\app-debug.apk
set "JAVA_HOME=D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.20.1+1"
set "ANDROID_HOME=D:\AKHIL\HP\toolchain\android-sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0"
D:\AKHIL\HP\projects\gamepados\tools\gradle-9.8.2\bin\gradle.bat assembleDebug
