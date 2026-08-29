@echo off
setlocal enabledelayedexpansion

echo ====================================================================
echo   MASHRUE ENTERPRISE BMS - PRODUCTION DATABASE SAFE UPGRADE
echo ====================================================================
echo.
echo [SAFETY GUARANTEE]
echo   This script applies schema additions and indexes safely using
echo   'IF NOT EXISTS' and 'ON CONFLICT DO NOTHING'.
echo   Existing tenants, users, tenders, invoices, and ledger entries
echo   will NOT be deleted, altered, or disturbed.
echo.

set /p DB_HOST="Enter PostgreSQL Host (default: localhost): "
if "%DB_HOST%"=="" set DB_HOST=localhost

set /p DB_PORT="Enter PostgreSQL Port (default: 5432): "
if "%DB_PORT%"=="" set DB_PORT=5432

set /p DB_USER="Enter PostgreSQL Username (default: postgres): "
if "%DB_USER%"=="" set DB_USER=postgres

set /p DB_NAME="Enter Database Name (default: mashrueDB): "
if "%DB_NAME%"=="" set DB_NAME=mashrueDB

echo.
echo Connecting to %DB_NAME% on %DB_HOST%:%DB_PORT% as %DB_USER%...
echo Executing 04_production_upgrade_safe.sql...
echo.

psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f "%~dp004_production_upgrade_safe.sql"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ====================================================================
    echo [ERROR] Upgrade script execution failed.
    echo Please verify that 'psql' is in your system PATH and DB credentials are correct.
    echo ====================================================================
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================================
echo [SUCCESS] Mashrue production database upgrade completed successfully!
echo All new modules (Gating, Inventory, Stock, DTL, Grievance, RBAC)
echo are active without disturbing any existing production data entries.
echo ====================================================================
pause
