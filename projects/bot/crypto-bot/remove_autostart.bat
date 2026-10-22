@echo off
title Breakout Bot - stop starting with Windows
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\BreakoutBot.bat" del "%STARTUP%\BreakoutBot.bat"
echo The bot will no longer start with Windows. (If it is running now, close its window.)
pause
