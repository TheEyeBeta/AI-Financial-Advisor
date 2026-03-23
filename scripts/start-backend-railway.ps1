$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = Resolve-Path (Join-Path $scriptDir "..\\backend\\websearch_service")

Set-Location $serviceDir

$venvPath = $null
if (Test-Path ".venv\\Scripts\\python.exe") {
    $venvPath = ".venv\\Scripts\\python.exe"
} elseif (Test-Path "venv\\Scripts\\python.exe") {
    $venvPath = "venv\\Scripts\\python.exe"
}

if (-not $venvPath) {
    Write-Host "Virtual environment not found. Create one with:" -ForegroundColor Red
    Write-Host "  py -m venv .venv"
    Write-Host "  .\\.venv\\Scripts\\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

Write-Host "Starting backend with Railway environment variables on http://127.0.0.1:8000"
Write-Host "This uses the linked Railway project/service from backend/websearch_service."
Write-Host "Local overrides: ENVIRONMENT=development for localhost CORS/trusted-host behavior."
Write-Host ""

$launcher = @"
$env:ENVIRONMENT = 'development'
& $venvPath -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
"@

npx railway run powershell -ExecutionPolicy Bypass -Command $launcher
