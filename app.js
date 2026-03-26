const audioFileInput = document.getElementById("audioFile");
const analyzeButton = document.getElementById("analyzeButton");
const selectedFileLabel = document.getElementById("selectedFileLabel");
const audioPlayer = document.getElementById("audioPlayer");
const analysisBadge = document.getElementById("analysisBadge");
const noteCount = document.getElementById("noteCount");
const tempoEstimate = document.getElementById("tempoEstimate");
const rangeEstimate = document.getElementById("rangeEstimate");
const keyEstimate = document.getElementById("keyEstimate");
const timeline = document.getElementById("timeline");
const timelineEmptyState = document.getElementById("timelineEmptyState");
const notesTableBody = document.getElementById("notesTableBody");
const chordsOutput = document.getElementById("chordsOutput");
const tablatureOutput = document.getElementById("tablatureOutput");
const API_BASE_URL = window.NOTE_LANTERN_API_BASE_URL || "http://localhost:8001";

let selectedFile = null;
let objectUrl = null;
let detectedNotes = [];
let detectedChords = [];
let detectedTempoBpm = null;
let detectedKeySignature = null;

audioFileInput.addEventListener("change", handleFileSelection);
analyzeButton.addEventListener("click", analyzeCurrentFile);
audioPlayer.addEventListener("timeupdate", syncPlaybackHighlight);
audioPlayer.addEventListener("seeked", syncPlaybackHighlight);
audioPlayer.addEventListener("ended", clearHighlights);

function handleFileSelection(event) {
  selectedFile = event.target.files?.[0] ?? null;
  analyzeButton.disabled = !selectedFile;

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  clearResults();

  if (!selectedFile) {
    selectedFileLabel.textContent = "No audio selected yet.";
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    return;
  }

  objectUrl = URL.createObjectURL(selectedFile);
  audioPlayer.src = objectUrl;
  selectedFileLabel.textContent = `${selectedFile.name} selected`;
  analysisBadge.textContent = "Ready to analyze";
  analysisBadge.className = "status-pill idle";
}

async function analyzeCurrentFile() {
  if (!selectedFile) {
    return;
  }

  setAnalyzingState(true);

  try {
    const backendAnalysis = await analyzeWithBackend(selectedFile);
    const arrayBuffer = await selectedFile.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    await audioContext.close();

    detectedTempoBpm = backendAnalysis?.tempoBpm ?? estimateTempoFromAudioBuffer(audioBuffer);
    detectedKeySignature = backendAnalysis?.keySignature ?? estimateKeySignatureFromNotes(backendAnalysis?.chords ?? [], []);
    detectedNotes = await extractNotesFromBuffer(audioBuffer, updateAnalysisProgress);
    if (backendAnalysis?.chords?.length) {
      detectedChords = backendAnalysis.chords;
      updateChordProgress(1);
    } else {
      detectedChords = await estimateChordsFromAudioBuffer(audioBuffer, updateChordProgress);
    }

    if (!detectedNotes.length && backendAnalysis?.notes?.length) {
      detectedNotes = backendAnalysis.notes;
    }

    renderNotes(detectedNotes);
    renderStats(detectedNotes, detectedTempoBpm, detectedKeySignature);
    renderChords(detectedChords);

    if (backendAnalysis?.tempoBpm) {
      analysisBadge.textContent = detectedNotes.length ? "Hybrid analysis complete" : "Backend tempo + no clear melody";
      analysisBadge.className = `status-pill ${detectedNotes.length ? "done" : "idle"}`;
      return;
    }

    analysisBadge.textContent = detectedNotes.length ? "Browser fallback analysis complete" : "No clear melody found";
    analysisBadge.className = `status-pill ${detectedNotes.length ? "done" : "idle"}`;
  } catch (error) {
    console.error(error);
    analysisBadge.textContent = "Analysis failed";
    analysisBadge.className = "status-pill idle";
    notesTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="placeholder-cell">
          Something went wrong while decoding or analyzing the file.
        </td>
      </tr>
    `;
    chordsOutput.innerHTML = `<div class="empty-state">Could not generate chord suggestions because the analysis failed.</div>`;
    tablatureOutput.textContent = "Could not generate tablature because the analysis failed.";
  } finally {
    setAnalyzingState(false);
  }
}

async function analyzeWithBackend(file) {
  updateBackendProgress("Uploading audio...");

  try {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Backend analyze failed with status ${response.status}`);
    }

    updateBackendProgress("Normalizing backend results...");
    const normalized = normalizeBackendAnalysis(await response.json());
    if (!normalized.notes.length && !normalized.chords.length) {
      console.info("Backend preprocessing succeeded, but there are no transcribed notes/chords yet. Falling back to browser analyzer.");
      return null;
    }
    return normalized;
  } catch (error) {
    console.warn("Backend analysis unavailable, falling back to browser analyzer.", error);
    return null;
  }
}

function normalizeBackendAnalysis(payload) {
  const notes = (payload.notes ?? []).map((note, index) => ({
    id: index + 1,
    note: note.note,
    midi: note.midi,
    start: note.start,
    end: note.end,
    duration: Math.max(0, (note.end ?? note.start) - note.start),
    confidence: note.confidence,
    string: note.string,
    fret: note.fret
  }));

  const chords = (payload.chords ?? []).map((chord, index) => ({
    id: index + 1,
    name: chord.chord,
    start: chord.start,
    end: chord.end,
    confidence: chord.confidence,
    diagram: chord.diagram ?? null
  }));

  return {
    notes,
    chords,
    tempoBpm: payload.tempo_bpm ?? null,
    keySignature: payload.key_signature ?? null
  };
}

function setAnalyzingState(isAnalyzing) {
  analyzeButton.disabled = isAnalyzing || !selectedFile;
  analyzeButton.textContent = isAnalyzing ? "Analyzing..." : "Analyze Song";

  if (isAnalyzing) {
    analysisBadge.textContent = "Listening closely...";
    analysisBadge.className = "status-pill running";
  }
}

function clearResults() {
  detectedNotes = [];
  detectedChords = [];
  detectedTempoBpm = null;
  detectedKeySignature = null;
  noteCount.textContent = "0";
  tempoEstimate.textContent = "-";
  rangeEstimate.textContent = "-";
  keyEstimate.textContent = "-";
  chordsOutput.innerHTML = `<div class="empty-state">Analyze a file to generate likely chord changes.</div>`;
  tablatureOutput.textContent = "Analyze a file to generate tablature.";
  timeline.innerHTML = "";
  timeline.classList.add("hidden");
  timelineEmptyState.classList.remove("hidden");
  notesTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="placeholder-cell">Detected notes will appear here after analysis.</td>
    </tr>
  `;
}

async function extractNotesFromBuffer(audioBuffer, onProgress = () => undefined) {
  const targetSampleRate = 11025;
  const analysisData = downsampleChannelData(audioBuffer.getChannelData(0), audioBuffer.sampleRate, targetSampleRate);
  const sampleRate = analysisData.sampleRate;
  const channelData = analysisData.samples;
  const frameSize = 1024;
  const hopSize = 1024;
  const minFrequency = 55;
  const maxFrequency = 1046.5;
  const rmsThreshold = 0.012;
  const frames = [];
  const totalFrames = Math.max(1, Math.floor((channelData.length - frameSize) / hopSize));

  let processedFrames = 0;
  onProgress(0);

  for (let start = 0; start + frameSize < channelData.length; start += hopSize) {
    const slice = channelData.subarray(start, start + frameSize);
    const rms = calculateRms(slice);

    if (rms < rmsThreshold) {
      frames.push({ time: start / sampleRate, note: null, frequency: null });
      processedFrames += 1;
      if (processedFrames % 20 === 0) {
        onProgress(processedFrames / totalFrames);
        await yieldToBrowser();
      }
      continue;
    }

    const frequency = autoCorrelate(slice, sampleRate, minFrequency, maxFrequency);
    if (!frequency) {
      frames.push({ time: start / sampleRate, note: null, frequency: null });
      processedFrames += 1;
      if (processedFrames % 20 === 0) {
        onProgress(processedFrames / totalFrames);
        await yieldToBrowser();
      }
      continue;
    }

    frames.push({
      time: start / sampleRate,
      note: frequencyToNoteName(frequency),
      frequency
    });

    processedFrames += 1;
    if (processedFrames % 20 === 0) {
      onProgress(processedFrames / totalFrames);
      await yieldToBrowser();
    }
  }

  onProgress(1);
  return mergeFramesIntoNotes(frames, hopSize / sampleRate);
}

function downsampleChannelData(channelData, originalSampleRate, targetSampleRate) {
  if (originalSampleRate <= targetSampleRate) {
    return {
      samples: channelData,
      sampleRate: originalSampleRate
    };
  }

  const ratio = originalSampleRate / targetSampleRate;
  const newLength = Math.floor(channelData.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.floor((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < channelData.length; index += 1) {
      sum += channelData[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? sum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return {
    samples: result,
    sampleRate: targetSampleRate
  };
}

function calculateRms(buffer) {
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    sum += buffer[index] * buffer[index];
  }
  return Math.sqrt(sum / buffer.length);
}

function autoCorrelate(buffer, sampleRate, minFrequency, maxFrequency) {
  const minLag = Math.floor(sampleRate / maxFrequency);
  const maxLag = Math.floor(sampleRate / minFrequency);
  let bestLag = -1;
  let bestCorrelation = 0;
  const energy = buffer.reduce((sum, value) => sum + value * value, 0);

  if (energy < 0.01) {
    return null;
  }

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let index = 0; index < buffer.length - lag; index += 1) {
      correlation += buffer[index] * buffer[index + lag];
    }

    correlation /= energy;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag === -1 || bestCorrelation < 0.2) {
    return null;
  }

  return sampleRate / bestLag;
}

function frequencyToNoteName(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  const note = names[(midi + 1200) % 12];
  return `${note}${octave}`;
}

function mergeFramesIntoNotes(frames, timeStep) {
  const minDuration = 0.12;
  const merged = [];
  let current = null;

  for (const frame of frames) {
    if (!frame.note) {
      if (current && current.duration >= minDuration) {
        merged.push(finalizeNote(current));
      }
      current = null;
      continue;
    }

    if (!current) {
      current = createNoteSegment(frame, timeStep);
      continue;
    }

    const centsDifference = Math.abs(1200 * Math.log2(frame.frequency / current.lastFrequency));
    const isSameNote = frame.note === current.note && centsDifference < 80;

    if (isSameNote) {
      current.lastFrequency = frame.frequency;
      current.duration += timeStep;
      current.frequencySamples.push(frame.frequency);
      continue;
    }

    if (current.duration >= minDuration) {
      merged.push(finalizeNote(current));
    }

    current = createNoteSegment(frame, timeStep);
  }

  if (current && current.duration >= minDuration) {
    merged.push(finalizeNote(current));
  }

  return cleanupDetectedNotes(merged).map((note, index) => ({
    ...note,
    id: index + 1
  }));
}

function createNoteSegment(frame, initialDuration) {
  return {
    note: frame.note,
    start: frame.time,
    duration: initialDuration,
    lastFrequency: frame.frequency,
    frequencySamples: [frame.frequency]
  };
}

function finalizeNote(note) {
  const meanFrequency =
    note.frequencySamples.reduce((sum, value) => sum + value, 0) / note.frequencySamples.length;

  return {
    note: note.note,
    start: note.start,
    duration: note.duration,
    frequency: meanFrequency
  };
}

function cleanupDetectedNotes(notes) {
  if (!notes.length) {
    return [];
  }

  const cleaned = [];

  for (const note of notes) {
    const previous = cleaned.at(-1);
    if (!previous) {
      cleaned.push({ ...note });
      continue;
    }

    const previousMidi = noteNameToMidi(previous.note);
    const currentMidi = noteNameToMidi(note.note);
    const samePitch = Math.abs(previousMidi - currentMidi) <= 1;
    const shortGap = note.start - (previous.start + previous.duration) <= 0.12;

    if (samePitch && shortGap) {
      const previousEnd = previous.start + previous.duration;
      previous.duration = Math.max(previousEnd, note.start + note.duration) - previous.start;
      previous.frequency = (previous.frequency + note.frequency) / 2;
      previous.note = midiToNoteName(Math.round((previousMidi + currentMidi) / 2));
      continue;
    }

    cleaned.push({ ...note });
  }

  return cleaned.filter((note) => note.duration >= 0.12);
}

function renderNotes(notes) {
  timeline.innerHTML = "";

  if (!notes.length) {
    timeline.classList.add("hidden");
    timelineEmptyState.classList.remove("hidden");
    notesTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="placeholder-cell">
          No stable note events were detected. Try a cleaner melodic excerpt.
        </td>
      </tr>
    `;
    chordsOutput.innerHTML = `<div class="empty-state">No stable notes were detected, so chord suggestions could not be generated.</div>`;
    tablatureOutput.textContent = "No stable notes were detected, so tablature could not be generated.";
    return;
  }

  timeline.classList.remove("hidden");
  timelineEmptyState.classList.add("hidden");

  const timelineMarkup = notes
    .map(
      (note) => `
        <button class="timeline-note" data-note-id="${note.id}">
          <div class="timeline-note-name">${note.note}</div>
          <div class="timeline-note-meta">${formatSeconds(note.start)} / ${formatSeconds(getNoteDuration(note))}</div>
        </button>
      `
    )
    .join("");

  timeline.innerHTML = timelineMarkup;

  timeline.querySelectorAll(".timeline-note").forEach((button) => {
    button.addEventListener("click", () => {
      const noteId = Number(button.dataset.noteId);
      const match = detectedNotes.find((note) => note.id === noteId);
      if (!match) {
        return;
      }
      audioPlayer.currentTime = match.start;
      audioPlayer.play().catch(() => undefined);
      syncPlaybackHighlight();
    });
  });

  notesTableBody.innerHTML = notes
    .map(
      (note) => `
        <tr data-note-row="${note.id}">
          <td>${note.id}</td>
          <td>${note.note}</td>
          <td>${formatSeconds(note.start)}</td>
          <td>${formatSeconds(getNoteDuration(note))}</td>
          <td>${formatPitchOrConfidence(note)}</td>
        </tr>
      `
    )
    .join("");
  tablatureOutput.textContent = generateTablature(notes);
}

function renderStats(notes, detectedTempo = null, detectedKey = null) {
  noteCount.textContent = String(notes.length);

  if (!notes.length) {
    tempoEstimate.textContent = "-";
    rangeEstimate.textContent = "-";
    keyEstimate.textContent = detectedKey ?? "-";
    return;
  }

  const estimatedBpm = detectedTempo ?? estimateTempoFromNotes(notes);
  tempoEstimate.textContent = estimatedBpm ? `~${estimatedBpm} BPM` : "-";

  const sortedMidiValues = notes
    .map((note) => noteNameToMidi(note.note))
    .sort((left, right) => left - right);
  rangeEstimate.textContent = `${midiToNoteName(sortedMidiValues[0])} - ${midiToNoteName(sortedMidiValues.at(-1))}`;
  keyEstimate.textContent = detectedKey ?? "-";
}

function estimateKeySignatureFromNotes(chords, notes) {
  if (chords.length && typeof chords[0].name === "string") {
    const preference = new Map();
    for (const chord of chords) {
      const parsed = parseChordName(chord.name);
      if (!parsed) {
        continue;
      }

      const quality = parsed.quality.startsWith("m") && parsed.quality !== "maj7" ? "Minor" : "Major";
      const label = `${parsed.root} ${quality}`;
      preference.set(label, (preference.get(label) ?? 0) + 1);
    }

    const best = [...preference.entries()].sort((left, right) => right[1] - left[1])[0];
    if (best) {
      return best[0];
    }
  }

  if (!notes.length) {
    return null;
  }

  const midiValues = notes.map((note) => noteNameToMidi(note.note) % 12);
  const counts = new Array(12).fill(0);
  for (const midi of midiValues) {
    counts[midi] += 1;
  }

  const root = counts.indexOf(Math.max(...counts));
  return `${pitchClassToName(root)} Minor`;
}

function estimateTempoFromNotes(notes) {
  if (notes.length < 2) {
    return null;
  }

  const onsetGaps = [];
  for (let index = 1; index < notes.length; index += 1) {
    const gap = notes[index].start - notes[index - 1].start;
    if (gap >= 0.18 && gap <= 1.5) {
      onsetGaps.push(gap);
    }
  }

  const widerPulseGaps = [];
  for (let index = 2; index < notes.length; index += 1) {
    const gap = notes[index].start - notes[index - 2].start;
    if (gap >= 0.35 && gap <= 2.4) {
      widerPulseGaps.push(gap / 2);
    }
  }

  const candidateGaps = onsetGaps.length >= 4 ? onsetGaps : onsetGaps.concat(widerPulseGaps);

  if (!candidateGaps.length) {
    return null;
  }

  const medianGap = calculateMedian(candidateGaps);
  if (!medianGap || !Number.isFinite(medianGap)) {
    return null;
  }

  let bpm = 60 / medianGap;
  while (bpm > 180) {
    bpm /= 2;
  }
  while (bpm < 72) {
    bpm *= 2;
  }

  return Number.isFinite(bpm) ? Math.round(bpm) : null;
}

function estimateTempoFromAudioBuffer(audioBuffer) {
  const targetSampleRate = 4000;
  const analysisData = downsampleChannelData(audioBuffer.getChannelData(0), audioBuffer.sampleRate, targetSampleRate);
  const samples = analysisData.samples;
  const sampleRate = analysisData.sampleRate;
  const frameSize = 1024;
  const hopSize = 256;
  const envelope = [];

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    const slice = samples.subarray(start, start + frameSize);
    envelope.push(calculateRms(slice));
  }

  if (envelope.length < 16) {
    return null;
  }

  const smoothed = smoothEnvelope(envelope, 4);
  const novelty = [];
  for (let index = 1; index < smoothed.length; index += 1) {
    novelty.push(Math.max(0, smoothed[index] - smoothed[index - 1]));
  }

  const framesPerSecond = sampleRate / hopSize;
  const minBpm = 72;
  const maxBpm = 180;
  const minLag = Math.floor((60 / maxBpm) * framesPerSecond);
  const maxLag = Math.ceil((60 / minBpm) * framesPerSecond);

  let bestLag = -1;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = lag; index < novelty.length; index += 1) {
      score += novelty[index] * novelty[index - lag];
    }

    // Favor tempi close to a common musical pulse instead of extreme edges.
    const bpm = 60 / (lag / framesPerSecond);
    const centerWeight = 1 - Math.min(1, Math.abs(120 - bpm) / 120) * 0.18;
    score *= centerWeight;

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || !Number.isFinite(bestScore) || bestScore <= 0) {
    return null;
  }

  let bpm = 60 / (bestLag / framesPerSecond);
  while (bpm < 90) {
    bpm *= 2;
  }
  while (bpm > 180) {
    bpm /= 2;
  }

  return Number.isFinite(bpm) ? Math.round(bpm) : null;
}

function smoothEnvelope(values, radius) {
  const smoothed = [];
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const target = index + offset;
      if (target < 0 || target >= values.length) {
        continue;
      }
      sum += values[target];
      count += 1;
    }
    smoothed.push(count ? sum / count : values[index]);
  }
  return smoothed;
}

function calculateMedian(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function syncPlaybackHighlight() {
  if (!detectedNotes.length) {
    return;
  }

  const currentTime = audioPlayer.currentTime;
  const activeNote = detectedNotes.find(
    (note) => currentTime >= note.start && currentTime < note.start + getNoteDuration(note)
  );

  timeline.querySelectorAll(".timeline-note").forEach((element) => {
    element.classList.toggle("active", Number(element.dataset.noteId) === activeNote?.id);
  });

  notesTableBody.querySelectorAll("tr").forEach((row) => {
    row.classList.toggle("active-row", Number(row.dataset.noteRow) === activeNote?.id);
  });

  if (activeNote) {
    const activeButton = timeline.querySelector(`[data-note-id="${activeNote.id}"]`);
    activeButton?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function clearHighlights() {
  timeline.querySelectorAll(".timeline-note").forEach((element) => {
    element.classList.remove("active");
  });
  notesTableBody.querySelectorAll("tr").forEach((row) => {
    row.classList.remove("active-row");
  });
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(2)}s`;
}

function getNoteDuration(note) {
  if (typeof note.duration === "number") {
    return note.duration;
  }
  if (typeof note.end === "number") {
    return Math.max(0, note.end - note.start);
  }
  return 0;
}

function formatPitchOrConfidence(note) {
  if (typeof note.frequency === "number") {
    return `${note.frequency.toFixed(1)} Hz`;
  }
  if (typeof note.confidence === "number") {
    return `${Math.round(note.confidence * 100)}%`;
  }
  return "-";
}

function updateAnalysisProgress(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  analysisBadge.textContent = `Detecting notes... ${Math.round(clamped * 100)}%`;
}

function updateChordProgress(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  analysisBadge.textContent = `Detecting chords... ${Math.round(clamped * 100)}%`;
}

function updateBackendProgress(message) {
  analysisBadge.textContent = message;
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function noteNameToMidi(noteName) {
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) {
    return 60;
  }
  const [, pitchClass, octaveString] = match;
  const map = {
    C: 0,
    "C#": 1,
    D: 2,
    "D#": 3,
    E: 4,
    F: 5,
    "F#": 6,
    G: 7,
    "G#": 8,
    A: 9,
    "A#": 10,
    B: 11
  };
  return (Number(octaveString) + 1) * 12 + map[pitchClass];
}

function midiToNoteName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function generateTablature(notes) {
  const mappedNotes = notes
    .map(mapNoteToGuitarPosition)
    .filter((note) => note !== null);

  if (!mappedNotes.length) {
    return "Detected notes are outside the comfortable range for standard guitar tab in this MVP.";
  }

  const blocks = [];
  const notesPerBlock = 16;

  for (let index = 0; index < mappedNotes.length; index += notesPerBlock) {
    blocks.push(buildTabBlock(mappedNotes.slice(index, index + notesPerBlock)));
  }

  return blocks.join("\n\n");
}

function renderChords(chords) {
  if (!chords.length) {
    chordsOutput.innerHTML = `<div class="empty-state">Not enough harmonic information was found to suggest chords.</div>`;
    return;
  }

  chordsOutput.innerHTML = chords
    .map((chord) => {
      const chordName = chord.name ?? chord.chord ?? "Unknown";
      const confidencePercent = chord.confidence > 1 ? Math.round(chord.confidence) : Math.round(chord.confidence * 100);
      const diagramShape = getChordShape(chordName) ?? chord.diagram;
      return `
        <article class="chord-card">
          <p class="chord-name">${chordName}</p>
          <p class="chord-meta">${formatSeconds(chord.start)} - ${formatSeconds(chord.end)} · confidence ${confidencePercent}%</p>
          <div class="chord-diagram">${diagramShape ? buildChordDiagramFromData(diagramShape) : buildChordDiagram(chordName)}</div>
        </article>
      `;
    })
    .join("");
}

async function estimateChordsFromAudioBuffer(audioBuffer, onProgress = () => undefined) {
  const targetSampleRate = 5512;
  const analysisData = downsampleChannelData(audioBuffer.getChannelData(0), audioBuffer.sampleRate, targetSampleRate);
  const samples = analysisData.samples;
  const sampleRate = analysisData.sampleRate;
  const windowSize = 4096;
  const hopSize = 2048;
  const totalWindows = Math.max(1, Math.floor((samples.length - windowSize) / hopSize));
  const estimates = [];

  onProgress(0);

  let processed = 0;
  for (let start = 0; start + windowSize < samples.length; start += hopSize) {
    const slice = samples.subarray(start, start + windowSize);
    const rms = calculateRms(slice);

    if (rms > 0.01) {
      const chroma = computeChroma(slice, sampleRate);
      const estimate = detectChordFromChroma(chroma);
      if (estimate) {
        estimates.push({
          ...estimate,
          start: start / sampleRate,
          end: (start + hopSize) / sampleRate
        });
      }
    }

    processed += 1;
    if (processed % 10 === 0) {
      onProgress(processed / totalWindows);
      await yieldToBrowser();
    }
  }

  onProgress(1);
  return mergeAdjacentChords(estimates).slice(0, 12);
}

function computeChroma(buffer, sampleRate) {
  const chroma = new Array(12).fill(0);
  const minMidi = 40;
  const maxMidi = 84;

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    chroma[midi % 12] += goertzelMagnitude(buffer, sampleRate, frequency);
  }

  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  return chroma.map((value) => value / total);
}

function goertzelMagnitude(buffer, sampleRate, frequency) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let previous = 0;
  let current = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const next = buffer[index] + coeff * current - previous;
    previous = current;
    current = next;
  }

  return Math.sqrt(current * current + previous * previous - coeff * current * previous);
}

function detectChordFromChroma(chroma) {
  const templates = [
    { suffix: "", intervals: [0, 4, 7], weights: [1.2, 1.05, 0.8] },
    { suffix: "m", intervals: [0, 3, 7], weights: [1.2, 1.05, 0.8] },
    { suffix: "7", intervals: [0, 4, 7, 10], weights: [1.15, 1.0, 0.78, 0.5] },
    { suffix: "maj7", intervals: [0, 4, 7, 11], weights: [1.15, 1.0, 0.78, 0.5] },
    { suffix: "m7", intervals: [0, 3, 7, 10], weights: [1.15, 1.0, 0.78, 0.5] }
  ];

  let best = null;

  for (let root = 0; root < 12; root += 1) {
    for (const template of templates) {
      let score = 0;
      for (let index = 0; index < template.intervals.length; index += 1) {
        const pitchClass = (root + template.intervals[index]) % 12;
        score += template.weights[index] * chroma[pitchClass];
      }

      const majorThird = chroma[(root + 4) % 12];
      const minorThird = chroma[(root + 3) % 12];
      const fifth = chroma[(root + 7) % 12];
      score += getAMinorContextBias(root, template.suffix, majorThird, minorThird, fifth);

      if (!best || score > best.score) {
        best = {
          name: `${pitchClassToName(root)}${template.suffix}`,
          score
        };
      }
    }
  }

  if (!best || best.score < 0.32) {
    return null;
  }

  return {
    name: best.name,
    confidence: Math.min(99, Math.round(best.score * 100))
  };
}

function getAMinorContextBias(root, quality, majorThird, minorThird, fifth) {
  const rootName = pitchClassToName(root);
  const preferredByRoot = {
    A: new Set(["m", "m7", "7"]),
    C: new Set(["", "maj7"]),
    D: new Set(["m", "m7"]),
    E: new Set(["", "7", "m"]),
    F: new Set(["", "maj7"]),
    G: new Set(["", "7"])
  };

  let bias = 0;
  if (preferredByRoot[rootName]?.has(quality)) {
    bias += 0.08;
  }

  if (rootName === "A" && fifth > 0.12 && minorThird >= majorThird) {
    if (quality === "m" || quality === "m7") {
      bias += 0.14;
    }
    if (quality === "") {
      bias -= 0.08;
    }
  }

  if (rootName === "G" && majorThird > 0.08) {
    if (quality === "" || quality === "7") {
      bias += 0.12;
    }
    if (quality === "m" || quality === "m7") {
      bias -= 0.12;
    }
  }

  if (rootName === "E" && majorThird >= minorThird) {
    if (quality === "7" || quality === "") {
      bias += 0.1;
    }
  }

  return bias;
}

function mergeAdjacentChords(chords) {
  const merged = [];

  for (const chord of chords) {
    const previous = merged.at(-1);
    if (previous && previous.name === chord.name && chord.start - previous.end < 0.8) {
      previous.end = chord.end;
      previous.confidence = Math.max(previous.confidence, chord.confidence);
      continue;
    }

    merged.push({ ...chord });
  }

  return merged.filter((chord) => chord.end - chord.start >= 1);
}

function pitchClassToName(pitchClass) {
  return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][pitchClass];
}

function buildChordDiagram(chordName) {
  const shape = getChordShape(chordName);
  if (!shape) {
    return `<div class="empty-state">No barre shape available</div>`;
  }
  return buildChordDiagramFromData(shape);
}

function buildChordDiagramFromData(shape) {
  const baseFret = shape.base_fret ?? shape.baseFret ?? 1;
  const barres = shape.barres ?? [];
  const header = shape.positions
    .map((position) => `<div class="fretboard-open">${position < 0 ? "x" : position === 0 ? "o" : ""}</div>`)
    .join("");

  const rows = [];
  for (let fret = 1; fret <= 5; fret += 1) {
    const absoluteFret = baseFret + fret - 1;
    const barreMarkup = barres
      .filter((barre) => barre.fret === absoluteFret)
      .map((barre) => {
        const start = Math.min(barre.fromString, barre.toString);
        const end = Math.max(barre.fromString, barre.toString);
        return `<span class="fret-barre" style="--barre-start:${start}; --barre-span:${end - start + 1};"></span>`;
      })
      .join("");

    rows.push(`
      <div class="fretboard-row">
        ${barreMarkup}
        ${shape.positions
          .map((position) => `<div class="fret-cell">${position === baseFret + fret - 1 ? '<span class="fret-marker"></span>' : ""}</div>`)
          .join("")}
      </div>
    `);
  }

  return `
    <div class="fretboard">
      <div class="fretboard-header">${header}</div>
      ${rows.join("")}
      <div class="fretboard-base">${getChordDiagramLabel(shape, baseFret)}</div>
    </div>
  `;
}

function getChordDiagramLabel(shape, baseFret) {
  const hasOpenStrings = shape.positions.some((position) => position === 0);
  const hasFrettedNotes = shape.positions.some((position) => position > 0);

  if (baseFret === 1 && hasOpenStrings) {
    return "open position";
  }

  if (hasFrettedNotes) {
    return `fret ${baseFret}`;
  }

  return "open position";
}

function getChordShape(chordName) {
  return resolveBarreChordShape(chordName);
}

function resolveBarreChordShape(chordName) {
  const parsed = parseChordName(chordName);
  if (!parsed) {
    return null;
  }

  const rootPitchClass = noteNameToMidi(`${parsed.root}4`) % 12;
  const lowEFret = getPitchClassFret(rootPitchClass, 4);
  const aStringFret = getPitchClassFret(rootPitchClass, 9);
  const useEShape = lowEFret <= 4;

  if (useEShape) {
    const fret = lowEFret;
    const shape = buildEShape(parsed.quality, fret);
    if (shape) {
      return shape;
    }
  }

  const fret = aStringFret;
  return buildAShape(parsed.quality, fret);
}

function getPitchClassFret(rootPitchClass, openStringPitchClass) {
  return (rootPitchClass - openStringPitchClass + 12) % 12;
}

function parseChordName(chordName) {
  const normalized = chordName.replace("♯", "#").trim();
  const match = normalized.match(/^([A-G]#?)(maj7|m7|m|7|sus2|sus4|dim|aug|5)?$/);
  if (!match) {
    return null;
  }

  return {
    root: match[1],
    quality: match[2] ?? ""
  };
}

function buildEShape(quality, fret) {
  const shapes = {
    "": { positions: [fret, fret + 2, fret + 2, fret + 1, fret, fret], fingers: [1, 3, 4, 2, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    m: { positions: [fret, fret + 2, fret + 2, fret, fret, fret], fingers: [1, 3, 4, 1, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    7: { positions: [fret, fret + 2, fret, fret + 1, fret, fret], fingers: [1, 3, 1, 2, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    maj7: { positions: [fret, fret + 2, fret + 1, fret + 1, fret, fret], fingers: [1, 4, 2, 3, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    m7: { positions: [fret, fret + 2, fret, fret, fret, fret], fingers: [1, 3, 1, 1, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    sus4: { positions: [fret, fret + 2, fret + 2, fret + 2, fret, fret], fingers: [1, 2, 3, 4, 1, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    sus2: { positions: [fret, fret + 2, fret + 4, fret + 4, fret + 2, fret], fingers: [1, 2, 4, 4, 2, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    dim: { positions: [fret, fret + 1, fret + 2, fret, fret + 2, fret], fingers: [1, 2, 3, 1, 4, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    aug: { positions: [fret, fret + 3, fret + 2, fret + 1, fret + 1, fret], fingers: [1, 4, 3, 2, 2, 1], barres: [{ fret, fromString: 0, toString: 5 }] },
    5: { positions: [fret, fret + 2, fret + 2, -1, -1, -1], fingers: [1, 3, 4, null, null, null] }
  };
  const shape = shapes[quality];
  return shape ? { ...shape, baseFret: fret } : null;
}

function buildAShape(quality, fret) {
  const shapes = {
    "": { positions: [-1, fret, fret + 2, fret + 2, fret + 2, fret], fingers: [null, 1, 2, 3, 4, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    m: { positions: [-1, fret, fret + 2, fret + 2, fret + 1, fret], fingers: [null, 1, 3, 4, 2, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    7: { positions: [-1, fret, fret + 2, fret, fret + 2, fret], fingers: [null, 1, 3, 1, 4, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    maj7: { positions: [-1, fret, fret + 2, fret + 1, fret + 2, fret], fingers: [null, 1, 3, 2, 4, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    m7: { positions: [-1, fret, fret + 2, fret, fret + 1, fret], fingers: [null, 1, 3, 1, 2, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    sus4: { positions: [-1, fret, fret + 2, fret + 2, fret + 3, fret], fingers: [null, 1, 2, 3, 4, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    sus2: { positions: [-1, fret, fret + 2, fret + 2, fret, fret], fingers: [null, 1, 3, 4, 1, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    dim: { positions: [-1, fret, fret + 1, fret + 2, fret + 1, fret], fingers: [null, 1, 2, 4, 3, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    aug: { positions: [-1, fret, fret + 3, fret + 2, fret + 2, fret + 1], fingers: [null, 1, 4, 2, 3, 1], barres: [{ fret, fromString: 1, toString: 5 }] },
    5: { positions: [-1, fret, fret + 2, fret + 2, -1, -1], fingers: [null, 1, 3, 4, null, null] }
  };
  const shape = shapes[quality];
  return shape ? { ...shape, baseFret: fret } : null;
}

function mapNoteToGuitarPosition(note) {
  const midi = noteNameToMidi(note.note);
  const strings = [
    { label: "e", midi: 64 },
    { label: "B", midi: 59 },
    { label: "G", midi: 55 },
    { label: "D", midi: 50 },
    { label: "A", midi: 45 },
    { label: "E", midi: 40 }
  ];

  let bestMatch = null;

  for (const string of strings) {
    const fret = midi - string.midi;
    if (fret < 0 || fret > 18) {
      continue;
    }

    if (!bestMatch || fret < bestMatch.fret) {
      bestMatch = {
        string: string.label,
        fret
      };
    }
  }

  return bestMatch;
}

function buildTabBlock(notes) {
  const rows = {
    e: "e|",
    B: "B|",
    G: "G|",
    D: "D|",
    A: "A|",
    E: "E|"
  };
  const stringOrder = ["e", "B", "G", "D", "A", "E"];

  for (const note of notes) {
    const fretText = String(note.fret);
    const width = Math.max(4, fretText.length + 2);

    for (const stringName of stringOrder) {
      if (stringName === note.string) {
        rows[stringName] += fretText.padEnd(width, "-");
      } else {
        rows[stringName] += "-".repeat(width);
      }
    }
  }

  for (const stringName of stringOrder) {
    rows[stringName] += "|";
  }

  return stringOrder.map((stringName) => rows[stringName]).join("\n");
}
