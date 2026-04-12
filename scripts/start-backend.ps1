$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$serviceDir = Resolve-Path (Join-Path $scriptDir "..\\backend\\websearch_service")

Set-Location $serviceDir

$activateScript = $null
if (Test-Path ".venv\\Scripts\\Activate.ps1") {
    $activateScript = Resolve-Path ".venv\\Scripts\\Activate.ps1"
} elseif (Test-Path "venv\\Scripts\\Activate.ps1") {
    $activateScript = Resolve-Path "venv\\Scripts\\Activate.ps1"
} elseif (Test-Path (Join-Path $repoRoot ".venv\\Scripts\\Activate.ps1")) {
    $activateScript = Resolve-Path (Join-Path $repoRoot ".venv\\Scripts\\Activate.ps1")
} elseif (Test-Path (Join-Path $repoRoot "venv\\Scripts\\Activate.ps1")) {
    $activateScript = Resolve-Path (Join-Path $repoRoot "venv\\Scripts\\Activate.ps1")
}

if (-not $activateScript) {
    Write-Host "Virtual environment not found. Create one under the service or repo root:" -ForegroundColor Red
    Write-Host "  cd backend\\websearch_service"
    Write-Host "  py -m venv .venv"
    Write-Host "  .\\.venv\\Scripts\\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    Write-Host ""
    Write-Host "Or at repo root: py -m venv .venv then re-run npm run start:backend"
    exit 1
}

. $activateScript

$port = if ($env:PORT -and $env:PORT.Trim()) { $env:PORT.Trim() } else { "7000" }

Write-Host "Starting backend server on http://localhost:$port"
Write-Host "API docs: http://localhost:$port/docs"
Write-Host "Frontend against this API: npm run dev:local  (separate terminal)"
Write-Host "(Override port: `$env:PORT='8000'; npm run start:backend)"
Write-Host ""

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $port
