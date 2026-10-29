@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Install it from https://nodejs.org
  pause
  exit /b 1
)
echo Starting Copy Paste Typer... open http://localhost:8765
start "" http://localhost:8765
node server.js
pause
