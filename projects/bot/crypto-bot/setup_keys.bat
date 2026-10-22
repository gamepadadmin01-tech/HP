@echo off
title Breakout Bot - save your keys
echo This saves the keys the bot needs, on this PC only.
echo.
echo 1) Binance TESTNET keys (fake money). Get them at https://testnet.binance.vision
echo    - log in with GitHub, click "Generate HMAC_SHA256 Key".
echo    Press Enter on an empty line to skip a step.
echo.
set "KEY="
set "SECRET="
set /p KEY=Testnet API key: 
if "%KEY%"=="" goto telegram
set /p SECRET=Testnet secret key: 
setx BINANCE_TESTNET_API_KEY "%KEY%" >nul
setx BINANCE_TESTNET_SECRET "%SECRET%" >nul
cls
echo Testnet keys saved.
:telegram
echo.
echo 2) Optional: alerts on your phone through Telegram.
echo    Create a bot with @BotFather (gives a token), get your chat id from @userinfobot.
echo.
set "TG="
set "CHAT="
set /p TG=Telegram bot token: 
if "%TG%"=="" goto done
set /p CHAT=Telegram chat id: 
setx TELEGRAM_BOT_TOKEN "%TG%" >nul
setx TELEGRAM_CHAT_ID "%CHAT%" >nul
cls
echo Telegram alerts saved.
:done
echo.
echo Done. Close this window, then double-click start_bot.bat.
echo (Windows only gives new windows the saved keys, so start the bot after this one closes.)
pause
