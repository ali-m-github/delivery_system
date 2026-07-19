@echo off
setlocal enabledelayedexpansion

echo ========================================
echo  PWA Development Server Launcher
echo ========================================
echo.

REM SSH Configuration
set SERVER_IP=83.149.106.196
set SERVER_USER=user1
set SSH_KEY="C:\Users\Norton\10gbitServer"
set TARGET_DIR=/var/www/delivery_system/web-pwa

REM Fix Windows permissions on the SSH private key (required for OpenSSH)
echo Fixing SSH key permissions...
icacls %SSH_KEY% /inheritance:r /grant:r "%USERNAME%:R" >nul 2>&1
if errorlevel 1 (
    echo Warning: Could not fix key permissions automatically.
    echo If SSH still complains, run this manually as Administrator:
    echo   icacls %SSH_KEY% /inheritance:r /grant:r "%%USERNAME%%:R"
    echo.
)

echo Cleaning stale cache (requires sudo to remove files owned by ai_dev)...
ssh -i %SSH_KEY% -p 21000 %SERVER_USER%@%SERVER_IP% "sudo rm -rf %TARGET_DIR%/.next %TARGET_DIR%/node_modules/.cache 2>/dev/null; mkdir -p /tmp/user1-home /tmp/user1-cache 2>/dev/null"
echo.
timeout /t 2 /nobreak >nul

echo.
echo Starting dev server on port 3005 ...
echo To stop the server, simply close this window or press Ctrl+C.
echo.

ssh -i %SSH_KEY% -p 21000 %SERVER_USER%@%SERVER_IP% "cd %TARGET_DIR% && HOME=/tmp/user1-home XDG_CACHE_HOME=/tmp/user1-cache TMPDIR=/tmp/user1-cache node_modules/.bin/next dev -p 3005"

echo.
echo Server stopped.
pause
