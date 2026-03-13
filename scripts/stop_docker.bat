@echo off
chcp 437 >nul 2>&1
REM ===================================================================
REM  VirtAI - Stop Docker Environment (Windows)
REM ===================================================================

REM Navigate to project root (parent of scripts\)
cd /d "%~dp0.."

echo.
echo  +=============================================+
echo  :        VirtAI - Docker Stop Script          :
echo  +=============================================+
echo.

REM -- Check if any project containers are running -----------------
docker compose ps -q >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [INFO] The Docker project is already stopped.
    pause
    exit /b 0
)

REM Check if the output is empty (no running containers)
for /f %%i in ('docker compose ps -q 2^>nul') do (
    goto CONTAINERS_RUNNING
)
echo  [INFO] The Docker project is already stopped.
pause
exit /b 0

:CONTAINERS_RUNNING
echo  Stopping VirtAI containers...
echo  -------------------------------------------
echo.
docker compose down
echo.
echo  +=============================================+
echo  :      [OK] VirtAI has been stopped           :
echo  +=============================================+
echo.

pause
