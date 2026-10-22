@echo off
title Breakout Bot - start with Windows
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
echo @echo off
echo start "Breakout Bot" /min "%~dp0start_bot.bat"
) > "%STARTUP%\BreakoutBot.bat"
if exist "%STARTUP%\BreakoutBot.bat" (
  echo The bot will now start by itself, minimised, every time you log in to Windows.
  echo To stop that, double-click remove_autostart.bat.
) else (
  echo Could not set this up.
)
pause
