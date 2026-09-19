@echo off
title Three Kingdoms 2.0 - Dev Server
echo Starting Three Kingdoms 2.0 dev server...
echo.
cd /d "%~dp0"
call npm run dev
pause