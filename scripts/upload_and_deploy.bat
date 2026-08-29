@echo off
setlocal enabledelayedexpansion

echo ====================================================================
echo   Mashrue (mashrue.com) — 1-Click Windows to Server Deployment
echo   Target: mashrueadmin@95.217.152.187 (Hetzner Cloud)
echo ====================================================================
echo.

set SERVER_IP=95.217.152.187
set SERVER_USER=mashrueadmin
set REMOTE_DIR=/var/www/mashrue

echo [1/3] Uploading CodeBase to Server via SCP...
echo (You will be prompted for your SSH password: Password123!)
echo.

scp -r "%~dp0..\*" %SERVER_USER%@%SERVER_IP%:%REMOTE_DIR%/

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] SCP Upload failed. Please check your SSH connection or password.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Upload completed successfully.
echo [3/3] Executing server update script on %SERVER_IP%...
echo.

ssh -t %SERVER_USER%@%SERVER_IP% "sudo bash %REMOTE_DIR%/scripts/update_server.sh"

echo.
echo ====================================================================
echo   DEPLOYMENT FINISHED!
echo   Check your live site at: https://www.mashrue.com
echo ====================================================================
pause
