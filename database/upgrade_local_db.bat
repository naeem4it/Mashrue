@echo off
echo ====================================================================
echo   MASHRUE - LOCAL DATABASE SAFE UPGRADE (via Node.js Engine)
echo ====================================================================
echo.
cd "%~dp0..\Code\Backend"
node "%~dp0run_upgrade_node.js"
echo.
pause
