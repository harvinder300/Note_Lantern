# Note Lantern Deep Analysis Plan

## Goal

Build a musician-grade transcription tool that can analyze a song and produce:

- accurate timed note events
- guitar-friendly tablature
- chord changes over time
- non-open-position chord diagrams by default

## Why the current MVP is not enough

The current browser implementation uses lightweight heuristics:

- pitch autocorrelation on mixed audio
- rough chord guessing from detected notes
- simplistic guitar mapping

That is not strong enough for real songs with overlapping instruments, vocals, drums, and production effects.

## Proposed architecture

### Frontend

- audio upload
- playback transport
- note timeline
- tablature view
- chord timeline
- chord diagram cards
- confidence / uncertainty indicators

### Backend

- FastAPI application
- asynchronous analysis jobs
- stored intermediate stems/results
- JSON API for frontend consumption

### Analysis pipeline

1. Audio ingestion
   - convert input to mono/stereo working formats as needed
   - normalize sample rate
   - validate duration and file size

2. Source separation
   - separate melody/vocals
   - separate bass
   - separate accompaniment/harmonic content
   Recommended tools:
   - Demucs or equivalent stem-separation model

3. Note transcription
   - melody-focused transcription on isolated melodic stems
   - output MIDI-like note events with onset, offset, confidence
   Recommended tools:
   - Basic Pitch
   - torchcrepe / CREPE
   - optional later polyphonic transcription model

4. Chord detection
   - compute chroma / harmonic features on accompaniment stem
   - segment by beat or stable harmonic windows
   - estimate chord labels with confidence
   Recommended tools:
   - librosa chroma features
   - template matching first
   - upgrade to ML chord classifier later

5. Guitar mapping
   - map notes to realistic string/fret choices
   - optimize for phrase continuity and playable movement
   - map chord labels to movable/barre/power-chord libraries
   - avoid open-position chords by default

6. Output assembly
   - note events
   - tab positions
   - chord events
   - chord diagrams
   - warnings and confidence scores

## Data contracts

### Note event

- `note`
- `midi`
- `start`
- `end`
- `confidence`
- `string`
- `fret`

### Chord event

- `chord`
- `start`
- `end`
- `confidence`
- `diagram`

### Chord diagram

- `name`
- `base_fret`
- `positions`
- `fingers`

## Implementation phases

### Phase 1

- scaffold backend
- define API schemas
- connect frontend upload to backend analyze endpoint
- return mock structured data

### Phase 2

- add audio preprocessing
- add source separation
- store intermediate stems

### Phase 3

- implement note transcription pipeline
- return real note events
- replace browser note detector

### Phase 4

- implement chord detection from harmonic stems
- return real chord timeline
- remove heuristic frontend chord estimation

### Phase 5

- implement guitar-specific fingering optimization
- implement non-open chord-shape selection
- add alternate shape suggestions

### Phase 6

- improve UX
- add looping, slowdown, export, practice tools
- add job progress and background processing

## Immediate next coding tasks

1. Add local Python environment setup and backend run instructions.
2. Add `/analyze` integration from the frontend.
3. Replace placeholder backend response with real preprocessing code.
4. Add a persisted analysis result format under `backend/data/results`.
5. Add test audio fixtures and response snapshots.
