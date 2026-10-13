@echo off
rem ===========================================================================
rem  pull-db-from-server.bat - pull a fresh PostgreSQL dump from the delivery
rem  server to whatever folder this .bat file sits in.
rem
rem  Copy this file to your Windows PC (any folder), double-click to run.
rem  Requires the built-in Windows OpenSSH client (Windows 10/11 have it).
rem
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
set "DB_NAME=delivery_system"
set "KEEP_DAYS=30"

rem Output goes next to this script (%~dp0 = the .bat file's own folder)
set "OUT_DIR=%~dp0"

for /f %%s in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%s"
set "OUT_FILE=%OUT_DIR%%DB_NAME%_%STAMP%.sql.gz"

echo Pulling "%DB_NAME%" from %SERVER% ...
echo Saving to: %OUT_FILE%
echo.

rem pg_dump runs on the server as the postgres superuser (no DB password in
rem this file), streams through gzip straight into the local file.
ssh -p %SSH_PORT% -o ServerAliveInterval=15 %SERVER% "sudo -u postgres pg_dump %DB_NAME% --no-owner --no-privileges | gzip -c" > "%OUT_FILE%"

if errorlevel 1 (
    echo.
    echo ERROR: pull failed - nothing saved.
    del /q "%OUT_FILE%" 2>nul
    exit /b 1
)

for %%F in ("%OUT_FILE%") do echo Saved: %%~nxF  ^(%%~zF bytes^)

rem ── Retention: remove local dumps older than KEEP_DAYS ─────────────────────
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%OUT_DIR%' -Filter '%DB_NAME%_*.sql.gz' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-%KEEP_DAYS%) } | Remove-Item -Force" 2>nul

echo.
echo Done. Restore with:  createdb delivery_system ^&^& gunzip -c <file>.sql.gz ^| psql delivery_system
exit /b 0
