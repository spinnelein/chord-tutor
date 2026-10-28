'use strict';

// ---------- Music theory ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL = { '-2': '♭♭', '-1': '♭', '0': '', '1': '♯', '2': '♯♯' };
const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Each root: letter index + accidental offset. Spellings pianists usually see.
const ROOTS = [
  { letter: 0, acc: 0 },  // C
  { letter: 1, acc: -1 }, // Db
  { letter: 1, acc: 0 },  // D
  { letter: 2, acc: -1 }, // Eb
  { letter: 2, acc: 0 },  // E
  { letter: 3, acc: 0 },  // F
  { letter: 3, acc: 1 },  // F#
  { letter: 4, acc: 0 },  // G
  { letter: 5, acc: -1 }, // Ab
  { letter: 5, acc: 0 },  // A
  { letter: 6, acc: -1 }, // Bb
  { letter: 6, acc: 0 },  // B
].map(r => {
  const pc = (LETTER_PC[r.letter] + r.acc + 12) % 12;
  return { ...r, pc, name: LETTERS[r.letter] + ACCIDENTAL[r.acc] };
});

// Chord tones are [semitones above root, letter steps above root] so notes spell correctly.
const R = [0, 0], M2 = [2, 1], m3 = [3, 2], M3 = [4, 2], P4 = [5, 3],
  d5 = [6, 4], P5 = [7, 4], A5 = [8, 4], d7 = [9, 6], m7 = [10, 6], M7 = [11, 6];

// Three ways to name a chord: written out (name), abbreviated (abbr), lead-sheet symbol (sym).
const CHORD_TYPES = [
  { id: 'maj',  name: 'Major',               abbr: 'maj',    sym: '',     tones: [R, M3, P5], on: true },
  { id: 'min',  name: 'minor',               abbr: 'min',    sym: 'm',    tones: [R, m3, P5], on: true },
  { id: 'dim',  name: 'diminished',          abbr: 'dim',    sym: '°',    tones: [R, m3, d5] },
  { id: 'aug',  name: 'augmented',           abbr: 'aug',    sym: '+',    tones: [R, M3, A5] },
  { id: 'sus2', name: 'suspended 2nd',       abbr: 'sus2',   sym: 'sus2', tones: [R, M2, P5] },
  { id: 'sus4', name: 'suspended 4th',       abbr: 'sus4',   sym: 'sus4', tones: [R, P4, P5] },
  { id: 'maj7', name: 'Major 7th',           abbr: 'maj7',   sym: 'maj7', tones: [R, M3, P5, M7] },
  { id: 'dom7', name: 'dominant 7th',        abbr: '7',      sym: '7',    tones: [R, M3, P5, m7] },
  { id: 'min7', name: 'minor 7th',           abbr: 'min7',   sym: 'm7',   tones: [R, m3, P5, m7] },
  { id: 'hdim', name: 'half-diminished 7th', abbr: 'min7♭5', sym: 'ø7',   tones: [R, m3, d5, m7] },
  { id: 'dim7', name: 'diminished 7th',      abbr: 'dim7',   sym: '°7',   tones: [R, m3, d5, d7] },
];

const NAME_STYLES = [
  { id: 'words',  label: 'Written out' },  // C Major
  { id: 'abbr',   label: 'Abbreviated' },  // Cmaj
  { id: 'sym',    label: 'Symbols' },      // C
  { id: 'hidden', label: 'Hidden' },       // staff only; the name is revealed once you play it
];

const INVERSION_NAMES = ['Root position', '1st inversion', '2nd inversion', '3rd inversion'];

function spell(root, [semis, steps]) {
  const letter = (root.letter + steps) % 7;
  let acc = ((root.pc + semis - LETTER_PC[letter]) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;
  return { letter, acc, name: LETTERS[letter] + ACCIDENTAL[acc] };
}

// inversion: 0 = root position, 1 = 3rd in the bass, ... ; null = any inversion accepted
function buildChord(root, type, inversion) {
  const spelled = type.tones.map(t => spell(root, t));
  return {
    root,
    type,
    inversion,
    symbol: root.name + type.abbr,
    longName: `${root.name} ${type.name}`,
    pcs: type.tones.map(([s]) => (root.pc + s) % 12),
    names: spelled.map(n => n.name),
    spelled,
  };
}

// A concrete close voicing near middle C, lowest note first. Used for hints and the staff.
function voicing(chord) {
  const inv = chord.inversion ?? 0;
  const notes = chord.type.tones.map(([semis], i) => ({
    midi: HINT_BASE + chord.root.pc + semis + (i < inv ? 12 : 0),
    ...chord.spelled[i],
  }));
  notes.sort((a, b) => a.midi - b.midi);
  const shift = 12 * Math.floor((notes[0].midi - HINT_BASE) / 12);
  for (const n of notes) n.midi -= shift;
  return notes;
}

// Right-hand fingering for a chord (MIDI notes, lowest first): thumb on the bottom, 5 on top, and
// the fingers between chosen by the gaps, as the Alfred "Complete Book of Scales, Chords, Arpeggios
// & Cadences" fingers its triads and cadences: 1-3-5 in root position and 2nd inversion; 1-2-5 when
// the top gap is a 4th (1st inversion) or the bottom two are a step apart; 1-4-5 when the top two
// are a step apart (sus4, the cadence V7 B-F-G). Four-note chords take 1-2-3-5, or 1-2-4-5 with a
// step at the top. Returns [] for more notes than one hand plays.
function rhFingering(midis) {
  const n = midis.length;
  if (n < 3) return n === 2 ? [1, 5] : [1];
  const top = midis[n - 1] - midis[n - 2];
  if (n === 3) {
    const low = midis[1] - midis[0];
    return [1, top <= 2 ? 4 : low <= 2 || (top >= 5 && top > low) ? 2 : 3, 5];
  }
  if (n === 4) return top <= 2 ? [1, 2, 4, 5] : [1, 2, 3, 5];
  return n === 5 ? [1, 2, 3, 4, 5] : [];
}

// What the Notes button says: off, on, or on with fingering.
const notesState = s => !s.showNotes ? 'off' : s.fingering ? 'on + fingers' : 'on';

// Note names for a voicing ({ midi, name } objects), each followed by its right-hand finger.
function notesLabel(notes, fingering) {
  const span = document.createElement('span');
  const fingers = fingering ? rhFingering(notes.map(n => n.midi)) : [];
  notes.forEach((n, i) => {
    if (i) span.append(' – ');
    span.append(n.name);
    if (fingers[i]) {
      const f = document.createElement('span');
      f.className = 'finger';
      f.title = 'Right-hand finger';
      f.textContent = fingers[i];
      span.append(f);
    }
  });
  return span;
}

// ---------- State ----------

// Keyboard range by screen width: 61 keys (C2–C7) on wide screens; fewer, bigger keys on tablets
// (C3–C6) and phones (F3–C6). The chords the app lights up sit around middle C, so they always fit.
const pianoRange = () => (innerWidth >= 900 ? [36, 96] : innerWidth >= 600 ? [48, 84] : [53, 84]);
const HINT_BASE = 60;  // hints are drawn starting from the octave of middle C
// A wrong chord must last this long to count as a miss. With MIDI this skips the instant while
// keys of one chord are still landing; the mic needs longer so a stray detection doesn't count.
const MIDI_MISS_MS = 150;
const MIC_MISS_MS = 500;
const FEEDBACK_HOLD_MS = 2500; // how long a "Not quite" message stays after the chord stops
const NOT_QUITE_DELAY_MS = 250; // the same wrong notes must sound this long before "Not quite" shows

const state = {
  held: new Set(),
  clicked: new Set(),  // notes toggled on with the mouse; cleared when the next chord appears
  chord: null,
  hintShown: false,     // notes were visible at some point for this chord (it won't count for streaks)
  awaitRelease: false, // after a success, wait for all keys up before judging the next chord
  celebrating: false,  // "Correct!" is up: the next chord comes once the chord is let go
  celebrateReady: false, // ...and the pop-up has been up long enough to see
  wrongSince: null,    // when the current wrong chord (right number of notes, wrong ones) started
  wrongMs: -1,         // longest unbroken wrong chord this attempt; -1 = none
  judgedKey: null,     // the held notes (as a key) currently shown as wrong, once they've lasted
  shownAt: 0,
  recent: [],          // progress keys of the last few chords asked, newest last
  session: null,       // timed session in progress: { start, minutes, endsAt }
  settings: {
    types: CHORD_TYPES.filter(t => t.on).map(t => t.id),
    roots: ROOTS.map(r => r.pc),
    invMode: 'any',        // 'any' or 'specific'
    inversions: [0, 1, 2], // which inversions to ask for in 'specific' mode
    showNotes: false,
    showStaff: true,
    nameStyle: 'abbr',
    input: 'mic',          // 'mic', 'midi:all' or 'midi:<device id>'
    slash: false,          // show inversions as slash chords, e.g. Fm/A♭
    fingering: false,      // show right-hand fingering with the note names
    order: 'smart',        // 'smart' (focus on weak and slow chords) or 'random'
    goal: 3,               // seconds: a chord is mastered when you play it this fast
    sessionMinutes: 10,
  },
};

const $ = id => document.getElementById(id);

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('chordTutorSettings'));
    if (saved) {
      if (saved.rootPos) Object.assign(saved, { invMode: 'specific', inversions: [0] });
      delete saved.rootPos;
      if ('alwaysHint' in saved) saved.showNotes = saved.alwaysHint;
      delete saved.alwaysHint;
      Object.assign(state.settings, saved);
    }
  } catch { /* storage unavailable; use defaults */ }
}

function saveSettings() {
  try { localStorage.setItem('chordTutorSettings', JSON.stringify(state.settings)); } catch { }
}

// ---------- Chord flow ----------

function nextChord() {
  const { settings } = state;
  state.celebrating = false;
  hideCorrect();
  const options = [];
  for (const root of ROOTS.filter(r => settings.roots.includes(r.pc))) {
    for (const type of CHORD_TYPES.filter(t => settings.types.includes(t.id))) {
      const invs = settings.invMode === 'any'
        ? [null]
        : settings.inversions.filter(i => i < type.tones.length);
      for (const inv of invs) options.push([root, type, inv]);
    }
  }

  if (!options.length) {
    state.chord = null;
    $('chord-name').textContent = '—';
    $('chord-inv').textContent = '';
    $('chord-sub').textContent = settings.invMode === 'specific' && settings.inversions.length
      ? '3rd inversion needs a 7th chord type: pick one below'
      : 'Pick at least one chord type, root and inversion below';
    renderStaff();
    renderPiano();
    return;
  }

  const chords = options.map(o => buildChord(...o));
  let chord;
  if (settings.order === 'smart') {
    chord = Progress.pick(chords, state.recent, settings.goal);
  } else {
    const last = state.recent[state.recent.length - 1];
    do {
      chord = chords[Math.floor(Math.random() * chords.length)];
    } while (Progress.keyFor(chord) === last && chords.length > 1);
  }
  state.recent = [...state.recent, Progress.keyFor(chord)].slice(-3);
  const isNew = settings.order === 'smart' && Progress.statsFor(chord, settings.goal).tries === 0;
  $('chord-badge').hidden = !isNew;

  for (const n of state.clicked) state.held.delete(n);
  state.clicked.clear();

  state.chord = chord;
  cancelNotQuite();
  state.hintShown = state.settings.showNotes;
  resetAttempt();
  state.awaitRelease = state.held.size > 0;
  state.shownAt = performance.now();

  $('chord-name').classList.remove('good');
  $('chord-inv').textContent = chord.inversion === null ? '' : INVERSION_NAMES[chord.inversion];
  setFeedback('');
  renderPrompt();
  renderStaff();
  renderPiano();
}

function evaluate() {
  if (PlayAlong.active()) return PlayAlong.evaluate();
  const chord = state.chord;
  if (!chord) return;
  if (state.celebrating) return advanceIfReleased();

  if (state.awaitRelease) {
    if (state.held.size === 0) {
      state.awaitRelease = false;
      state.shownAt = performance.now();
      setFeedback('');
    }
    return;
  }

  const notes = [...state.held].sort((a, b) => a - b);
  const pcs = new Set(notes.map(n => n % 12));
  const key = notes.join(',');
  if (key !== state.judgedKey) state.judgedKey = null;

  if (notes.length === 0) {
    cancelNotQuite();
    // Released everything: if they held a wrong chord and never got it right, that's a miss.
    trackWrong(false);
    const minMs = inputChoice() === 'mic' ? MIC_MISS_MS : MIDI_MISS_MS;
    if (state.wrongMs >= minMs) {
      Progress.record(chord, { ok: false });
      renderProgress();
    }
    resetAttempt();
    fadeFeedback();
    return;
  }

  const rightNotes = pcs.size === chord.pcs.length && chord.pcs.every(pc => pcs.has(pc));
  const bassOk = chord.inversion === null || notes[0] % 12 === chord.pcs[chord.inversion];
  // Only a wrong chord with the right number of notes counts towards a miss.
  trackWrong(pcs.size === chord.pcs.length && !(rightNotes && bassOk));

  if (rightNotes && bassOk) {
    cancelNotQuite();
    succeed();
  } else if (rightNotes) {
    const want = INVERSION_NAMES[chord.inversion].toLowerCase();
    const got = INVERSION_NAMES[chord.pcs.indexOf(notes[0] % 12)].toLowerCase();
    notQuite(key, `Right notes, wrong inversion — you're playing ${got}; ${want} has ${chord.names[chord.inversion]} at the bottom`);
  } else if (pcs.size >= chord.pcs.length) {
    const other = identifyChord(notes);
    if (other) {
      const label = chordLabel(other, labelStyle());
      const inv = other.inversion > 0 && !label.includes('/')
        ? ` (${INVERSION_NAMES[other.inversion].toLowerCase()})` : '';
      const played = [...new Set(notes.map(n => n % 12))].map(pc => other.names[other.pcs.indexOf(pc)]);
      notQuite(key, `Not quite — that's ${label}${inv}: ${played.join(' ')}`);
    } else {
      const played = [...pcs].map(nameForPc).join(' ');
      notQuite(key, `Not quite — you're holding ${played}`);
    }
  } else {
    cancelNotQuite();
    fadeFeedback();
  }
}

// Show a "not quite" message only once the same notes have sounded for a moment, so brief
// background noise picked up by the mic doesn't flash a wrong answer.
let notQuiteTimer = null;

function notQuite(key, text) {
  if (state.judgedKey === key) return setFeedback(text, 'bad');
  clearTimeout(notQuiteTimer);
  notQuiteTimer = setTimeout(() => {
    const now = [...state.held].sort((a, b) => a - b).join(',');
    if (now !== key || state.celebrating || state.awaitRelease) return;
    state.judgedKey = key;
    setFeedback(text, 'bad');
    renderPiano();
  }, NOT_QUITE_DELAY_MS);
}

function cancelNotQuite() {
  clearTimeout(notQuiteTimer);
  notQuiteTimer = null;
}

// Name the chord formed by these MIDI notes (lowest first), or null if they don't form one.
// Some note sets have several names (Csus2 = Gsus4; a dim7 has four); prefer the one whose root
// is the lowest note, as that's how it would usually be read.
function identifyChord(notes) {
  const pcs = new Set(notes.map(n => n % 12));
  const bass = notes[0] % 12;
  let best = null;
  for (const root of ROOTS) {
    for (const type of CHORD_TYPES) {
      if (type.tones.length !== pcs.size) continue;
      const c = buildChord(root, type, null);
      if (!c.pcs.every(pc => pcs.has(pc))) continue;
      c.inversion = c.pcs.indexOf(bass);
      if (!best || (c.inversion === 0 && best.inversion !== 0)) best = c;
    }
  }
  return best;
}

function trackWrong(isWrong) {
  const now = performance.now();
  if (isWrong && state.wrongSince === null) state.wrongSince = now;
  if (!isWrong && state.wrongSince !== null) {
    state.wrongMs = Math.max(state.wrongMs, now - state.wrongSince);
    state.wrongSince = null;
  }
}

function resetAttempt() {
  state.wrongSince = null;
  state.wrongMs = -1;
}

// After a correct chord: a "Correct!" pop-up, then the next chord once the chord has been let go
// (and the pop-up has been up for a moment). Notes clicked on screen don't need letting go.
const CELEBRATE_MS = 700;
const LET_GO_HINT_MS = 1500;
let celebrateTimers = [];

const stillHolding = () => [...state.held].some(n => !state.clicked.has(n));

function succeed() {
  const secs = (performance.now() - state.shownAt) / 1000;
  Progress.record(state.chord, { ok: true, time: secs, hint: state.hintShown });
  renderProgress();
  const timeText = secs > 30 ? "time not counted — you'd been away a while" : `${secs.toFixed(1)}s`;
  setFeedback('');
  showCorrect(state.hintShown ? `with hint · ${timeText}` : timeText);
  state.celebrating = true;
  state.celebrateReady = false;
  resetAttempt();
  $('chord-name').classList.add('good');
  renderPrompt(); // reveals the name when names are hidden
  celebrateTimers = [
    setTimeout(() => { state.celebrateReady = true; advanceIfReleased(); }, CELEBRATE_MS),
    setTimeout(() => { $('correct-letgo').hidden = false; }, LET_GO_HINT_MS),
  ];
}

function advanceIfReleased() {
  if (state.celebrating && state.celebrateReady && !stillHolding()) nextChord();
}

function showCorrect(detail) {
  $('correct-detail').textContent = detail;
  $('correct-letgo').hidden = true;
  const pop = $('correct-pop');
  pop.classList.remove('show');
  void pop.offsetWidth; // restart the animation
  pop.classList.add('show');
}

function hideCorrect() {
  celebrateTimers.forEach(clearTimeout);
  celebrateTimers = [];
  $('correct-pop').classList.remove('show');
}

function skip() {
  if (state.celebrating) return nextChord(); // Space moves on without letting go
  if (!state.chord) return;
  Progress.record(state.chord, { ok: false, skip: true });
  renderProgress();
  nextChord();
}

// Notes off → on → on with right-hand fingering → off.
function toggleNotes() {
  const s = state.settings;
  if (s.showNotes && !s.fingering) s.fingering = true;
  else [s.showNotes, s.fingering] = [!s.showNotes, false];
  if (state.settings.showNotes) state.hintShown = true;
  saveSettings();
  renderPrompt();
  renderPiano();
}

function nameForPc(pc) {
  const chord = state.chord;
  const i = chord ? chord.pcs.indexOf(pc) : -1;
  return i >= 0 ? chord.names[i] : PC_NAMES[pc];
}

// ---------- Rendering ----------

let feedbackTimer = null;

function setFeedback(text, kind) {
  clearTimeout(feedbackTimer);
  feedbackTimer = null;
  const el = $('feedback');
  el.textContent = text;
  el.className = 'feedback' + (kind ? ' ' + kind : '');
}

// The style used wherever a name must be written, even when names are hidden on the prompt.
const labelStyle = () => state.settings.nameStyle === 'hidden' ? 'abbr' : state.settings.nameStyle;

function chordLabel(c, style) {
  if (style === 'words') return c.longName;
  const slash = state.settings.slash && c.inversion > 0 ? '/' + c.names[c.inversion] : '';
  return c.root.name + c.type[style] + slash;
}

// Clear the feedback, but leave a "Not quite" message up long enough to read.
function fadeFeedback() {
  if (!$('feedback').classList.contains('bad')) return setFeedback('');
  if (!feedbackTimer) feedbackTimer = setTimeout(() => setFeedback(''), FEEDBACK_HOLD_MS);
}

function renderPrompt() {
  const style = state.settings.nameStyle;
  const btn = $('btn-names');
  btn.textContent = 'Names: ' + NAME_STYLES.find(s => s.id === style).label;
  const notesBtn = $('btn-hint');
  notesBtn.textContent = `Notes: ${notesState(state.settings)} (Enter)`;
  notesBtn.setAttribute('aria-pressed', state.settings.showNotes);

  const c = state.chord;
  if (!c) return;
  // With names hidden you read the chord from the staff; the name appears once it's played.
  const conceal = style === 'hidden' && !state.celebrating;
  const name = $('chord-name');
  name.textContent = chordLabel(c, labelStyle());
  name.classList.toggle('words', labelStyle() === 'words');
  name.hidden = conceal;
  $('chord-inv').hidden = conceal;

  // The line underneath shows the chord in the other form, so you learn both.
  const sub = $('chord-sub');
  if (conceal) {
    sub.textContent = '';
  } else {
    sub.textContent = style === 'words' ? chordLabel(c, 'abbr') : c.longName;
    if (c.inversion !== null) sub.append(', ' + INVERSION_NAMES[c.inversion].toLowerCase());
  }
  if (state.settings.showNotes) {
    if (!conceal) sub.append(' — ');
    const span = notesLabel(voicing(c), state.settings.fingering);
    span.className = 'notes';
    sub.append(span);
  }
}

function renderHeld() {
  const names = [...state.held].sort((a, b) => a - b).map(n => nameForPc(n % 12) + (Math.floor(n / 12) - 1));
  $('held').textContent = 'Held: ' + (names.length ? names.join('  ') : '—');
}

const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
const keyEls = new Map();

let builtRange = '';

function buildPiano() {
  const piano = $('piano');
  const [low, high] = pianoRange();
  builtRange = `${low}-${high}`;
  piano.innerHTML = '';
  keyEls.clear();
  const whites = [];
  for (let n = low; n <= high; n++) if (!isBlack(n)) whites.push(n);
  const w = 100 / whites.length;

  for (let n = low; n <= high; n++) {
    const el = document.createElement('div');
    el.className = 'key ' + (isBlack(n) ? 'black' : 'white');
    if (isBlack(n)) {
      const nextWhite = whites.indexOf(n + 1);
      el.style.left = `calc(${nextWhite * w}% - ${w * 0.3}%)`;
      el.style.width = `${w * 0.6}%`;
    } else {
      el.style.left = `${whites.indexOf(n) * w}%`;
      el.style.width = `${w}%`;
      if (n % 12 === 0) {
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = 'C' + (n / 12 - 1);
        el.append(label);
      }
    }
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      if (state.held.has(n)) {
        state.clicked.delete(n);
        noteOff(n);
      } else {
        state.clicked.add(n);
        noteOn(n);
      }
    });
    piano.append(el);
    keyEls.set(n, el);
  }
}

// Rebuild with a different range when the screen is resized or rotated.
addEventListener('resize', () => {
  if (pianoRange().join('-') === builtRange) return;
  buildPiano();
  renderPiano();
});

function hintNotes() {
  if (PlayAlong.active()) return PlayAlong.hintNotes();
  const c = state.chord;
  if (!c || !state.settings.showNotes) return new Set();
  return new Set(voicing(c).map(n => n.midi));
}

const VF_ACCIDENTAL = { '-2': 'bb', '-1': 'b', '1': '#', '2': '##' };

function renderStaff() {
  const el = $('staff');
  const forced = state.settings.nameStyle === 'hidden';
  const show = state.settings.showStaff || forced;
  el.hidden = !show;
  const btn = $('btn-staff');
  btn.textContent = 'Staff: ' + (show ? 'on' : 'off');
  btn.setAttribute('aria-pressed', show);
  btn.disabled = forced;
  btn.title = forced ? 'The staff is always shown while names are hidden' : '';
  if (el.hidden) return;

  el.innerHTML = '';
  if (!window.Vex) {
    el.innerHTML = '<span class="err">Staff library failed to load (lib/vexflow.js)</span>';
    return;
  }
  const { Renderer, Stave, StaveNote, Accidental, Formatter } = Vex.Flow;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(190, 150);
  const ctx = renderer.getContext();
  const stave = new Stave(8, 20, 175).addClef('treble');
  stave.setContext(ctx).draw();
  if (!state.chord) return;

  const notes = voicing(state.chord);
  const keys = notes.map(n => {
    // Octave comes from the written letter, so C-flat/B-sharp land on the right line.
    const octave = Math.floor((n.midi - n.acc) / 12) - 1;
    return `${LETTERS[n.letter].toLowerCase()}/${octave}`;
  });
  const note = new StaveNote({ keys, duration: 'w', align_center: true });
  notes.forEach((n, i) => {
    if (n.acc) note.addModifier(new Accidental(VF_ACCIDENTAL[n.acc]), i);
  });
  Formatter.FormatAndDraw(ctx, stave, [note]);
}

// The keys to light for the notes held. A phone shows fewer octaves than the mic hears, so notes
// played out of view move by whole octaves into view, keeping their spacing, to where the hints
// are (or would be: the octave from middle C up), so they line up with the yellow keys. A chord
// too wide to fit has each note folded in separately. The "Held" line still shows the real octaves.
function shownNotes(notes, hints) {
  if (!notes.length) return new Set();
  const [low, high] = builtRange.split('-').map(Number);
  const lo = Math.min(...notes), hi = Math.max(...notes);
  if (lo >= low && hi <= high) return new Set(notes);
  const up = Math.ceil((low - lo) / 12), down = Math.floor((high - hi) / 12);
  if (up <= down) {
    const target = hints.size ? Math.min(...hints) : HINT_BASE + ((lo % 12) + 12) % 12;
    const best = Math.round((target - lo) / 12);
    return new Set(notes.map(n => n + 12 * Math.max(up, Math.min(down, best))));
  }
  return new Set(notes.map(n => {
    while (n < low) n += 12;
    while (n > high) n -= 12;
    return n;
  }));
}

function renderPiano() {
  const chord = state.chord;
  const success = state.celebrating;
  const hints = hintNotes();
  const heldKey = [...state.held].sort((a, b) => a - b).join(',');
  const judging = chord && !success && !state.awaitRelease && heldKey === state.judgedKey && !PlayAlong.active();
  const shown = shownNotes([...state.held], hints);

  for (const [n, el] of keyEls) {
    const down = shown.has(n);
    el.classList.toggle('down', down);
    el.classList.toggle('hint', hints.has(n));
    el.classList.toggle('good', down && success);
    el.classList.toggle('bad', down && !success && judging && !chord.pcs.includes(n % 12));
  }
  renderHeld();
}

// ---------- Input ----------

function noteOn(n) {
  state.held.add(n);
  evaluate();
  renderPiano();
}

function noteOff(n) {
  state.held.delete(n);
  evaluate();
  renderPiano();
}

function allNotesOff() {
  state.held.clear();
  state.clicked.clear();
  evaluate();
  renderPiano();
}

// Input sources: MIDI devices or the microphone
let midiAccess = null;
let midiRequest = null;  // pending permission request; MIDI is only asked for once it's selected
let midiError = '';
let micError = '';
let activeInput = null;

const inputChoice = () => $('input-select').value;

function onMidiMessage(e) {
  const [status, d1, d2] = e.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) noteOn(d1);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
  else if (cmd === 0xb0 && (d1 === 123 || d1 === 120)) allNotesOff();
}

function refreshInputs() {
  const select = $('input-select');
  const wanted = state.settings.input;
  const inputs = midiAccess ? [...midiAccess.inputs.values()] : [];

  select.innerHTML = '';
  select.append(new Option('Microphone', 'mic'));
  select.append(new Option(midiAccess ? 'MIDI: all inputs' : 'MIDI keyboard', 'midi:all'));
  for (const input of inputs) select.append(new Option('MIDI: ' + input.name, 'midi:' + input.id));
  // A saved MIDI device that isn't listed (yet, or unplugged) falls back to all MIDI inputs.
  select.value = [...select.options].some(o => o.value === wanted) ? wanted
    : wanted.startsWith('midi:') ? 'midi:all' : 'mic';

  if (select.value !== activeInput) selectInput();
  else attachMidi();
  renderInputStatus();
}

function attachMidi() {
  if (!midiAccess) return;
  const chosen = inputChoice();
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = (chosen === 'midi:all' || chosen === 'midi:' + input.id) ? onMidiMessage : null;
  }
}

function renderInputStatus() {
  const status = $('midi-status');
  let text, ok;
  if (inputChoice() === 'mic') {
    ok = MicInput.isRunning();
    text = ok ? 'Mic: listening'
      : micError || (MicInput.isWaitingForClick() ? 'Mic: click anywhere to start' : 'Mic: starting…');
  } else if (midiError) {
    ok = false;
    text = midiError;
  } else if (!midiAccess) {
    ok = false;
    text = 'MIDI: waiting for permission';
  } else {
    const count = midiAccess ? midiAccess.inputs.size : 0;
    ok = count > 0;
    text = ok ? `MIDI: ${count} input${count > 1 ? 's' : ''}` : 'MIDI: no devices found';
  }
  status.textContent = text;
  status.className = 'status ' + (ok ? 'on' : 'off');
}

async function selectInput() {
  activeInput = inputChoice();
  allNotesOff();
  attachMidi();
  const mic = inputChoice() === 'mic';
  $('mic-panel').hidden = !mic;
  micError = '';
  renderInputStatus();
  if (mic) {
    try {
      await MicInput.start({ onChange: setHeldFromMic, onFrame: drawMic, onState: renderInputStatus });
      if (!state.settings.micCalibrated || !state.settings.micNoise?.step) startCalibration(); // step: quarter-semitone profile
    } catch (err) {
      micError = err.name === 'NotAllowedError' ? 'Mic: permission denied' : 'Mic: not available';
    }
  } else {
    MicInput.stop();
    await ensureMidi();
  }
  renderInputStatus();
}

function setHeldFromMic(notes) {
  state.held.clear();
  for (const n of notes) state.held.add(n);
  evaluate();
  renderPiano();
}

// Ask for MIDI access the first time a MIDI input is chosen, then list the devices.
function ensureMidi() {
  if (midiAccess || midiError) return Promise.resolve();
  if (!navigator.requestMIDIAccess) {
    midiError = 'MIDI: not supported (use Chrome or Edge)';
    return Promise.resolve();
  }
  midiRequest ??= navigator.requestMIDIAccess()
    .then(access => {
      midiAccess = access;
      midiAccess.onstatechange = refreshInputs;
    })
    .catch(() => { midiError = 'MIDI: permission denied'; })
    .then(refreshInputs);
  return midiRequest;
}

// Mic panel: level meter, tuning sliders, and an optional view of the spectrum with detected notes.
function buildMicPanel() {
  const { settings } = state;
  // Slider positions as words; the underlying dB values mean little to most people.
  const level = input => ['very low', 'low', 'medium', 'high', 'very high'][
    Math.min(4, Math.floor((input.value - input.min) / (input.max - input.min) * 5))];
  const sliders = [
    ['mic-gate', 'micGate', 'gateDb', level],
    ['mic-range', 'micRange', 'rangeDb', level],
  ];
  for (const [id, key, micKey, fmt] of sliders) {
    const input = $(id);
    const show = () => { $(id + '-val').textContent = fmt(input); };
    input.value = settings[key] ?? MicInput.settings[micKey];
    MicInput.settings[micKey] = Number(input.value);
    show();
    input.addEventListener('input', () => {
      settings[key] = MicInput.settings[micKey] = Number(input.value);
      show();
      saveSettings();
    });
  }
  MicInput.settings.noiseProfile = settings.micNoise ?? null; // the room measured last time
  $('mic-show').addEventListener('change', e => { $('mic-canvas').hidden = !e.target.checked; });
  $('mic-calibrate').addEventListener('click', e => { if (MicInput.isRunning()) startCalibration(); e.currentTarget.blur(); });
}

// ---------- Measuring room noise ----------
//
// The first time the mic starts, listen for 2 seconds of quiet and set the background noise filter
// just above the loudest room noise heard (90th percentile of each moment's loudest peak, plus a
// 6 dB margin). Notes are ignored while measuring. "Measure room noise" runs it again.

const CALIBRATE_MS = 2000;
let calibration = null;

function startCalibration() {
  calibration = { samples: [], spectra: [], until: performance.now() + CALIBRATE_MS, gate: MicInput.settings.gateDb };
  MicInput.settings.gateDb = 0; // hear nothing as notes while measuring
  setHeldFromMic([]);
  $('mic-calibrate').disabled = true;
  $('mic-calib-status').textContent = 'Measuring background noise — please stay quiet for 2 seconds…';
}

function calibrationFrame(frame) {
  if (!calibration) return;
  if (Number.isFinite(frame.maxDb)) calibration.samples.push(frame.maxDb);
  if (frame.spectrumDb) calibration.spectra.push(frame.spectrumDb.slice());
  if (performance.now() < calibration.until) return;
  const samples = calibration.samples.sort((a, b) => a - b);
  const calibration_spectra = calibration.spectra;
  calibration = null;
  $('mic-calibrate').disabled = false;
  if (samples.length < 10) {
    MicInput.settings.gateDb = state.settings.micGate ?? -70;
    $('mic-calib-status').textContent = "Couldn't measure the room — set the filter by hand or try again.";
    return;
  }
  const noise = samples[Math.floor(samples.length * 0.9)];
  const gate = Math.round(Math.min(-40, Math.max(-95, noise + 6)));
  const slider = $('mic-gate');
  slider.value = gate;
  slider.dispatchEvent(new Event('input')); // updates the label, the mic and the saved setting
  // The room's noise at each pitch: notes are judged against the noise at their own pitch, so low
  // hum doesn't hide quiet high notes.
  const profile = { ...MicInput.noiseProfile(calibration_spectra, frame.binHz), gate };
  MicInput.settings.noiseProfile = profile;
  state.settings.micNoise = profile;
  state.settings.micCalibrated = true;
  saveSettings();
  $('mic-calib-status').textContent = gate >= -40
    ? 'Set automatically, but the room was loud. If your playing is missed, measure again in a quieter moment.'
    : `Set automatically to ${$('mic-gate-val').textContent} for this room.`;
}


const noteLabel = n => PC_NAMES[n % 12] + (Math.floor(n / 12) - 1);

function drawMic(frame) {
  calibrationFrame(frame);
  const level = Math.min(100, Math.max(0, (frame.levelDb + 60) / 60 * 100));
  $('mic-level').style.width = level + '%';

  const canvas = $('mic-canvas');
  if (canvas.hidden) return;
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const LO = MicInput.MIN_HZ, HI = MicInput.MAX_HZ, TOP = -10, BOTTOM = -110;
  const x = f => Math.log(f / LO) / Math.log(HI / LO) * W;
  const y = db => (TOP - db) / (TOP - BOTTOM) * H;

  g.fillStyle = '#101216';
  g.fillRect(0, 0, W, H);

  // Octave grid at each C.
  g.font = '11px system-ui';
  for (let m = 36; m <= 108; m += 12) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    if (f < LO || f > HI) continue;
    g.fillStyle = '#2d313b';
    g.fillRect(x(f), 0, 1, H);
    g.fillStyle = '#8b909c';
    g.fillText(noteLabel(m), x(f) + 3, H - 4);
  }

  // Noise filter: a note's peak must rise above this line at its own pitch to count.
  g.strokeStyle = 'rgba(255, 93, 93, .7)';
  g.beginPath();
  for (let px = 0; px <= W; px += 2) {
    const py = y(MicInput.thresholdDb(LO * Math.pow(HI / LO, px / W)));
    px ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();

  // Spectrum.
  g.strokeStyle = '#6aa8ff';
  g.beginPath();
  const { spectrumDb, binHz } = frame;
  for (let k = Math.floor(LO / binHz); k * binHz <= HI; k++) {
    const px = x(k * binHz), py = y(spectrumDb[k]);
    k === Math.floor(LO / binHz) ? g.moveTo(px, py) : g.lineTo(px, py);
  }
  g.stroke();

  // Detected notes.
  g.fillStyle = '#3ccf7a';
  for (const n of frame.sounding) {
    const px = x(440 * Math.pow(2, (n - 69) / 12));
    g.fillRect(px - 1, 0, 2, H);
    g.fillText(noteLabel(n), px + 4, 14);
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!$('report').hidden) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); closeReport(); }
    return;
  }
  if (PlayAlong.key(e)) return;
  if (e.key === ' ') { e.preventDefault(); skip(); return; }
  if (e.key === 'Enter') { e.preventDefault(); toggleNotes(); return; }
  if (e.key.toLowerCase() === 'n') cycleNameStyle();
});

// ---------- Progress view ----------

const INVERSION_LABELS = { any: 'Any inversion', 0: 'Root position', 1: '1st inversion', 2: '2nd inversion', 3: '3rd inversion' };

function ago(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

const fmtTime = t => t === null ? '–' : t.toFixed(1) + 's';
const pct = x => Math.round(x * 100) + '%';

function groupLabel(root, type) {
  return chordLabel(buildChord(root, type, null), labelStyle());
}

function renderProgress() {
  const { settings } = state;
  const goal = settings.goal;
  const types = CHORD_TYPES.filter(t => settings.types.includes(t.id) ||
    ROOTS.some(r => Progress.statsForGroup(r.pc, t.id, goal).total));

  // Grid: one row per chord type, one column per root.
  const grid = $('progress-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `minmax(110px, auto) repeat(${ROOTS.length}, minmax(34px, 1fr))`;
  grid.append(document.createElement('div'));
  for (const r of ROOTS) {
    const h = document.createElement('div');
    h.className = 'col-head';
    h.textContent = r.name;
    grid.append(h);
  }

  const rows = [];
  for (const type of types) {
    const label = document.createElement('div');
    label.className = 'row-head';
    label.textContent = type.name;
    grid.append(label);
    for (const root of ROOTS) {
      const s = Progress.statsForGroup(root.pc, type.id, goal);
      const inSelection = settings.types.includes(type.id) && settings.roots.includes(root.pc);
      const cell = document.createElement('div');
      cell.className = `cell lvl-${s.level}` + (inSelection ? '' : ' off');
      cell.textContent = s.tries ? fmtTime(s.time) : '';
      cell.tabIndex = 0;
      cell.dataset.tip = tipText(root, type, s, inSelection);
      grid.append(cell);
      if (s.tries) rows.push({ root, type, s, inSelection });
    }
  }

  // Summary line.
  const inSel = [];
  for (const t of CHORD_TYPES.filter(t => settings.types.includes(t.id))) {
    for (const r of ROOTS.filter(r => settings.roots.includes(r.pc))) inSel.push(Progress.statsForGroup(r.pc, t.id, goal));
  }
  const practiced = inSel.filter(s => s.tries).length;
  const mastered = inSel.filter(s => s.level === 4).length;
  const o = Progress.overview();
  let summary = `Practiced ${practiced} of ${inSel.length} chords in your selection · ${mastered} mastered`;
  if (o.last) {
    summary += ` · Last ${o.last.n} tries: ${pct(o.last.acc)} correct, median ${fmtTime(o.last.time)}`;
    if (o.before && o.before.n === 20) summary += ` (the 20 before: ${pct(o.before.acc)}, ${fmtTime(o.before.time)})`;
  }
  $('progress-summary').textContent = summary;

  // Table view: practiced chords, the ones needing the most work first.
  rows.sort((a, b) => a.s.level - b.s.level || (b.s.time ?? 99) - (a.s.time ?? 99));
  const body = $('progress-table').querySelector('tbody');
  body.innerHTML = '';
  for (const { root, type, s, inSelection } of rows) {
    const tr = document.createElement('tr');
    if (!inSelection) tr.className = 'off';
    for (const text of [groupLabel(root, type), Progress.LEVELS[s.level], `${s.correct}/${s.tries}`, fmtTime(s.time), ago(s.lastAt)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }
  $('progress-empty').hidden = rows.length > 0;

  $('progress-goal').textContent = goal;
}

function tipText(root, type, s, inSelection) {
  const name = groupLabel(root, type);
  if (!s.tries) return `${name}\nNot practiced yet` + (inSelection ? '' : '\n(not in your current selection)');
  const lines = [
    `${name} — ${Progress.LEVELS[s.level]}`,
    `Last ${s.tries} tries: ${s.correct} correct (${pct(s.acc)})`,
    `Median time: ${fmtTime(s.time)} (goal ${state.settings.goal}s)`,
    `Last practiced ${ago(s.lastAt)}`,
  ];
  if (s.byInversion.length > 1 || s.byInversion[0]?.inversion !== 'any') {
    lines.push('');
    for (const b of s.byInversion.sort((x, y) => String(x.inversion).localeCompare(String(y.inversion)))) {
      lines.push(`${INVERSION_LABELS[b.inversion]}: ${Progress.LEVELS[b.level]}, ${fmtTime(b.time)}`);
    }
  }
  if (!inSelection) lines.push('(not in your current selection)');
  return lines.join('\n');
}

function initProgressTooltip() {
  const tip = $('progress-tip');
  const grid = $('progress-grid');
  const show = (cell, x, y) => {
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px';
    tip.style.top = (y + h + 20 > window.innerHeight ? y - h - 10 : y + 16) + 'px';
  };
  grid.addEventListener('mousemove', e => {
    const cell = e.target.closest('.cell');
    if (cell) show(cell, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  grid.addEventListener('mouseleave', () => { tip.hidden = true; });
  grid.addEventListener('focusin', e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    show(cell, r.left, r.bottom);
  });
  grid.addEventListener('focusout', () => { tip.hidden = true; });
}

// ---------- Timed sessions ----------

let sessionTimer = null;

function startSession() {
  const minutes = Number($('session-length').value);
  state.settings.sessionMinutes = minutes;
  saveSettings();
  const start = Date.now();
  state.session = { start, minutes, endsAt: start + minutes * 60000 };
  sessionTimer = setInterval(tickSession, 1000);
  renderSession();
  nextChord();
}

function tickSession() {
  if (Date.now() >= state.session.endsAt) endSession();
  else renderSession();
}

function endSession() {
  clearInterval(sessionTimer);
  const { start, minutes } = state.session;
  state.session = null;
  renderSession();

  const report = Progress.sessionReport(start);
  const previous = Progress.lastSession();
  const elapsed = Math.round((Date.now() - start) / 60000);
  if (report.attempts) {
    Progress.saveSession({ start, minutes: elapsed, attempts: report.attempts, correct: report.correct, time: report.time });
  }
  showReport(report, previous, elapsed || '<1', minutes);
}

function renderSession() {
  const s = state.session;
  const btn = $('btn-session');
  btn.textContent = s ? 'End session' : 'Start session';
  btn.classList.toggle('active', !!s);
  $('session-length').disabled = !!s;
  const left = s ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : 0;
  $('session-timer').textContent = s ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : '';
}

function chordFromKey(key) {
  const [pc, typeId, inv] = key.split(':');
  const c = buildChord(ROOTS.find(r => r.pc === Number(pc)), CHORD_TYPES.find(t => t.id === typeId),
    inv === 'any' ? null : Number(inv));
  const label = chordLabel(c, labelStyle());
  return c.inversion > 0 && !label.includes('/') ? `${label} (${INVERSION_NAMES[c.inversion].toLowerCase()})` : label;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function showReport(report, previous, elapsed, planned) {
  $('report-title').textContent = `Session complete — ${elapsed} min`;
  const body = $('report-body');
  body.innerHTML = '';

  if (!report.attempts) {
    body.append(el('p', 'note', 'No chords were played in this session.'));
  } else {
    const tiles = el('div', 'report-tiles');
    for (const [value, label] of [
      [report.attempts, 'tries'],
      [pct(report.correct / report.attempts), 'correct'],
      [fmtTime(report.time), 'median time'],
    ]) {
      const t = el('div', 'report-tile');
      t.append(el('span', 'report-value', String(value)), el('span', 'report-label', label));
      tiles.append(t);
    }
    body.append(tiles);

    if (previous) {
      let text = `Last session (${new Date(previous.start).toLocaleDateString()}, ${previous.minutes || '<1'} min): ` +
        `${pct(previous.correct / previous.attempts)} correct, median ${fmtTime(previous.time)}.`;
      if (previous.time !== null && report.time !== null) {
        const diff = previous.time - report.time;
        if (Math.abs(diff) >= 0.05) text += ` You were ${Math.abs(diff).toFixed(1)}s ${diff > 0 ? 'faster' : 'slower'} this time.`;
        else text += ' About the same speed this time.';
      }
      body.append(el('p', 'report-compare', text));
    }

    const improved = report.chords
      .filter(c => c.time !== null && c.before !== null && c.before - c.time >= 0.1)
      .sort((a, b) => (b.before - b.time) - (a.before - a.time))
      .slice(0, 3);
    if (improved.length) {
      body.append(el('h3', '', 'Improved most'));
      const ul = el('ul', 'report-list');
      for (const c of improved) ul.append(el('li', '', `${chordFromKey(c.key)}: ${fmtTime(c.before)} → ${fmtTime(c.time)}`));
      body.append(ul);
    }

    const weak = report.chords
      .filter(c => c.correct < c.tries || (c.time ?? 0) > state.settings.goal)
      .sort((a, b) => a.correct / a.tries - b.correct / b.tries || (b.time ?? 99) - (a.time ?? 99))
      .slice(0, 3);
    if (weak.length) {
      body.append(el('h3', '', 'Needs work'));
      const ul = el('ul', 'report-list');
      for (const c of weak) ul.append(el('li', '', `${chordFromKey(c.key)}: ${c.correct} of ${c.tries} correct, median ${fmtTime(c.time)}`));
      body.append(ul);
    }
  }
  $('report').hidden = false;
  $('btn-report-close').focus();
}

function closeReport() {
  $('report').hidden = true;
}

// ---------- Settings UI ----------

function buildSettings() {
  const typeList = $('type-list');
  for (const t of CHORD_TYPES) {
    typeList.append(checkbox(t.name, state.settings.types.includes(t.id), on => {
      toggleIn(state.settings.types, t.id, on);
    }));
  }

  const rootList = $('root-list');
  for (const r of ROOTS) {
    rootList.append(checkbox(r.name, state.settings.roots.includes(r.pc), on => {
      toggleIn(state.settings.roots, r.pc, on);
    }, `root-${r.pc}`));
  }

  document.querySelectorAll('[data-roots]').forEach(btn => btn.addEventListener('click', () => {
    const naturals = btn.dataset.roots === 'naturals';
    state.settings.roots = ROOTS.filter(r => !naturals || r.acc === 0).map(r => r.pc);
    for (const r of ROOTS) $(`root-${r.pc}`).checked = state.settings.roots.includes(r.pc);
    saveSettings();
    nextChord();
    renderProgress();
    btn.blur();
  }));

  const setInvMode = mode => {
    state.settings.invMode = mode;
    document.querySelectorAll('input[name="inv-mode"]').forEach(r => { r.checked = r.value === mode; });
  };

  const invList = $('inv-list');
  INVERSION_NAMES.forEach((name, i) => {
    const label = i === 0 ? 'Root' : name.split(' ')[0] + (i === 3 ? ' (7ths)' : '');
    invList.append(checkbox(label, state.settings.inversions.includes(i), on => {
      toggleIn(state.settings.inversions, i, on);
      setInvMode('specific');
    }));
  });

  setInvMode(state.settings.invMode);
  document.querySelectorAll('input[name="inv-mode"]').forEach(r => r.addEventListener('change', () => {
    setInvMode(r.value);
    saveSettings();
    nextChord();
  }));

  const order = $('opt-order');
  order.value = state.settings.order;
  order.addEventListener('change', () => {
    state.settings.order = order.value;
    saveSettings();
    nextChord();
  });

  const goal = $('opt-goal');
  goal.value = state.settings.goal;
  goal.addEventListener('change', () => {
    const v = Number(goal.value);
    if (v >= 0.5 && v <= 30) state.settings.goal = v;
    goal.value = state.settings.goal;
    saveSettings();
    renderProgress();
  });

  $('btn-reset-progress').addEventListener('click', () => {
    if (!confirm('Clear all practice history? This cannot be undone.')) return;
    Progress.reset();
    renderProgress();
    nextChord();
  });

  const slash = $('opt-slash');
  slash.checked = state.settings.slash;
  slash.addEventListener('change', () => {
    state.settings.slash = slash.checked;
    saveSettings();
    renderPrompt();
  });
}

function checkbox(text, checked, onChange, id) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (id) input.id = id;
  input.addEventListener('change', () => {
    onChange(input.checked);
    saveSettings();
    nextChord();
    renderProgress();
  });
  label.append(input, text);
  return label;
}

function toggleIn(arr, value, on) {
  const i = arr.indexOf(value);
  if (on && i < 0) arr.push(value);
  if (!on && i >= 0) arr.splice(i, 1);
}

// ---------- Boot ----------

$('btn-hint').addEventListener('click', e => { toggleNotes(); e.currentTarget.blur(); });
$('btn-skip').addEventListener('click', e => { skip(); e.currentTarget.blur(); });
function cycleNameStyle() {
  const i = NAME_STYLES.findIndex(s => s.id === state.settings.nameStyle);
  state.settings.nameStyle = NAME_STYLES[(i + 1) % NAME_STYLES.length].id;
  saveSettings();
  renderPrompt();
  renderStaff();
  renderProgress();
}

$('btn-names').addEventListener('click', e => { cycleNameStyle(); e.currentTarget.blur(); });
$('btn-staff').addEventListener('click', e => {
  state.settings.showStaff = !state.settings.showStaff;
  saveSettings();
  renderStaff();
  e.currentTarget.blur();
});

$('btn-session').addEventListener('click', e => {
  state.session ? endSession() : startSession();
  e.currentTarget.blur();
});
$('btn-report-close').addEventListener('click', closeReport);
$('report').addEventListener('click', e => { if (e.target.id === 'report') closeReport(); });

$('input-select').addEventListener('change', () => {
  state.settings.input = inputChoice();
  saveSettings();
  selectInput();
});

// Time spent in another tab or app doesn't count: restart the chord's clock on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') state.shownAt = performance.now();
});

loadSettings();
Progress.load();
$('session-length').value = state.settings.sessionMinutes;
buildSettings();
initProgressTooltip();
buildMicPanel();
renderPrompt();
buildPiano();
nextChord();
renderProgress();
PlayAlong.init({
  held: () => [...state.held].sort((a, b) => a - b),
  clearClicked: () => {
    for (const n of state.clicked) state.held.delete(n);
    state.clicked.clear();
  },
  renderPiano,
  notesLabel,
  notesState,
  modeChanged: mode => {
    document.querySelectorAll('.play-only').forEach(n => { n.hidden = mode !== 'play'; });
    if (mode === 'drill') { state.held.clear(); state.clicked.clear(); evaluate(); }
    renderPiano();
  },
});
refreshInputs(); // starts the saved input; MIDI permission is only requested if MIDI is chosen
