@echo off
REM ===================================================================
REM  IDM unlock script
REM
REM  Restores WRITE access to HKCU\Software\DownloadManager so IDM can
REM  save setting changes (download folder, browser integration, etc.).
REM  Run this, change your IDM settings, then run idm-freeze-trial.bat
REM  again to re-lock the trial counter.
REM ===================================================================

taskkill /f /im IDMan.exe >nul 2>&1
timeout /t 2 /nobreak >nul
regini "%~dp0idm-unlock.inf" >nul 2>&1
echo Registry key unlocked - IDM can save settings again.
