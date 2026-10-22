@echo off
rem Runs live_bot.py and restarts it if it ever stops. Extra arguments are passed through,
rem e.g.  start_bot.bat --account 500 --max-position 150
cd /d "%~dp0"
title Breakout Bot
:loop
python live_bot.py %*
echo.
echo Bot stopped. Restarting in 30 seconds. Close this window to stop it for good.
timeout /t 30 /nobreak >nul
goto loop
