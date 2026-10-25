'use strict';

// Microphone chord detection.
//
// Each frame: find peaks in the spectrum, then walk them from low to high. A peak that sits on a
// harmonic (2x, 3x, ...) of a note already found is treated as an overtone; anything else is
// a new note. Notes in a close chord voicing are never whole-number multiples of each other, so
// this separates real notes from the strong overtones of reed instruments like the accordion.
// A note must show up in several recent frames before it counts, which filters out flickers.

const MicInput = (() => {
  const FFT_SIZE = 16384;      // ~0.34s window at 48kHz: fine enough to split semitones near middle C
  const FRAME_MS = 40;
  const MIN_HZ = 75;           // lowest fundamental (F2, the accordion's 16' reed in its low range)
  const MAX_FUNDAMENTAL_HZ = 2200;
  const MAX_HZ = 6000;         // look this high for overtones
  const NOTE_TOLERANCE = 45;   // cents a peak may be off a semitone (musette reeds are detuned)
  const HARMONIC_TOLERANCE = 35;
  const HISTORY = 5;           // frames remembered per note
  const NEEDED = 3;            // ...of which this many must contain the note for it to sound
  const MAX_NOTES = 6;
  const MAX_HARMONIC = 32;      // low reeds have audible overtones far up the spectrum

  const settings = { gateDb: -70, rangeDb: 30 };

  let ctx = null, stream = null, analyser = null, timer = null;
  let spectrumDb = null, timeData = null;
  let history = [];
  let onChange = () => {}, onFrame = () => {}, onState = () => {};
  let lastNotes = '';

  const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  // mag: linear magnitudes per FFT bin. Returns detected MIDI notes (lowest first) and the peaks found.
  function detectNotes(mag, sampleRate, fftSize, opts = settings) {
    const binHz = sampleRate / fftSize;
    const lo = Math.max(2, Math.floor(MIN_HZ / binHz));
    const hi = Math.min(mag.length - 2, Math.ceil(MAX_HZ / binHz));

    let max = 0;
    for (let k = lo; k <= hi; k++) if (mag[k] > max) max = mag[k];
    const maxDb = 20 * Math.log10(max || 1e-12);
    if (maxDb < opts.gateDb) return { notes: [], peaks: [], maxDb };

    const floor = max * Math.pow(10, -opts.rangeDb / 20);
    const db = k => 20 * Math.log10(mag[k] || 1e-12);

    // Local maxima above the floor, with parabolic interpolation for a precise frequency.
    const peaks = [];
    for (let k = lo; k <= hi; k++) {
      const m = mag[k];
      if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
      const a = db(k - 1), b = db(k), c = db(k + 1);
      const denom = a - 2 * b + c;
      const p = denom ? 0.5 * (a - c) / denom : 0;
      peaks.push({ freq: (k + p) * binHz, amp: Math.pow(10, (b - 0.25 * (a - c) * p) / 20) });
    }

    const near = (f, target, cents) => Math.abs(1200 * Math.log2(f / target)) < cents;
    const hasPeakNear = (f, cents) => peaks.some(p => near(p.freq, f, cents));

    const found = [];
    for (const peak of peaks) {
      if (peak.freq > MAX_FUNDAMENTAL_HZ) break;
      const midiF = freqToMidi(peak.freq);
      const midi = Math.round(midiF);
      if (Math.abs(midiF - midi) * 100 > NOTE_TOLERANCE) continue;

      // Check against both the measured pitch and the in-tune pitch of each note found so far:
      // detuned musette reeds can blur the measured pitch enough to miss its upper overtones.
      const isOvertone = found.some(n => [n.freq, midiToFreq(n.midi)].some(f0 => {
        const h = Math.round(peak.freq / f0);
        return h >= 2 && h <= MAX_HARMONIC && near(peak.freq, f0 * h, HARMONIC_TOLERANCE);
      }));
      if (isOvertone) continue;

      // A real reed note has overtones; a lone peak is more likely noise. (Very high notes may
      // have their overtones above the range we look at, so they get a pass.)
      const supported = peak.freq * 2 > MAX_HZ ||
        hasPeakNear(peak.freq * 2, HARMONIC_TOLERANCE) || hasPeakNear(peak.freq * 3, HARMONIC_TOLERANCE);
      if (!supported) continue;

      const existing = found.find(n => n.midi === midi);
      if (!existing) found.push({ midi, freq: peak.freq, amp: peak.amp });
      else if (peak.amp > existing.amp) Object.assign(existing, { freq: peak.freq, amp: peak.amp });
    }

    const notes = found
      .sort((x, y) => y.amp - x.amp)
      .slice(0, MAX_NOTES)
      .map(n => n.midi)
      .sort((x, y) => x - y);
    return { notes, peaks, maxDb };
  }

  function tick() {
    analyser.getFloatFrequencyData(spectrumDb);
    const mag = new Float32Array(spectrumDb.length);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.pow(10, spectrumDb[i] / 20);
    const result = detectNotes(mag, ctx.sampleRate, FFT_SIZE);

    history.push(new Set(result.notes));
    if (history.length > HISTORY) history.shift();
    const counts = new Map();
    for (const frame of history) for (const n of frame) counts.set(n, (counts.get(n) || 0) + 1);
    const sounding = [...counts].filter(([, c]) => c >= NEEDED).map(([n]) => n).sort((a, b) => a - b);

    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (const v of timeData) sum += v * v;
    const levelDb = 10 * Math.log10(sum / timeData.length || 1e-12);

    const key = sounding.join(',');
    if (key !== lastNotes) {
      lastNotes = key;
      onChange(sounding);
    }
    onFrame({ spectrumDb, binHz: ctx.sampleRate / FFT_SIZE, peaks: result.peaks, raw: result.notes, sounding, levelDb });
  }

  async function start(handlers) {
    stop();
    onChange = handlers.onChange || onChange;
    onFrame = handlers.onFrame || onFrame;
    onState = handlers.onState || onState;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    ctx = new AudioContext();
    ctx.onstatechange = () => onState();
    // Browsers may hold audio until the user interacts with the page; resume on the first input.
    ctx.resume();
    if (ctx.state !== 'running') {
      const resume = () => { if (ctx) ctx.resume(); };
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    }
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    spectrumDb = new Float32Array(analyser.frequencyBinCount);
    timeData = new Float32Array(FFT_SIZE);
    history = [];
    lastNotes = '';
    timer = setInterval(tick, FRAME_MS);
    onState();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ctx) ctx.close();
    stream = ctx = analyser = null;
    onState();
    if (lastNotes) onChange([]);
    lastNotes = '';
  }

  const isRunning = () => !!timer && ctx.state === 'running';
  const isWaitingForClick = () => !!timer && ctx.state === 'suspended';

  return { start, stop, detectNotes, settings, isRunning, isWaitingForClick, MIN_HZ, MAX_HZ };
})();

if (typeof module !== 'undefined') module.exports = MicInput;
