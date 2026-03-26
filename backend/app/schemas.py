from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str


class NoteEvent(BaseModel):
    note: str
    midi: int
    start: float
    end: float
    confidence: float
    string: int | None = None
    fret: int | None = None


class ChordDiagram(BaseModel):
    name: str
    base_fret: int
    positions: list[int]
    fingers: list[int | None]


class ChordEvent(BaseModel):
    chord: str
    start: float
    end: float
    confidence: float
    diagram: ChordDiagram | None = None


class AnalysisWarnings(BaseModel):
    notes: list[str]
    chords: list[str]


class AnalysisResponse(BaseModel):
    file_id: str
    duration: float
    tempo_bpm: float | None = None
    key_signature: str | None = None
    notes: list[NoteEvent]
    chords: list[ChordEvent]
    warnings: AnalysisWarnings
