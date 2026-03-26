import json
import re
from pathlib import Path

import librosa
import numpy as np

from ..schemas import AnalysisResponse, AnalysisWarnings, ChordDiagram, ChordEvent, NoteEvent


RESULTS_DIR = Path("backend/data/results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

STANDARD_TUNING = [
    (1, 64),
    (2, 59),
    (3, 55),
    (4, 50),
    (5, 45),
    (6, 40),
]

CHORD_SHAPES = {
    "C": {"base_fret": 3, "positions": [-1, 3, 5, 5, 5, 3], "fingers": [None, 1, 3, 4, 4, 1]},
    "Cm": {"base_fret": 3, "positions": [-1, 3, 5, 5, 4, 3], "fingers": [None, 1, 3, 4, 2, 1]},
    "C5": {"base_fret": 3, "positions": [-1, 3, 5, 5, -1, -1], "fingers": [None, 1, 3, 4, None, None]},
    "D": {"base_fret": 5, "positions": [-1, 5, 7, 7, 7, 5], "fingers": [None, 1, 3, 4, 4, 1]},
    "Dm": {"base_fret": 5, "positions": [-1, 5, 7, 7, 6, 5], "fingers": [None, 1, 3, 4, 2, 1]},
    "D5": {"base_fret": 5, "positions": [-1, 5, 7, 7, -1, -1], "fingers": [None, 1, 3, 4, None, None]},
    "E": {"base_fret": 7, "positions": [-1, 7, 9, 9, 9, 7], "fingers": [None, 1, 3, 4, 4, 1]},
    "Em": {"base_fret": 7, "positions": [-1, 7, 9, 9, 8, 7], "fingers": [None, 1, 3, 4, 2, 1]},
    "E5": {"base_fret": 7, "positions": [7, 9, 9, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
    "F": {"base_fret": 8, "positions": [-1, 8, 10, 10, 10, 8], "fingers": [None, 1, 3, 4, 4, 1]},
    "F5": {"base_fret": 8, "positions": [8, 10, 10, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
    "G": {"base_fret": 10, "positions": [-1, 10, 12, 12, 12, 10], "fingers": [None, 1, 3, 4, 4, 1]},
    "G5": {"base_fret": 3, "positions": [3, 5, 5, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
    "A": {"base_fret": 5, "positions": [5, 7, 7, 6, 5, 5], "fingers": [1, 3, 4, 2, 1, 1]},
    "Am": {"base_fret": 5, "positions": [5, 7, 7, 5, 5, 5], "fingers": [1, 3, 4, 1, 1, 1]},
    "A5": {"base_fret": 5, "positions": [5, 7, 7, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
    "B": {"base_fret": 7, "positions": [7, 9, 9, 8, 7, 7], "fingers": [1, 3, 4, 2, 1, 1]},
    "Bm": {"base_fret": 7, "positions": [7, 9, 9, 7, 7, 7], "fingers": [1, 3, 4, 1, 1, 1]},
    "B5": {"base_fret": 7, "positions": [7, 9, 9, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
}


def run_analysis_pipeline(audio_path: Path, file_id: str) -> AnalysisResponse:
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    harmonic, percussive = librosa.effects.hpss(y)
    tempo_bpm = estimate_tempo(percussive, sr)

    notes, note_warnings = extract_note_events(harmonic, sr)
    chords, chord_warnings = extract_chord_events(harmonic, sr, duration)
    key_signature = estimate_key_signature(harmonic, sr, chords)

    response = AnalysisResponse(
        file_id=file_id,
        duration=round(duration, 3),
        tempo_bpm=tempo_bpm,
        key_signature=key_signature,
        notes=notes,
        chords=chords,
        warnings=AnalysisWarnings(notes=note_warnings, chords=chord_warnings),
    )
    persist_result(response)
    return response


def estimate_tempo(y: np.ndarray, sr: int) -> float | None:
    if y.size == 0:
        return None

    segment_seconds = 10.0
    segment_length = int(segment_seconds * sr)
    hop_length = 512
    tempo_estimates: list[float] = []

    for start in range(0, len(y), segment_length):
        segment = y[start:start + segment_length]
        if len(segment) < sr * 4:
            continue

        rms = float(np.sqrt(np.mean(segment ** 2)))
        if rms < 0.01:
            continue

        onset_env = librosa.onset.onset_strength(y=segment, sr=sr, hop_length=hop_length)
        if onset_env.size == 0 or float(np.max(onset_env)) <= 1e-6:
            continue

        tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
        if tempo is None:
            continue

        tempo_value = float(np.atleast_1d(tempo)[0])
        if not np.isfinite(tempo_value) or tempo_value <= 0:
            continue

        while tempo_value < 110:
            tempo_value *= 2
        while tempo_value > 200:
            tempo_value /= 2

        tempo_estimates.append(tempo_value)

    if not tempo_estimates:
        return None

    return round(float(np.median(tempo_estimates)), 1)


def estimate_key_signature(y: np.ndarray, sr: int, chords: list[ChordEvent] | None = None) -> str | None:
    if y.size == 0:
        return None

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    if chroma.size == 0:
        return None

    profile = np.mean(chroma, axis=1)
    total = float(np.sum(profile))
    if total <= 1e-6:
        return None

    normalized = profile / total
    major_template = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_template = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    major_template = major_template / np.sum(major_template)
    minor_template = minor_template / np.sum(minor_template)
    chord_bias = build_key_bias_from_chords(chords or [])

    best_key = None
    best_score = -np.inf

    for root in range(12):
        major_score = float(np.dot(normalized, np.roll(major_template, root)))
        major_score += chord_bias.get((root, "Major"), 0.0)
        if major_score > best_score:
            best_score = major_score
            best_key = f"{pitch_class_to_name(root)} Major"

        minor_score = float(np.dot(normalized, np.roll(minor_template, root)))
        minor_score += chord_bias.get((root, "Minor"), 0.0)
        if minor_score > best_score:
            best_score = minor_score
            best_key = f"{pitch_class_to_name(root)} Minor"

    return best_key


def build_key_bias_from_chords(chords: list[ChordEvent]) -> dict[tuple[int, str], float]:
    if not chords:
        return {}

    bias: dict[tuple[int, str], float] = {}
    major_degrees = [0, 2, 4, 5, 7, 9, 11]
    minor_degrees = [0, 2, 3, 5, 7, 8, 10]

    last_index = len(chords) - 1

    for index, chord in enumerate(chords):
        parsed = parse_chord_name(chord.chord)
        if parsed is None:
            continue

        root_name, quality = parsed
        root_pitch_class = int(round(librosa.note_to_midi(f"{root_name}4"))) % 12
        duration = max(0.25, chord.end - chord.start)
        quality_weight = 1.0
        if quality in {"7", "maj7", "m7"}:
            quality_weight = 1.1
        boundary_weight = 1.0
        if index == 0 or index == last_index:
            boundary_weight = 1.35
        effective_weight = duration * quality_weight * boundary_weight

        for candidate_root in range(12):
            # Strong same-root mode evidence: tonic chord quality should dominate
            tonic_bias = tonic_mode_bias(candidate_root, root_pitch_class, quality)
            if tonic_bias:
                bias[(candidate_root, "Major")] = bias.get((candidate_root, "Major"), 0.0) + effective_weight * tonic_bias[0]
                bias[(candidate_root, "Minor")] = bias.get((candidate_root, "Minor"), 0.0) + effective_weight * tonic_bias[1]

            degree_major = (root_pitch_class - candidate_root) % 12
            if degree_major in major_degrees:
                score = degree_fit_score(degree_major, quality, mode="Major")
                if score:
                    bias[(candidate_root, "Major")] = bias.get((candidate_root, "Major"), 0.0) + effective_weight * score

            degree_minor = (root_pitch_class - candidate_root) % 12
            if degree_minor in minor_degrees:
                score = degree_fit_score(degree_minor, quality, mode="Minor")
                if score:
                    bias[(candidate_root, "Minor")] = bias.get((candidate_root, "Minor"), 0.0) + effective_weight * score

    return bias


def tonic_mode_bias(candidate_root: int, chord_root: int, quality: str) -> tuple[float, float] | None:
    if candidate_root != chord_root:
        return None

    if quality in {"m", "m7"}:
        return (-0.2, 0.48)

    if quality in {"", "maj7"}:
        return (0.48, -0.2)

    if quality == "7":
        return (0.18, 0.06)

    return None


def degree_fit_score(degree: int, quality: str, mode: str) -> float:
    if mode == "Major":
        expected = {
            0: {"", "maj7"},
            2: {"m", "m7"},
            4: {"m", "m7"},
            5: {"", "maj7"},
            7: {"", "7"},
            9: {"m", "m7"},
            11: {"dim"},
        }
    else:
        expected = {
            0: {"m", "m7"},
            2: {"dim"},
            3: {"", "maj7"},
            5: {"m", "m7"},
            7: {"m", "", "7"},
            8: {"", "maj7"},
            10: {"", "7"},
        }

    allowed = expected.get(degree, set())
    if quality in allowed:
        if degree == 0:
            return 0.42
        if degree in {7, 3, 5, 10, 8}:
            return 0.24
        return 0.16

    if quality == "" and any(option.startswith("m") for option in allowed):
        return -0.08
    if quality.startswith("m") and "" in allowed:
        return -0.08

    return 0.0


def extract_note_events(y: np.ndarray, sr: int) -> tuple[list[NoteEvent], list[str]]:
    hop_length = 256
    frame_length = 2048
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sr,
        frame_length=frame_length,
        hop_length=hop_length,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=hop_length,
        units="frames",
        backtrack=False,
        pre_max=10,
        post_max=10,
        pre_avg=20,
        post_avg=20,
        delta=0.15,
        wait=8,
    )

    boundaries = sorted({0, *onset_frames.tolist(), len(times) - 1})
    notes = build_notes_from_boundaries(f0, voiced_flag, voiced_prob, times, boundaries)
    notes = merge_neighboring_notes(notes)

    warnings = []
    if not notes:
        warnings.append("No stable monophonic note events were detected.")
    else:
        warnings.append("Notes are segmented from onset-aware pYIN pitch tracking on the harmonic stem.")
    return notes[:512], warnings


def build_notes_from_boundaries(
    f0: np.ndarray,
    voiced_flag: np.ndarray,
    voiced_prob: np.ndarray,
    times: np.ndarray,
    boundaries: list[int],
) -> list[NoteEvent]:
    notes: list[NoteEvent] = []

    for boundary_index in range(len(boundaries) - 1):
        start_idx = boundaries[boundary_index]
        end_idx = boundaries[boundary_index + 1]
        if end_idx <= start_idx:
            continue

        pitches: list[float] = []
        confidences: list[float] = []
        midi_values: list[int] = []

        for frame_index in range(start_idx, end_idx):
            pitch = f0[frame_index]
            is_voiced = bool(voiced_flag[frame_index]) if voiced_flag[frame_index] is not None else False
            if not is_voiced or np.isnan(pitch):
                continue

            confidence = float(voiced_prob[frame_index]) if voiced_prob[frame_index] is not None else 0.0
            if confidence < 0.45:
                continue

            pitches.append(float(pitch))
            confidences.append(confidence)
            midi_values.append(int(round(librosa.hz_to_midi(float(pitch)))))

        if len(pitches) < 2:
            continue

        start_time = float(times[start_idx])
        end_time = float(times[min(end_idx, len(times) - 1)])
        if end_time - start_time < 0.08:
            continue

        midi = int(round(float(np.median(midi_values))))
        confidence = float(np.mean(confidences))
        string, fret = map_midi_to_guitar_position(midi)

        notes.append(
            NoteEvent(
                note=librosa.midi_to_note(midi, unicode=False),
                midi=midi,
                start=round(start_time, 3),
                end=round(end_time, 3),
                confidence=round(confidence, 3),
                string=string,
                fret=fret,
            )
        )

    return notes


def merge_neighboring_notes(notes: list[NoteEvent]) -> list[NoteEvent]:
    if not notes:
        return []

    merged = [notes[0]]
    for note in notes[1:]:
        previous = merged[-1]
        same_pitch = abs(note.midi - previous.midi) <= 1
        short_gap = note.start - previous.end <= 0.06
        if same_pitch and short_gap:
            previous.end = note.end
            previous.confidence = round(max(previous.confidence, note.confidence), 3)
            continue

        merged.append(note)

    return [note for note in merged if note.end - note.start >= 0.1]


def extract_chord_events(y: np.ndarray, sr: int, duration: float) -> tuple[list[ChordEvent], list[str]]:
    if duration <= 0:
        return [], ["Audio duration was zero, so chords could not be analyzed."]

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")[1]
    frame_points = beat_frames.tolist() if len(beat_frames) > 1 else list(range(0, chroma.shape[1], 32))
    if not frame_points or frame_points[0] != 0:
        frame_points.insert(0, 0)
    if frame_points[-1] != chroma.shape[1]:
        frame_points.append(chroma.shape[1])

    chords: list[ChordEvent] = []
    for index in range(len(frame_points) - 1):
        start_frame = frame_points[index]
        end_frame = frame_points[index + 1]
        if end_frame <= start_frame:
            continue

        segment = chroma[:, start_frame:end_frame]
        label, confidence = classify_chord(segment.mean(axis=1))
        if label is None:
            continue

        start_time = float(librosa.frames_to_time(start_frame, sr=sr))
        end_time = float(librosa.frames_to_time(end_frame, sr=sr))
        if chords and chords[-1].chord == label:
            chords[-1].end = round(end_time, 3)
            chords[-1].confidence = max(chords[-1].confidence, round(confidence, 3))
            continue

        chords.append(
            ChordEvent(
                chord=label,
                start=round(start_time, 3),
                end=round(end_time, 3),
                confidence=round(confidence, 3),
                diagram=build_chord_diagram(label),
            )
        )

    warnings = []
    if not chords:
        warnings.append("No stable chord regions were detected from harmonic chroma features.")
    else:
        warnings.append("Chords are estimated from beat-aligned chroma templates and should still be reviewed by ear.")
    return chords[:128], warnings


def classify_chord(chroma_vector: np.ndarray) -> tuple[str | None, float]:
    if float(np.sum(chroma_vector)) <= 1e-6:
        return None, 0.0

    normalized = chroma_vector / np.sum(chroma_vector)
    templates = [
        ("", {0: 1.2, 4: 1.05, 7: 0.8}),
        ("m", {0: 1.2, 3: 1.05, 7: 0.8}),
        ("7", {0: 1.15, 4: 1.0, 7: 0.78, 10: 0.5}),
        ("maj7", {0: 1.15, 4: 1.0, 7: 0.78, 11: 0.5}),
        ("m7", {0: 1.15, 3: 1.0, 7: 0.78, 10: 0.5}),
    ]

    best_label = None
    best_score = 0.0
    for root in range(12):
        for suffix, template in templates:
            score = 0.0
            for interval, weight in template.items():
                score += weight * normalized[(root + interval) % 12]

            major_third = float(normalized[(root + 4) % 12])
            minor_third = float(normalized[(root + 3) % 12])
            fifth = float(normalized[(root + 7) % 12])
            score += get_a_minor_context_bias(root, suffix, major_third, minor_third, fifth)

            if score > best_score:
                best_score = score
                best_label = f"{pitch_class_to_name(root)}{suffix}"

    if best_label is None or best_score < 0.28:
        return None, 0.0
    return best_label, min(0.99, float(best_score))


def get_a_minor_context_bias(root: int, quality: str, major_third: float, minor_third: float, fifth: float) -> float:
    root_name = pitch_class_to_name(root)
    preferred_by_root = {
        "A": {"m", "m7", "7"},
        "C": {"", "maj7"},
        "D": {"m", "m7"},
        "E": {"", "7", "m"},
        "F": {"", "maj7"},
        "G": {"", "7"},
    }

    bias = 0.0
    if quality in preferred_by_root.get(root_name, set()):
        bias += 0.08

    if root_name == "A" and fifth > 0.12 and minor_third >= major_third:
        if quality in {"m", "m7"}:
            bias += 0.14
        if quality == "":
            bias -= 0.08

    if root_name == "G" and major_third > 0.08:
        if quality in {"", "7"}:
            bias += 0.12
        if quality in {"m", "m7"}:
            bias -= 0.12

    if root_name == "E" and major_third >= minor_third and quality in {"", "7"}:
        bias += 0.1

    return bias


def map_midi_to_guitar_position(midi: int) -> tuple[int | None, int | None]:
    best: tuple[int, int] | None = None
    best_cost = float("inf")

    for string, open_midi in STANDARD_TUNING:
        fret = midi - open_midi
        if fret < 1 or fret > 17:
            continue

        cost = abs(fret - 7)
        if cost < best_cost:
            best = (string, fret)
            best_cost = cost

    if best is not None:
        return best

    for string, open_midi in STANDARD_TUNING:
        fret = midi - open_midi
        if fret < 0 or fret > 17:
            continue
        return string, fret

    return None, None


def build_chord_diagram(chord_name: str) -> ChordDiagram:
    shape = CHORD_SHAPES.get(chord_name)
    if shape is None:
        shape = resolve_barre_chord_shape(chord_name)
    if shape is None:
        shape = fallback_power_shape(chord_name)

    return ChordDiagram(
        name=chord_name,
        base_fret=shape["base_fret"],
        positions=shape["positions"],
        fingers=shape["fingers"],
    )


def resolve_barre_chord_shape(chord_name: str) -> dict | None:
    parsed = parse_chord_name(chord_name)
    if parsed is None:
        return None

    root_name, quality = parsed
    root_pitch_class = int(round(librosa.note_to_midi(f"{root_name}4"))) % 12
    low_e_fret = get_pitch_class_fret(root_pitch_class, 4)
    a_string_fret = get_pitch_class_fret(root_pitch_class, 9)
    use_e_shape = low_e_fret <= 4

    if use_e_shape:
        fret = low_e_fret
        shape = build_e_shape(quality, fret)
        if shape is not None:
            return shape

    fret = a_string_fret
    return build_a_shape(quality, fret)


def get_pitch_class_fret(root_pitch_class: int, open_string_pitch_class: int) -> int:
    return (root_pitch_class - open_string_pitch_class + 12) % 12


def parse_chord_name(chord_name: str) -> tuple[str, str] | None:
    normalized = chord_name.replace("♯", "#").strip()
    match = re.match(r"^([A-G]#?)(maj7|m7|m|7|sus2|sus4|dim|aug|5)?$", normalized)
    if not match:
        return None

    return match.group(1), match.group(2) or ""


def build_e_shape(quality: str, fret: int) -> dict | None:
    shapes = {
        "": {"positions": [fret, fret + 2, fret + 2, fret + 1, fret, fret], "fingers": [1, 3, 4, 2, 1, 1]},
        "m": {"positions": [fret, fret + 2, fret + 2, fret, fret, fret], "fingers": [1, 3, 4, 1, 1, 1]},
        "7": {"positions": [fret, fret + 2, fret, fret + 1, fret, fret], "fingers": [1, 3, 1, 2, 1, 1]},
        "maj7": {"positions": [fret, fret + 2, fret + 1, fret + 1, fret, fret], "fingers": [1, 4, 2, 3, 1, 1]},
        "m7": {"positions": [fret, fret + 2, fret, fret, fret, fret], "fingers": [1, 3, 1, 1, 1, 1]},
        "sus4": {"positions": [fret, fret + 2, fret + 2, fret + 2, fret, fret], "fingers": [1, 2, 3, 4, 1, 1]},
        "sus2": {"positions": [fret, fret + 2, fret + 4, fret + 4, fret + 2, fret], "fingers": [1, 2, 4, 4, 2, 1]},
        "dim": {"positions": [fret, fret + 1, fret + 2, fret, fret + 2, fret], "fingers": [1, 2, 3, 1, 4, 1]},
        "aug": {"positions": [fret, fret + 3, fret + 2, fret + 1, fret + 1, fret], "fingers": [1, 4, 3, 2, 2, 1]},
        "5": {"positions": [fret, fret + 2, fret + 2, -1, -1, -1], "fingers": [1, 3, 4, None, None, None]},
    }
    shape = shapes.get(quality)
    if shape is None:
        return None

    return {"base_fret": fret, **shape}


def build_a_shape(quality: str, fret: int) -> dict | None:
    shapes = {
        "": {"positions": [-1, fret, fret + 2, fret + 2, fret + 2, fret], "fingers": [None, 1, 2, 3, 4, 1]},
        "m": {"positions": [-1, fret, fret + 2, fret + 2, fret + 1, fret], "fingers": [None, 1, 3, 4, 2, 1]},
        "7": {"positions": [-1, fret, fret + 2, fret, fret + 2, fret], "fingers": [None, 1, 3, 1, 4, 1]},
        "maj7": {"positions": [-1, fret, fret + 2, fret + 1, fret + 2, fret], "fingers": [None, 1, 3, 2, 4, 1]},
        "m7": {"positions": [-1, fret, fret + 2, fret, fret + 1, fret], "fingers": [None, 1, 3, 1, 2, 1]},
        "sus4": {"positions": [-1, fret, fret + 2, fret + 2, fret + 3, fret], "fingers": [None, 1, 2, 3, 4, 1]},
        "sus2": {"positions": [-1, fret, fret + 2, fret + 2, fret, fret], "fingers": [None, 1, 3, 4, 1, 1]},
        "dim": {"positions": [-1, fret, fret + 1, fret + 2, fret + 1, fret], "fingers": [None, 1, 2, 4, 3, 1]},
        "aug": {"positions": [-1, fret, fret + 3, fret + 2, fret + 2, fret + 1], "fingers": [None, 1, 4, 2, 3, 1]},
        "5": {"positions": [-1, fret, fret + 2, fret + 2, -1, -1], "fingers": [None, 1, 3, 4, None, None]},
    }
    shape = shapes.get(quality)
    if shape is None:
        return None

    return {"base_fret": fret, **shape}


def fallback_power_shape(chord_name: str) -> dict:
    parsed = parse_chord_name(chord_name)
    root_name = parsed[0] if parsed else "E"
    root_midi = int(round(librosa.note_to_midi(f"{root_name}2")))
    low_e = 40
    a_string = 45

    if low_e <= root_midi <= low_e + 10:
        fret = max(1, root_midi - low_e) or 12
        return {
            "base_fret": fret,
            "positions": [fret, fret + 2, fret + 2, -1, -1, -1],
            "fingers": [1, 3, 4, None, None, None],
        }

    fret = max(1, root_midi - a_string) or 12
    return {
        "base_fret": fret,
        "positions": [-1, fret, fret + 2, fret + 2, -1, -1],
        "fingers": [None, 1, 3, 4, None, None],
    }


def pitch_class_to_name(pitch_class: int) -> str:
    return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][pitch_class]


def persist_result(response: AnalysisResponse) -> None:
    destination = RESULTS_DIR / f"{response.file_id}.json"
    destination.write_text(json.dumps(response.model_dump(mode="json"), indent=2), encoding="utf-8")
