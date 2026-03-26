import json
import wave
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4


HOST = "127.0.0.1"
PORT = 8001
UPLOAD_DIR = Path("backend/data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def analyze_wav_file(audio_path: Path) -> dict:
    with wave.open(str(audio_path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw_frames = wav_file.readframes(frame_count)

    duration = frame_count / sample_rate if sample_rate else 0
    sample_type = "h" if sample_width == 2 else "i"
    frame_values = array(sample_type)
    frame_values.frombytes(raw_frames)

    if channels > 1:
        mono_values = array(sample_type)
        for index in range(0, len(frame_values), channels):
            mono_values.append(int(sum(frame_values[index:index + channels]) / channels))
        frame_values = mono_values

    rms_windows = []
    window_size = max(1, sample_rate // 8)
    max_value = float(2 ** (sample_width * 8 - 1))

    for start in range(0, len(frame_values), window_size):
        window = frame_values[start:start + window_size]
        if not window:
            continue
        energy = sum(sample * sample for sample in window) / len(window)
        rms = (energy ** 0.5) / max_value
        rms_windows.append(
            {
                "start": round(start / sample_rate, 3),
                "end": round(min(len(frame_values), start + window_size) / sample_rate, 3),
                "rms": round(rms, 4),
            }
        )

    return {
        "duration": round(duration, 3),
        "tempo_bpm": None,
        "preprocessing": {
            "channels": channels,
            "sample_width": sample_width,
            "sample_rate": sample_rate,
            "frame_count": frame_count,
            "rms_windows": rms_windows[:32],
        },
        "notes": [],
        "chords": [],
        "warnings": {
            "notes": [
                "Audio ingestion and preprocessing are active in the backend.",
                "Model-backed note transcription is not implemented in the stdlib server yet."
            ],
            "chords": [
                "Chord detection is not implemented in the stdlib server yet."
            ]
        }
    }


def analyze_audio_file(audio_path: Path) -> dict:
    if audio_path.suffix.lower() != ".wav":
        return {
            "duration": 0.0,
            "tempo_bpm": None,
            "preprocessing": {},
            "notes": [],
            "chords": [],
            "warnings": {
                "notes": [
                    "The temporary dependency-free backend currently supports WAV preprocessing only."
                ],
                "chords": [
                    "Use WAV input for backend preprocessing, or rely on browser fallback for now."
                ]
            }
        }

    return analyze_wav_file(audio_path)


class NoteLanternHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        json_response(self, 200, {"status": "ok"})

    def do_GET(self) -> None:
        if self.path == "/health":
            json_response(self, 200, {"status": "ok", "server": "stdlib"})
            return

        json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/analyze":
            json_response(self, 404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        filename = self.headers.get("X-Filename", "upload.bin")
        suffix = Path(filename).suffix or ".bin"
        file_id = uuid4().hex
        destination = UPLOAD_DIR / f"{file_id}{suffix}"
        destination.write_bytes(self.rfile.read(content_length))

        analysis = analyze_audio_file(destination)
        payload = {
            "file_id": file_id,
            **analysis,
        }
        json_response(self, 200, payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), NoteLanternHandler)
    print(f"Starting Note Lantern stdlib API at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
