@echo off
setlocal enabledelayedexpansion

:: Move to project root (handles script being run from scripts/ or root directory)
cd /d "%~dp0.."

echo ============================================
echo    VirtAI - Docker Start Script (DEV)
echo ============================================
echo.

:: 1. Check Docker installed
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed.
    echo Install Docker Desktop: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)
echo [OK] Docker is installed.

:: 2. Check Docker running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not running.
    echo Please start Docker Desktop, then re-run this script.
    pause
    exit /b 1
)
echo [OK] Docker is running.

:: 3. Check compose files
if not exist "docker-compose.yml" (
    echo [ERROR] docker-compose.yml not found in project root.
    pause
    exit /b 1
)
if not exist "docker-compose.dev.yml" (
    echo [ERROR] docker-compose.dev.yml not found.
    pause
    exit /b 1
)
echo [OK] Compose files found.

:: 4. Build flag
set REBUILD=--build
if "%~1"=="--no-build" (
    set REBUILD=
    echo [INFO] Skipping image rebuild.
)

echo.
echo Starting VirtAI in DEVELOPMENT mode...
docker compose -f docker-compose.yml -f docker-compose.dev.yml up %REBUILD% -d

if %errorlevel% neq 0 (
    echo [ERROR] Failed to start services.
    pause
    exit /b 1
)

echo.
echo VirtAI is up!
echo Website : http://localhost:3000
echo.
echo View logs: docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
pause