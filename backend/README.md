# Backend Plan

This backend is the foundation for replacing the browser-only heuristic analysis with a proper audio-analysis pipeline.

## Target stack

- FastAPI for upload and analysis endpoints
- Python DSP/ML services for:
  - source separation
  - note transcription
  - chord detection
  - guitar fingering / chord-shape mapping

## Planned pipeline

1. Accept uploaded audio.
2. Normalize audio to a standard sample rate and format.
3. Run source separation to isolate melody, bass, and accompaniment.
4. Run note transcription on the melody stem.
5. Run harmonic analysis / chord recognition on the accompaniment stem.
6. Convert notes/chords into guitar-aware outputs.
7. Return structured JSON to the frontend.

## Current status

The API is scaffolded but still returns placeholder data.
