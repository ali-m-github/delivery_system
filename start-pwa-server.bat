@echo off
setlocal enabledelayedexpansion

echo ========================================
echo  PWA Development Server Launcher
echo ========================================
echo.

REM SSH Configuration
set SERVER_IP=83.149.106.196
set SERVER_USER=user1
set SSH_KEY="C:\Users\Norton\10gbitServer.pub"
set TARGET_DIR=/var/www/delivery_system/web-pwa

echo Logging into %SERVER_USER%@%SERVER_IP% ...
echo Press Ctrl+C to abort before connection.
timeout /t 3 /nobreak >nul

echo.
echo Connecting and starting dev server on port 3005 ...
echo To stop the server, simply close this window or press Ctrl+C.
echo.

ssh -i %SSH_KEY% %SERVER_USER%@%SERVER_IP% "cd %TARGET_DIR% && npm run dev -- -p 3005"

echo.
echo Server stopped.
pause
