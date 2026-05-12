"use strict";

const state = {
  audioContext: null,
  analyser: null,
  mediaRecorder: null,
  micStream: null,
  recognition: null,
  listening: false,
  recording: false,
  chunks: [],
  recordingStartedAt: 0,
  belowSince: null,
  rafId: 0,
  lastDb: -100,
  segmentIndex: 0,
  finalTranscript: "",
  interimTranscript: "",
  speechSupported: false,
  restartingSpeech: false,
  speechRunning: false,
  speechCaptureUntil: 0,
  pendingTranscriptions: 0,
  serverTranscriptionFailed: false,
};

const els = {
  secureStatus: document.querySelector("#secureStatus"),
  levelLabel: document.querySelector("#levelLabel"),
  meterFill: document.querySelector("#meterFill"),
  thresholdLine: document.querySelector("#thresholdLine"),
  recordingState: document.querySelector("#recordingState"),
  silenceState: document.querySelector("#silenceState"),
  thresholdInput: document.querySelector("#thresholdInput"),
  thresholdValue: document.querySelector("#thresholdValue"),
  silenceDelayInput: document.querySelector("#silenceDelayInput"),
  silenceDelayValue: document.querySelector("#silenceDelayValue"),
  minDurationInput: document.querySelector("#minDurationInput"),
  minDurationValue: document.querySelector("#minDurationValue"),
  languageInput: document.querySelector("#languageInput"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  speechStatus: document.querySelector("#speechStatus"),
  transcriptOutput: document.querySelector("#transcriptOutput"),
  segmentCount: document.querySelector("#segmentCount"),
  segmentsList: document.querySelector("#segmentsList"),
};

const storageKey = "audio-threshold-transcriber-settings";
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    for (const [key, value] of Object.entries(saved)) {
      if (els[key]) {
        els[key].value = value;
      }
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function saveSettings() {
  const settings = {
    thresholdInput: els.thresholdInput.value,
    silenceDelayInput: els.silenceDelayInput.value,
    minDurationInput: els.minDurationInput.value,
    languageInput: els.languageInput.value,
  };
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

function dbToPercent(db) {
  const min = -70;
  const max = -10;
  return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
}

function updateSettingLabels() {
  const threshold = Number(els.thresholdInput.value);
  els.thresholdValue.value = `${threshold} dB`;
  els.silenceDelayValue.value = `${els.silenceDelayInput.value} ms`;
  els.minDurationValue.value = `${els.minDurationInput.value} ms`;
  els.thresholdLine.style.left = `${dbToPercent(threshold)}%`;
  saveSettings();
}

function setStatus(text, type = "") {
  els.secureStatus.textContent = text;
  els.secureStatus.className = `status-pill ${type}`.trim();
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function pickMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getRmsDb() {
  const buffer = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(buffer);

  let sum = 0;
  for (const sample of buffer) {
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / buffer.length);
  if (rms <= 0.00001) {
    return -100;
  }

  return 20 * Math.log10(rms);
}

function refreshTranscript() {
  const combined = [state.finalTranscript, state.interimTranscript]
    .filter(Boolean)
    .join(state.finalTranscript && state.interimTranscript ? " " : "");
  els.transcriptOutput.value = combined;
  els.exportButton.disabled = !combined.trim();
  els.clearButton.disabled = !combined.trim() && state.segmentIndex === 0;
}

function appendFinalTranscript(text) {
  const cleaned = text.trim();
  if (!cleaned) {
    return;
  }

  state.finalTranscript = `${state.finalTranscript} ${cleaned}`.trim();
  state.interimTranscript = "";
  refreshTranscript();
}

function setupSpeechRecognition() {
  state.speechSupported = Boolean(SpeechRecognitionCtor);
  if (!state.speechSupported) {
    els.speechStatus.textContent = "Transcription indisponible dans ce navigateur";
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = els.languageInput.value;

  recognition.onstart = () => {
    state.speechRunning = true;
    els.speechStatus.textContent = `Transcription active (${recognition.lang})`;
  };

  recognition.onerror = (event) => {
    els.speechStatus.textContent = `Transcription: ${event.error}`;
  };

  recognition.onend = () => {
    state.speechRunning = false;
    if (state.listening && !state.restartingSpeech) {
      state.restartingSpeech = true;
      window.setTimeout(() => {
        state.restartingSpeech = false;
        startSpeechRecognition();
      }, 250);
      return;
    }

    if (!state.recording) {
      els.speechStatus.textContent = "Transcription en pause";
    }
  };

  recognition.onresult = (event) => {
    if (!state.recording && performance.now() > state.speechCaptureUntil) {
      return;
    }

    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript.trim();
      if (!transcript) {
        continue;
      }
      if (event.results[i].isFinal) {
        state.finalTranscript = `${state.finalTranscript} ${transcript}`.trim();
      } else {
        interim = `${interim} ${transcript}`.trim();
      }
    }
    state.interimTranscript = interim;
    refreshTranscript();
  };

  state.recognition = recognition;
}

function startSpeechRecognition() {
  if (!state.recognition || state.speechRunning) {
    return;
  }

  state.recognition.lang = els.languageInput.value;
  try {
    state.recognition.start();
  } catch {
    // start() throws when the engine is already active. That is harmless here.
  }
}

function stopSpeechRecognition() {
  if (!state.recognition) {
    return;
  }

  try {
    state.recognition.stop();
  } catch {
    // Some engines throw if stop() is called while inactive.
  }
}

function languageCode() {
  return els.languageInput.value.split("-")[0];
}

async function transcribeSegment(blob, segmentNumber) {
  if (state.serverTranscriptionFailed) {
    return;
  }

  if (blob.size > 24 * 1024 * 1024) {
    els.speechStatus.textContent = `Segment ${segmentNumber}: audio trop volumineux pour transcription`;
    return;
  }

  state.pendingTranscriptions += 1;
  els.speechStatus.textContent = `Transcription serveur du segment ${segmentNumber}...`;

  try {
    const response = await fetch(`/api/transcribe?language=${encodeURIComponent(languageCode())}`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
      },
      body: blob,
    });

    if (response.status === 404) {
      state.serverTranscriptionFailed = true;
      els.speechStatus.textContent = state.speechSupported
        ? "API serveur absente, transcription navigateur seulement"
        : "API serveur absente, transcription indisponible";
      return;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Erreur transcription ${response.status}`);
    }

    appendFinalTranscript(payload.text || "");
    els.speechStatus.textContent = `Segment ${segmentNumber} transcrit`;
  } catch (error) {
    els.speechStatus.textContent = error.message || "Erreur de transcription serveur";
  } finally {
    state.pendingTranscriptions = Math.max(0, state.pendingTranscriptions - 1);
  }
}

function startRecording() {
  if (state.recording || !state.mediaRecorder) {
    return;
  }

  state.chunks = [];
  state.belowSince = null;
  state.recordingStartedAt = performance.now();
  state.speechCaptureUntil = Number.POSITIVE_INFINITY;
  state.recording = true;
  document.body.classList.add("is-recording");
  els.recordingState.textContent = "Enregistrement";

  state.mediaRecorder.start();
}

function stopRecording(reason = "silence") {
  if (!state.recording || !state.mediaRecorder) {
    return;
  }

  state.recording = false;
  document.body.classList.remove("is-recording");
  els.recordingState.textContent = reason === "manual" ? "Arrêt manuel" : "Segment terminé";
  state.belowSince = null;
  state.speechCaptureUntil = performance.now() + 1500;

  if (state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
  }
}

function addSegment(blob, startedAt, endedAt) {
  state.segmentIndex += 1;
  const url = URL.createObjectURL(blob);
  const duration = endedAt - startedAt;
  const created = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (state.segmentIndex === 1) {
    els.segmentsList.innerHTML = "";
  }

  const item = document.createElement("article");
  item.className = "segment";

  const meta = document.createElement("div");
  meta.className = "segment-meta";
  meta.innerHTML = `
    <strong>Segment ${state.segmentIndex}</strong>
    <span>${created} - ${formatDuration(duration)} - ${Math.round(blob.size / 1024)} Ko</span>
  `;

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = url;

  const download = document.createElement("a");
  download.href = url;
  download.download = `segment-${String(state.segmentIndex).padStart(3, "0")}.webm`;
  download.textContent = "Télécharger";

  const actions = document.createElement("div");
  actions.className = "segment-actions";
  actions.append(audio, download);

  item.append(meta, actions);
  els.segmentsList.prepend(item);
  els.segmentCount.textContent = `${state.segmentIndex} segment${state.segmentIndex > 1 ? "s" : ""}`;
  els.clearButton.disabled = false;
  return state.segmentIndex;
}

function setupRecorder() {
  const mimeType = pickMimeType();
  const options = mimeType ? { mimeType } : undefined;
  state.mediaRecorder = new MediaRecorder(state.micStream, options);

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = () => {
    const endedAt = performance.now();
    const duration = endedAt - state.recordingStartedAt;
    const minDuration = Number(els.minDurationInput.value);
    if (state.chunks.length && duration >= minDuration) {
      const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
      const segmentNumber = addSegment(blob, state.recordingStartedAt, endedAt);
      transcribeSegment(blob, segmentNumber);
    }
    state.chunks = [];
  };
}

function monitor() {
  if (!state.listening) {
    return;
  }

  const db = getRmsDb();
  const now = performance.now();
  const threshold = Number(els.thresholdInput.value);
  const silenceDelay = Number(els.silenceDelayInput.value);
  state.lastDb = db;

  els.levelLabel.textContent = db <= -99 ? "-∞ dB" : `${db.toFixed(1)} dB`;
  els.meterFill.style.width = `${dbToPercent(db)}%`;

  if (db >= threshold) {
    els.silenceState.textContent = "Au-dessus du seuil";
    if (!state.recording) {
      startRecording();
    }
    state.belowSince = null;
  } else if (state.recording) {
    if (state.belowSince === null) {
      state.belowSince = now;
    }
    const silenceMs = now - state.belowSince;
    els.silenceState.textContent = `Silence: ${Math.round(silenceMs)} ms`;
    if (silenceMs >= silenceDelay) {
      stopRecording();
    }
  } else {
    els.silenceState.textContent = "En attente du seuil";
  }

  state.rafId = requestAnimationFrame(monitor);
}

async function startListening() {
  if (state.listening) {
    return;
  }

  if (!window.isSecureContext) {
    setStatus("Page non sécurisée", "warn");
  }

  els.startButton.disabled = true;
  els.startButton.textContent = "Demande micro...";

  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(state.micStream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 2048;
    source.connect(state.analyser);

    setupRecorder();
    setupSpeechRecognition();

    state.listening = true;
    els.stopButton.disabled = false;
    els.startButton.textContent = "Écoute active";
    els.recordingState.textContent = "En attente";
    setStatus("Micro actif", "ok");
    startSpeechRecognition();
    monitor();
  } catch (error) {
    setStatus("Micro refusé ou indisponible", "warn");
    els.recordingState.textContent = error.message || "Erreur micro";
    els.startButton.disabled = false;
    els.startButton.textContent = "Démarrer l'écoute";
  }
}

function stopListening() {
  if (!state.listening) {
    return;
  }

  state.listening = false;
  cancelAnimationFrame(state.rafId);

  if (state.recording) {
    stopRecording("manual");
  }

  stopSpeechRecognition();

  if (state.audioContext) {
    state.audioContext.close();
  }

  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
  }

  state.audioContext = null;
  state.analyser = null;
  state.mediaRecorder = null;
  state.micStream = null;
  state.recognition = null;
  state.belowSince = null;

  els.startButton.disabled = false;
  els.startButton.textContent = "Démarrer l'écoute";
  els.stopButton.disabled = true;
  els.recordingState.textContent = "Arrêté";
  els.silenceState.textContent = "Silence: 0 ms";
  els.meterFill.style.width = "0%";
  els.levelLabel.textContent = "-∞ dB";
  els.speechStatus.textContent = state.speechSupported
    ? "Transcription en pause"
    : "Transcription indisponible dans ce navigateur";
  setStatus(window.isSecureContext ? "Prêt" : "HTTPS requis", window.isSecureContext ? "ok" : "warn");
}

function exportTranscript() {
  const text = els.transcriptOutput.value.trim();
  if (!text) {
    return;
  }

  const blob = new Blob([`${text}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `transcription-${stamp}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearAll() {
  state.finalTranscript = "";
  state.interimTranscript = "";
  state.segmentIndex = 0;
  els.transcriptOutput.value = "";
  els.segmentsList.innerHTML = '<p class="empty">Aucun segment enregistré.</p>';
  els.segmentCount.textContent = "0 segment";
  els.exportButton.disabled = true;
  els.clearButton.disabled = true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch(() => {
    // The app remains usable without offline installation.
  });
}

function init() {
  loadSettings();
  updateSettingLabels();
  setupSpeechRecognition();
  setStatus(window.isSecureContext ? "Prêt" : "HTTPS ou localhost requis", window.isSecureContext ? "ok" : "warn");

  if (!navigator.mediaDevices?.getUserMedia) {
    els.startButton.disabled = true;
    setStatus("Micro non supporté", "warn");
  }

  els.thresholdInput.addEventListener("input", updateSettingLabels);
  els.silenceDelayInput.addEventListener("input", updateSettingLabels);
  els.minDurationInput.addEventListener("input", updateSettingLabels);
  els.languageInput.addEventListener("change", updateSettingLabels);
  els.startButton.addEventListener("click", startListening);
  els.stopButton.addEventListener("click", stopListening);
  els.exportButton.addEventListener("click", exportTranscript);
  els.clearButton.addEventListener("click", clearAll);
  window.addEventListener("beforeunload", stopListening);
  registerServiceWorker();
}

init();
