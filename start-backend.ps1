Write-Host "Starting Note Lantern API at http://localhost:8001"
Write-Host "Press Ctrl+C to stop the server."
if (Test-Path ".\.venv\Scripts\python.exe") {
    try {
        & .\.venv\Scripts\python.exe -c "import sys; print(sys.executable)" | Out-Null
        Write-Host "Using project virtual environment."
        & .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8001
    } catch {
        Write-Host "Project virtual environment exists, but its Python executable is broken."
        Write-Host "Run .\setup-backend-env.ps1 after rebuilding .venv, then start the backend again."
        exit 1
    }
} else {
    Write-Host "Project virtual environment not found. Falling back to stdlib server."
    python backend/server.py
}
