@echo off
title Minecraft Manager Parser 24/7
chcp 65001 > nul

echo [1/5] Checking the environment...
where node >nul 2>nul
if errorlevel 1 echo ERROR: Node.js not found && pause && exit /b

echo [2/5] Checking dependencies...
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)

echo [3/5] Generating database types...
call npm run generate
if errorlevel 1 pause && exit /b

echo [4/5] Project assembly...
call npm run build
if errorlevel 1 pause && exit /b

echo [5/5] Checking the Playwright browsers...
call npx playwright install chromium
if errorlevel 1 pause && exit /b

echo --------------------------------------------------
echo Launching the 24/7 parser daemon...
echo --------------------------------------------------
call npm run start:daemon

echo --------------------------------------------------
echo Daemon stopped.
pause
