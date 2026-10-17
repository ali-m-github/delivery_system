#Requires -Version 5
<#
    idm-register.ps1

    REAL registration for Internet Download Manager (IDM), not just hiding
    the nag popup. It does what commercial "IDM activation" tools do:

      1. Writes registration values (FName / LName / Email / Serial) into
         HKCU\Software\DownloadManager so IDM reports itself as
         "Registered" instead of "Trial".
      2. Triggers a few downloads so IDM writes its browser-extension
         check keys (scansk / tvfrdt / radxcnt / LstCheck / ptrk_scdt ...).
      3. Locks those check keys (deny write) so the periodic online check
         can never flip IDM back to "trial expired / fake serial".

    Run as Administrator:
      powershell -ExecutionPolicy Bypass -File .\idm-register.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'

# --- 0. Require administrator ----------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'ERROR: this script must be run as Administrator.' -ForegroundColor Red
    exit 1
}

# --- 1. Locate IDMan.exe -----------------------------------------------------
$exe = $null
if (Test-Path 'HKCU:\Software\DownloadManager') {
    $exe = (Get-ItemProperty 'HKCU:\Software\DownloadManager').ExePath
}
if (-not $exe -or -not (Test-Path $exe)) {
    $exe = @(
        "${env:ProgramFiles(x86)}\Internet Download Manager\IDMan.exe",
        "$env:ProgramFiles\Internet Download Manager\IDMan.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $exe) {
    Write-Host 'ERROR: IDMan.exe not found. Install (or reinstall) the latest IDM first.' -ForegroundColor Red
    exit 1
}
Write-Host "IDM executable: $exe" -ForegroundColor Gray

# --- 2. Stop the running IDM process ------------------------------------------
Write-Host '[1/6] Stopping IDM...'
taskkill /f /im idman.exe 2>&1 | Out-Null
taskkill /f /im idmtray.exe 2>&1 | Out-Null
Start-Sleep 2

# --- 3. Remove stale trial/check values ---------------------------------------
Write-Host '[2/6] Removing stale trial/check values...'
foreach ($v in 'scansk','tvfrdt','radxcnt','LstCheck','ptrk_scdt','LastCheckQU') {
    reg delete "HKCU\Software\DownloadManager" /v $v /f 2>&1 | Out-Null
}

# --- 4. Write registration values ---------------------------------------------
Write-Host '[3/6] Writing registration values...'
$dm = 'HKCU:\Software\DownloadManager'
if (-not (Test-Path $dm)) { New-Item $dm -Force | Out-Null }
New-ItemProperty $dm -Name FName   -PropertyType String -Value 'User' -Force | Out-Null
New-ItemProperty $dm -Name LName   -PropertyType String -Value '' -Force | Out-Null
New-ItemProperty $dm -Name Email   -PropertyType String -Value 'info@tonec.com' -Force | Out-Null
New-ItemProperty $dm -Name Serial  -PropertyType String -Value 'FOX6H-3KWH4-7TSIN-Q4US7' -Force | Out-Null

# HKLM side key used by the browser extension
$arch = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
if ($arch -eq 'x86') {
    $clsidPath = 'HKCU:\Software\Classes\CLSID'
    $hkIdmKey  = 'HKLM:\SOFTWARE\Internet Download Manager'
} else {
    $clsidPath = 'HKCU:\Software\Classes\Wow6432Node\CLSID'
    $hkIdmKey  = 'HKLM:\SOFTWARE\Wow6432Node\Internet Download Manager'
}
if (-not (Test-Path $hkIdmKey)) { New-Item $hkIdmKey -Force | Out-Null }
New-ItemProperty $hkIdmKey -Name AdvIntDriverEnabled2 -PropertyType DWord -Value 1 -Force | Out-Null

# --- 5. Trigger downloads so IDM writes its browser-extension check keys --------
Write-Host '[4/6] Triggering downloads to generate check keys (needs internet)...'
$tmp = Join-Path $env:windir 'Temp'
$urls = @(
    'https://www.internetdownloadmanager.com/images/idm_box_min.png',
    'https://www.internetdownloadmanager.com/register/IDMlib/images/idman_logos.png',
    'https://www.internetdownloadmanager.com/pictures/idm_about.png'
)
foreach ($u in $urls) {
    Start-Process $exe -ArgumentList @('/n', '/d', $u, '/p', $tmp, '/f', 'temp.png') -ErrorAction SilentlyContinue
    Start-Sleep 2
}
Start-Sleep 3
taskkill /f /im idman.exe 2>&1 | Out-Null

# --- 6. Lock the check keys (deny write) ----------------------------------------
Write-Host '[5/6] Locking check keys...'
$none     = New-Object Security.Principal.SecurityIdentifier('S-1-0-0')   # NONE - owner
$everyone = New-Object Security.Principal.SecurityIdentifier('S-1-1-0') # Everyone - deny

function Lock-Key([string]$path) {
    if (-not (Test-Path $path)) { return }
    $item = Get-Item $path
    $acl  = $item.GetAccessControl()
    # remove any old deny rule so re-runs work
    $old = New-Object Security.AccessControl.RegistryAccessRule($everyone,'FullControl','ContainerInherit','None','Deny')
    $acl.RemoveAccessRuleAll($old) 2>&1 | Out-Null
    $acl.SetOwner($none)
    $rule = New-Object Security.AccessControl.RegistryAccessRule($everyone,'FullControl','ContainerInherit','None','Deny')
    $acl.AddAccessRule($rule)
    $item.SetAccessControl($acl)
}

$locked = 0
if (Test-Path $clsidPath) {
    Get-ChildItem $clsidPath | Where-Object { $_.PSChildName -match '^\{[0-9a-fA-F-]+\}$' } | ForEach-Object {
        $skip = $false
        try {
            $subNames = $_.GetSubKeyNames()
            if ($subNames | Where-Object { 'LocalServer32','InProcServer32','InProcHandler32' -contains $_ }) { $skip = $true }
        } catch { $skip = $true }
        if (-not $skip) { Lock-Key $_.Name; $locked++ }
    }
}
Lock-Key ($hkIdmKey -replace '^HKLM:','HKLM:')

# --- 7. Relaunch IDM -----------------------------------------------------------
Write-Host '[6/6] Relaunching IDM...'
Start-Process $exe

Write-Host ''
Write-Host 'Done. IDM should now report "Registered" (Help > About).' -ForegroundColor Green
Write-Host 'If a "fake serial" nag ever reappears, run this script again.' -ForegroundColor Gray
