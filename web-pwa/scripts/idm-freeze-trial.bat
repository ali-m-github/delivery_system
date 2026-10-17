@echo off
REM ===================================================================
REM  IDM freeze-trial script
REM
REM  What it does (the REAL fix, not just hiding the popup):
REM    1. Stops the running IDM app + helper service
REM    2. Backs up the current registry state to a .reg file
REM    3. Deletes the expired trial state under
REM       HKCU\Software\DownloadManager
REM    4. Launches IDM once so it recreates a fresh key, then closes it
REM    5. Locks the key with regini (see idm-lock.inf) so the trial
REM       counter can never tick down again
REM    6. Relaunches IDM - full features, no registration nag
REM
REM  Tip: run as administrator the first time if regini reports a
REM  permissions error.
REM ===================================================================

set "SCRIPT_DIR=%~dp0"
set "BACKUP_REG=%SCRIPT_DIR%idm-backup-before-freeze.reg"
set "LOCK_INF=%SCRIPT_DIR%idm-lock.inf"

REM -- Locate the IDM executable ---------------------------------------
set "IDM_EXE=%ProgramFiles(x86)%\Internet Download Manager\IDMan.exe"
if not exist "%IDM_EXE%" set "IDM_EXE=%ProgramFiles%\Internet Download Manager\IDMan.exe"
if not exist "%IDM_EXE%" goto :notfound

REM -- 1. Stop the running IDM app and helper service --------------------
echo [1/6] Stopping IDM...
taskkill /f /im IDMan.exe >nul 2>&1
sc stop IDMService >nul 2>&1
timeout /t 2 /nobreak >nul

REM -- 2. Back up the current registry key (reversibility) ---------------
echo [2/6] Backing up registry key to "%BACKUP_REG%"...
reg export "HKCU\Software\DownloadManager" "%BACKUP_REG%" /y >nul 2>&1

REM -- 3. Delete the expired trial state --------------------------------
echo [3/6] Deleting expired trial state...
reg delete "HKCU\Software\DownloadManager" /f >nul 2>&1

REM -- 4. Launch IDM so it recreates a fresh key, then close it -----------
echo [4/6] Launching IDM to recreate a fresh registry state...
start "" "%IDM_EXE%"
timeout /t 5 /nobreak >nul
taskkill /f /im IDMan.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM -- 5. Lock the key so the counter cannot tick down -------------------
echo [5/6] Locking registry key (read-only)...
regini "%LOCK_INF%" >nul 2>&1

REM -- 6. Relaunch IDM --------------------------------------------------
echo [6/6] Relaunching IDM...
start "" "%IDM_EXE%"

echo.
echo Done. Backup of your previous settings: "%BACKUP_REG%"
echo If you ever need IDM to save new settings, run idm-unlock.bat,
echo change the settings, then run this script again.
echo.
pause
exit /b 0

:notfound
echo [ERROR] IDMan.exe was not found in either Program Files location.
echo Open IDM, then Help ^> About to find the install folder, and edit
echo the IDM_EXE path above.
pause
exit /b 1
