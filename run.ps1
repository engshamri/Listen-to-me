# ============================================================
#  Listen to me - PowerShell launcher
#  Usage:  .\run.ps1            (same options as server.py, e.g. .\run.ps1 --port 8080)
#  If scripts are blocked:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#  ASCII-only on purpose: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.
# ============================================================
Set-Location -Path $PSScriptRoot

$python = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $python = "python" }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $python = "py" }

if (-not $python) {
    Write-Host "[X] Python is not installed." -ForegroundColor Red
    Write-Host "    Download it from https://www.python.org/downloads/"
    Write-Host "    On the first installer screen tick 'Add python.exe to PATH'."
    exit 1
}

if ($python -eq "py") { & py -3 server.py @args } else { & python server.py @args }
exit $LASTEXITCODE
