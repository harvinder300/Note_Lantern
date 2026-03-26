Write-Host "Preparing Note Lantern backend environment..."

$pythonExe = $null
$pythonLabel = $null

try {
    $pythonExe = py -3.12 -c "import sys; print(sys.executable)"
    $pythonLabel = "Python 3.12"
} catch {
    try {
        $pythonExe = py -3.14 -c "import sys; print(sys.executable)"
        $pythonLabel = "Python 3.14"
    } catch {
        Write-Host "No supported Python runtime was found via the py launcher."
        Write-Host "Install Python 3.12 or Python 3.14 first, then rerun this script."
        exit 1
    }
}

Write-Host "Using $pythonLabel at $pythonExe"

if (-not (Test-Path ".venv")) {
    & $pythonExe -m venv .venv
}

try {
    & .\.venv\Scripts\python.exe -c "import sys; print(sys.executable)" | Out-Null
} catch {
    Write-Host "Existing .venv is broken or points to a missing Python install."
    Write-Host "Delete .venv and rerun this script to rebuild it."
    exit 1
}

& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

Write-Host ""
Write-Host "Backend environment is ready."
Write-Host "Start the real backend with: .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8001"
