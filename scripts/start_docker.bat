@echo off
chcp 437 >nul 2>&1
REM ===================================================================
REM  VirtAI - Start Docker Environment (Windows)
REM ===================================================================

REM Navigate to project root (parent of scripts\)
cd /d "%~dp0.."

echo.
echo  +=============================================+
echo  :        VirtAI - Docker Start Script         :
echo  +=============================================+
echo.

REM -- Step 1: Check if Docker is installed --------------------
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Docker is not installed. Please install Docker first.
    echo          Download: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo  [OK] Docker is installed.

REM -- Step 2: Check if Docker daemon is running ---------------
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] Docker is already running.
    goto START_PROJECT
)

echo  [WARN] Docker is not running. Attempting to start Docker Desktop...

start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
if %ERRORLEVEL% neq 0 (
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" 2>nul
)

echo          Waiting for Docker to start...
set TIMEOUT=60
set ELAPSED=0

:WAIT_LOOP
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 goto DOCKER_READY

timeout /t 2 /nobreak >nul
set /a ELAPSED+=2
if %ELAPSED% geq %TIMEOUT% (
    echo  [ERROR] Docker did not start within %TIMEOUT% seconds.
    echo          Please start Docker Desktop manually and try again.
    pause
    exit /b 1
)
echo          Waiting... %ELAPSED%s / %TIMEOUT%s
goto WAIT_LOOP

:DOCKER_READY
echo  [OK] Docker is now running.

:START_PROJECT
REM -- Step 3: Start the project -------------------------------
echo.
echo  Starting VirtAI...
echo  -------------------------------------------
echo.

docker compose up --build

echo.
echo  +=============================================+
echo  :           VirtAI - Stopped                  :
echo  +=============================================+
echo.

pause
