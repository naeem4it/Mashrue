@echo off
echo ====================================================================
echo Mashrue (mashrue.com) - Database Setup Script for mashrueDB
echo ====================================================================
echo.

set /p DB_USER=Enter PostgreSQL Username (default: postgres): 
if "%DB_USER%"=="" set DB_USER=postgres

set /p DB_NAME=Enter Database Name (default: mashrueDB): 
if "%DB_NAME%"=="" set DB_NAME=mashrueDB

echo.
echo Executing 01_schema_init.sql on %DB_NAME%...
psql -U %DB_USER% -d %DB_NAME% -f "%~dp001_schema_init.sql"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to execute 01_schema_init.sql. Please check if psql is in your PATH or DB credentials are correct.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Choose Seed Data Mode:
echo [1] Clean Production (Only Super Admin: naeem4it) [Recommended]
echo [2] Full Demo Sample Data (Tenants, Tenders, Invoices)
set /p SEED_CHOICE="Enter selection (1 or 2, default: 1): "
if "%SEED_CHOICE%"=="" set SEED_CHOICE=1

if "%SEED_CHOICE%"=="1" (
    echo.
    echo Executing 02_seed_superadmin_only.sql on %DB_NAME%...
    psql -U %DB_USER% -d %DB_NAME% -f "%~dp002_seed_superadmin_only.sql"
) else (
    echo.
    echo Executing 02_seed_data.sql on %DB_NAME%...
    psql -U %DB_USER% -d %DB_NAME% -f "%~dp002_seed_data.sql"
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: Seed step encountered a notice or error.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================================
echo SUCCESS: Database mashrueDB setup and seed data migration complete!
echo ====================================================================
pause
