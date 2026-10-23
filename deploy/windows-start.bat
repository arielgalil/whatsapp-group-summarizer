@echo off
rem Runs the server and starts it again if it stops. Put a shortcut to this file in the Startup folder (Win+R, shell:startup).
rem Stop it with Ctrl+C: the server then saves its files before exiting.
cd /d "%~dp0.."
:loop
node --experimental-global-webcrypto server.js
echo.
echo The server stopped. Restarting in 10 seconds (close this window to stop)...
timeout /t 10 /nobreak >nul
goto loop
