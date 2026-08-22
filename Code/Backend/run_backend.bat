@echo off
echo ====================================================================
echo Starting Mashrue Backend API Server (Port 3033)
echo ====================================================================
echo.
cd /d "%~dp0"
echo Installing dependencies if needed...
call npm install
echo.
echo Starting Server...
node server.js
pause
