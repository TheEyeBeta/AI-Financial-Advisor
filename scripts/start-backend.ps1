$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = Resolve-Path (Join-Path $scriptDir "..\\backend\\websearch_service")

Set-Location $serviceDir

$venvName = $null
if (Test-Path ".venv\\Scripts\\Activate.ps1") {
    $venvName = ".venv"
} elseif (Test-Path "venv\\Scripts\\Activate.ps1") {
    $venvName = "venv"
}

if (-not $venvName) {
    Write-Host "Virtual environment not found. Create one with:" -ForegroundColor Red
    Write-Host "  py -m venv .venv"
    Write-Host "  .\\.venv\\Scripts\\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

. ".\\$venvName\\Scripts\\Activate.ps1"

Write-Host "Starting backend server on http://localhost:8000"
Write-Host "API docs: http://localhost:8000/docs"
Write-Host ""

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
