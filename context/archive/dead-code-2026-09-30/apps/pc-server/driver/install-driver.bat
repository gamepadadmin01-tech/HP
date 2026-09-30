@echo off
REM ===========================================================================
REM  GamepadOS - AOA direct-USB driver setup (one-time, OPTIONAL)
REM ===========================================================================
REM  AOA gives the lowest wired latency (~1-2 ms) by talking raw USB to the
REM  phone - no IP stack, no adb. For it to work, Windows must bind the WinUSB
REM  driver to the GamepadOS USB accessory device (VID 18D1, PID 2D00 / 2D01)
REM  so GamepadServer can open it.
REM
REM  You ONLY need this for AOA. Wi-Fi and USB-tethering work without it.
REM ===========================================================================
echo.
echo   GamepadOS - AOA WinUSB driver setup
echo   ===================================
echo.
echo   This binds WinUSB to the accessory device 18D1:2D00 / 18D1:2D01.
echo.
if exist "%~dp0zadig.exe" (
  echo   Launching Zadig. In Zadig:
  echo     1^) Options  -^>  List All Devices
  echo     2^) Pick     "GamepadController"  ^(or 18D1:2D00 / 2D01^)
  echo     3^) Driver   -^>  WinUSB  -^>  Install / Replace Driver
  echo.
  start "" "%~dp0zadig.exe"
) else (
  echo   Zadig is not bundled in this folder.
  echo   Download it from  https://zadig.akeo.ie/  then:
  echo     1^) Options  -^>  List All Devices
  echo     2^) Pick the GamepadController accessory ^(18D1:2D00 / 2D01^)
  echo     3^) Install the WinUSB driver.
)
echo.
echo   After binding WinUSB, restart GamepadServer.exe and reconnect the phone.
echo   To undo: Device Manager -^> the device -^> Uninstall ^(tick "delete driver"^).
echo.
pause
