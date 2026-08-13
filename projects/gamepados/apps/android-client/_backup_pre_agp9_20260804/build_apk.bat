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
REM gradle-8.14.4 required since Kotlin 2.4.0 (build.gradle.kts) needs Gradle
REM 8.14.4+; it also satisfies AGP 8.6.1 (needs 8.7+). gradle-8.9 / gradle-8.5
REM are kept only for reference and will FAIL on Kotlin 2.4.
D:\AKHIL\HP\projects\gamepados\tools\gradle-8.14.4\bin\gradle.bat clean assembleDirectRelease
