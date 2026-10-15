@echo off
rem ===========================================================================
rem  pull-ai-context.bat - rebuild the project "map" (AI-CONTEXT.md) on the
rem  delivery server and download it here, so an AI like Gemini can understand
rem  the whole site without reading the whole site.
rem
rem  Copy this file to your Windows PC (any folder), double-click to run.
rem  Run it again after every feature you add - the map is rebuilt from scratch.
rem
rem  Usage:
rem    Double-click with no arguments .......... map only (AI-CONTEXT.md)
rem
rem    From a Command Prompt, for the feature you are working on right now:
rem        pull-ai-context.bat app/orders/page.tsx lib/commission.ts
rem    This also downloads AI-FOCUS.md: the full source of exactly those files.
rem
rem  Requires the built-in Windows OpenSSH client (Windows 10/11 have it).
rem  First-time setup (one time only, avoids typing your password):
rem    1. Open Command Prompt and run:  ssh-keygen -t ed25519
rem       (press Enter through all prompts)
rem    2. Then run:
rem       type "%USERPROFILE%\.ssh\id_ed25519.pub" | ssh root@94.23.8.106 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
rem    If you skip this, the script simply prompts for the server password.
rem ===========================================================================

setlocal EnableExtensions

rem ── Configuration ───────────────────────────────────────────────────────────
set "SERVER=root@94.23.8.106"
set "SSH_PORT=22"
set "APP_DIR=/var/www/delivery_system/web-pwa"

rem Output goes in an "ai-context" folder next to this script
set "OUT_DIR=%~dp0ai-context"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

rem ── Optional focus files (everything after the script name) ─────────────────
set "FOCUS="
if not "%~1"=="" set "FOCUS= --focus %*"

echo Rebuilding the map on %SERVER% ...
echo.

rem The generator only READS project files and writes them into ai-context/ on
rem the server. It cannot change the site.
ssh -p %SSH_PORT% -o ServerAliveInterval=15 %SERVER% "cd %APP_DIR% && node scripts/build-ai-context.js%FOCUS%"

if errorlevel 1 (
    echo.
    echo ERROR: could not generate the map on the server - nothing downloaded.
    exit /b 1
)

echo.
echo Downloading the map ...
scp -P %SSH_PORT% %SERVER%:%APP_DIR%/ai-context/AI-CONTEXT.md "%OUT_DIR%\AI-CONTEXT.md"
if errorlevel 1 (
    echo ERROR: download failed.
    exit /b 1
)

if not "%~1"=="" (
    scp -P %SSH_PORT% %SERVER%:%APP_DIR%/ai-context/AI-FOCUS.md "%OUT_DIR%\AI-FOCUS.md" 2>nul
)

echo.
echo Done. Upload these files to Gemini:
echo   %OUT_DIR%\AI-CONTEXT.md
if not "%~1"=="" echo   %OUT_DIR%\AI-FOCUS.md
exit /b 0
