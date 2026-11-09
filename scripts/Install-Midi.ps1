[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'An elevated shell is required to install the signed virtual MIDI driver.'
}

$Existing = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'loopMIDI' } |
    Select-Object DisplayName,DisplayVersion,InstallLocation
if ($Existing) { $Existing | ConvertTo-Json; return }

$Winget = Get-Command winget.exe -ErrorAction Stop
& $Winget.Source install --id TobiasErichsen.loopMIDI --exact --source winget --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
if ($LASTEXITCODE -ne 0) { throw "loopMIDI installation failed with exit code $LASTEXITCODE. No alternate package will be attempted." }

$Installed = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'loopMIDI' } |
    Select-Object DisplayName,DisplayVersion,InstallLocation
if (-not $Installed) { throw 'The installer returned success but loopMIDI is not registered.' }
$Installed | ConvertTo-Json