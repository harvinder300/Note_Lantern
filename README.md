# Note Lantern

Note Lantern is a guitar-focused song analysis app for practice. It lets you upload audio and inspect:

- detected notes over time
- likely chord changes with guitar shapes
- quick tablature
- tempo and song key estimates

## What It Does

- Frontend interface for uploading and analyzing songs
- Playback deck with synchronized note timeline
- Chord cards with movable/barre-style guitar diagrams
- Backend-assisted tempo and key detection
- Hybrid analysis flow:
  - backend is preferred for tempo, key, and stronger harmonic context
  - browser analysis is still used for parts of note/chord display where it currently behaves better

## Project Structure

- `index.html`, `styles.css`, `app.js`
  Frontend UI and browser-side analysis logic
- `backend/`
  FastAPI backend, analysis schemas, and signal-processing pipeline
- `docs/implementation-plan.md`
  Roadmap for improving transcription accuracy

## Run Locally

### Frontend

```powershell
.\start-local.ps1
```

Then open:

```text
http://localhost:8000
```

### Backend

```powershell
.\setup-backend-env.ps1
.\start-backend.ps1
```

Then the API will be available at:

```text
http://localhost:8001
```

## Deploy Publicly

This project is now prepared for a simple Render deployment.

Files added for deployment:

- `config.js`
  Runtime frontend API configuration
- `render.yaml`
  Blueprint for deploying:
  - a public backend API
  - a public static frontend

### Render Deployment Steps

1. Push the latest code to GitHub.
2. Log in to Render.
3. Create a new Blueprint deployment from this GitHub repo.
4. Let Render create both services from `render.yaml`:
   - `note-lantern-api`
   - `note-lantern-web`
5. Wait for deployment to finish.
6. Open the static frontend URL from Render and test the app.

The frontend will automatically use the deployed backend URL generated during the Render build.

## Current State

This project is an evolving prototype. Tempo and key estimation are backend-driven, while some note and chord presentation still use hybrid logic to balance accuracy and responsiveness.

For full-song transcription, the long-term direction is still:

- better source separation
- stronger melody transcription
- stronger harmonic analysis
- more reliable guitar-aware note/chord mapping

## Important Notes

- Full commercial-song transcription is still imperfect.
- Chord and key detection should be reviewed by ear.
- The backend works best when its local Python environment is set up correctly.

## Docs

- `docs/implementation-plan.md`
- `backend/README.md`
