# Note Lantern

Note Lantern is moving from a browser-only prototype to a backend-driven music analysis application for guitar-focused practice.

## Current repo state

- `index.html`, `styles.css`, `app.js`
  The original frontend MVP and UI experiments
- `backend/`
  New FastAPI scaffold for the future deep-analysis pipeline
- `docs/implementation-plan.md`
  Architecture and phased roadmap for accurate notes/chords/tab

## Why the shift

The browser-only analyzer is not strong enough for reliable transcription from full songs. Accurate note and chord detection needs:

- source separation
- stronger pitch/note transcription
- harmonic analysis
- guitar-specific fingering and chord-shape logic

## New direction

The intended system is:

1. Frontend uploads audio to the backend.
2. Backend runs deep audio analysis.
3. Backend returns structured notes, chords, tab positions, and chord diagrams.
4. Frontend renders synchronized practice views.

## Backend scaffold

The backend currently includes:

- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/app/services/pipeline.py`
- `backend/requirements.txt`
- `backend/server.py`

The FastAPI files remain as the long-term target structure, and `backend/server.py` is the dependency-free backend we can run right now on Python 3.14.

## Planning docs

- [Implementation plan](/workspace/docs/implementation-plan.md)
- [Backend README](/workspace/backend/README.md)

## Frontend run

1. Open PowerShell in this folder.
2. Run `.\start-local.ps1`
3. Open `http://localhost:8000`

## Backend run

Recommended for the real backend stack:

1. Install Python 3.12
2. Run `.\setup-backend-env.ps1`
3. Run `.\start-backend.ps1`
4. API will be available at `http://localhost:8001`

## Current behavior

- The frontend now tries the backend `/analyze` endpoint first.
- The current backend performs real file ingestion and WAV preprocessing.
- If the backend is not running yet, or if it returns no note/chord events yet, the frontend falls back to the older browser-side analyzer.

## Python version note

- Python 3.14 is available on this machine, but the real backend dependency stack is better supported on Python 3.11/3.12.
- The repo is now prepared to use a project-local `.venv` with Python 3.12.

```powershell
.\setup-backend-env.ps1
.\start-backend.ps1
```
