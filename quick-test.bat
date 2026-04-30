@echo off
REM IGNIS Test Agent - Quick Local Test Script
REM This is a simplified version for quick testing

echo ==================================================
echo    IGNIS Automation Test Agent - Quick Test
echo ==================================================
echo.

REM Check if .env exists
if not exist .env (
    echo [!] .env file not found
    echo.
    echo Creating .env from example...
    copy .env.example .env
    echo.
    echo Please edit .env file with your API keys:
    echo   1. Add OPENAI_API_KEY or GEMINI_API_KEY
    echo   2. Add GITHUB_TOKEN
    echo   3. Set REPO_PATH to your project
    echo.
    echo Then run this script again.
    notepad .env
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [X] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
    echo.
)

REM Check Playwright
echo Checking Playwright browsers...
call npx playwright --version >nul 2>&1
if errorlevel 1 (
    echo Installing Playwright...
    call npx playwright install chromium --with-deps
    if errorlevel 1 (
        echo [X] Failed to install Playwright
        pause
        exit /b 1
    )
)
echo [OK] Playwright ready
echo.

REM Run validation
echo Validating setup...
call npm run validate
if errorlevel 1 (
    echo [!] Validation warnings (you can continue)
    echo.
)

echo ==================================================
echo    Ready to run!
echo ==================================================
echo.

set /p RUN="Run IGNIS now? (Y/N): "
if /i "%RUN%"=="Y" (
    echo.
    echo Starting IGNIS Agent...
    echo.
    call npm run cli
) else (
    echo.
    echo Setup complete! Run 'npm run cli' when ready.
    echo.
)

pause
