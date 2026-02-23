@echo off
setlocal

REM Navigate to the frontend directory
cd /d "%~dp0..\frontend"

echo ============================================
echo   Starting VirtAI Frontend Development
echo ============================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [*] node_modules not found. Installing dependencies...
    echo.
    call npm install
    
    if errorlevel 1 (
        echo.
        echo [X] Failed to install dependencies. Please check your npm installation.
        pause
        exit /b 1
    )
    
    echo.
    echo [+] Dependencies installed successfully!
    echo.
) else (
    echo [+] Dependencies already installed. Skipping npm install...
    echo.
)

REM Start the development server
echo [*] Starting Vite development server...
echo.
call npm run dev

pause
