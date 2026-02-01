@echo off
title Minecraft Manager Parser
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

echo [4/5] Project assembly...
call npm run build

echo [5/5] Checking the Playwright browsers...
call npx playwright install chromium

echo --------------------------------------------------
echo Launching the parser...
echo --------------------------------------------------
call npm run start

echo --------------------------------------------------
echo Script execution finished.
pause
