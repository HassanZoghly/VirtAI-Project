@echo off
chcp 437 >nul 2>&1
REM ===================================================================
REM  VirtAI - Rebuild Docker Environment (Windows)
REM ===================================================================

REM Navigate to project root (parent of scripts\)
cd /d "%~dp0.."

echo.
echo  +=============================================+
echo  :       VirtAI - Docker Rebuild Script        :
echo  +=============================================+
echo.

echo  Stopping existing containers...
echo  -------------------------------------------
docker compose down

echo.
echo  Rebuilding images from scratch (no cache)...
echo  -------------------------------------------
docker compose build --no-cache

echo.
echo  Starting VirtAI with fresh images...
echo  -------------------------------------------
docker compose up

echo.
echo  +=============================================+
echo  :        [OK] VirtAI Rebuild Complete         :
echo  +=============================================+
echo.

pause
