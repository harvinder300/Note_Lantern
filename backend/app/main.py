from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .schemas import AnalysisResponse, HealthResponse
from .services.pipeline import run_analysis_pipeline


app = FastAPI(title="Note Lantern API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


UPLOAD_DIR = Path("backend/data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_audio(file: UploadFile = File(...)) -> AnalysisResponse:
    file_id = uuid4().hex
    suffix = Path(file.filename or "upload.wav").suffix or ".wav"
    destination = UPLOAD_DIR / f"{file_id}{suffix}"

    contents = await file.read()
    destination.write_bytes(contents)

    return run_analysis_pipeline(destination, file_id)
