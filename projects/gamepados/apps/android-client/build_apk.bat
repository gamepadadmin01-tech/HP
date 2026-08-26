@echo off
REM Build tools now live in D:\AKHIL\HP\projects\gamepados\tools\ (moved out of apps\).
REM NOTE: these were F:\ paths until 2026-08-03 — F: was formatted and the whole
REM working tree moved to D:\AKHIL\HP, so the old paths silently failed.
REM 5 flavors now exist (direct/playstore/aptoide/uptodown/amazonstore) — see
REM RELEASE.md "Android — 5 flavors, one release". This script builds the
REM "direct" APK (the one that ships from our own website), matching what it
REM always built before the flavor split. For the others:
REM   gradle.bat bundlePlaystoreRelease   (Google Play, .aab)
REM   gradle.bat assembleAptoideRelease
REM   gradle.bat assembleUptodownRelease
REM   gradle.bat assembleAmazonstoreRelease
set "JAVA_HOME=D:\AKHIL\HP\projects\gamepados\tools\jdk\jdk-17.0.19+10"
set "ANDROID_HOME=D:\AKHIL\HP\toolchain\android-sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Starting Gradle build (direct flavor)...
REM gradle-9.6.1 required since AGP 9.3.1 (build.gradle.kts) needs Gradle 9.5.0+.
REM gradle-8.14.4 / 8.9 / 8.5 are kept only for reference and CANNOT build this
REM anymore — AGP 9 rejects any Gradle 8.x.
D:\AKHIL\HP\projects\gamepados\tools\gradle-9.6.1\bin\gradle.bat clean assembleDirectRelease
