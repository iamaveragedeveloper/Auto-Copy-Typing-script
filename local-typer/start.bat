@echo off
cd /d "%~dp0"
echo Starting Copy Paste Typer... open http://localhost:8765
start "" http://localhost:8765
node server.js
pause
