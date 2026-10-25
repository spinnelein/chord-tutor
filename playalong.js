'use strict';

// Play along: walk through a chord progression (preset or typed in) and track how quickly you
// change between chords. "Wait for me" moves on when you play each chord; "Keep the beat" changes
// chords in time, with an optional click, and marks each change on time, late or missed. There's
// also the "one-minute changes" drill: switch between two chords as often as you can in a minute.
//
// The app tells this module when held notes change (evaluate) and asks it which keys to light
// (hintNotes). Chords here come from theory.js; any inversion counts unless a slash chord names
// the bass note.

// The line under the progression menu: difficulty, description, and a link to hear a famous song
// that uses it (a YouTube search, so the link can't go stale).
const LEVEL_NAMES = ['Beginner', 'Intermediate', 'Advanced'];
function describeProgression(p, aboutEl, linkEl) {
  aboutEl.textContent = (p.level !== undefined ? LEVEL_NAMES[p.level] + ' · ' : '') + p.about;
  linkEl.hidden = !p.song;
  if (!p.song) return;
  const query = p.song.search ?? `${p.song.title} ${p.song.artist}`;
  linkEl.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
  linkEl.textContent = p.song.search ? `▶ Find songs that use it on YouTube` : `▶ Hear it: "${p.song.title}" — ${p.song.artist}`;
  if (p.id === 'preset:cadence') linkEl.textContent = '▶ Watch a lesson on YouTube';
}

// The progression menu, with presets under their style headings and saved ones last.
function fillProgressionMenu(sel, items) {
  sel.innerHTML = '';
  for (const group of [...Progressions.GROUPS, 'Your progressions']) {
    const inGroup = items.filter(p => (p.custom ? 'Your progressions' : p.group) === group);
    if (!inGroup.length) continue;
    const og = document.createElement('optgroup');
    og.label = group;
    for (const p of inGroup) og.append(new Option(p.name, p.id));
    sel.append(og);
  }
}

const PlayAlong = (() => {
  const NOT_QUITE_DELAY_MS = 250;
  const FEEDBACK_HOLD_MS = 2500;
  const KEEP = 20;

  const settings = {
    mode: 'drill',             // which tab is showing: 'drill' (the chord trainer) or 'play'
    prog: 'preset:blues12',
    progKeys: {}, progTranspose: {}, progText: {},
    customProgs: [],
    playMode: 'wait', tempo: 70, beats: 4, click: true, loop: true,
    showNotes: true,
    smoothFor: {},             // progression id -> voice chords as the nearest inversion to the last one
    oneMinuteBest: {},
  };
  let changes = {};            // "fromKey>toKey" -> { results: [{ ok, t, at }] }
  let app = null;              // hooks from app.js
  let parsed = null;           // current progression
  let play = null;             // run in progress
  let judgedKey = null, notQuiteTimer = null, feedbackTimer = null;

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function load() {
    try {
      Object.assign(settings, JSON.parse(localStorage.getItem('chordTutorPlayAlong')) || {});
      changes = JSON.parse(localStorage.getItem('chordTutorChanges')) || {};
    } catch { /* storage unavailable */ }
  }
  const save = () => { try { localStorage.setItem('chordTutorPlayAlong', JSON.stringify(settings)); } catch { } };
  const saveChanges = () => { try { localStorage.setItem('chordTutorChanges', JSON.stringify(changes)); } catch { } };

  function recordChange(from, to, ok, time) {
    const entry = changes[`${from.key}>${to.key}`] ??= { results: [] };
    entry.results.push({ ok, t: ok ? Math.round(Math.min(time, 30) * 100) / 100 : null, at: Date.now() });
    if (entry.results.length > KEEP) entry.results.splice(0, entry.results.length - KEEP);
    saveChanges();
  }

  const median = xs => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ---------- Chords on the piano ----------

  // A close voicing in root position around middle C; a slash chord gets its bass note below.
  function voicing(chord) {
    const rootMidi = 60 + chord.root.pc;
    const notes = chord.tones.map((t, i) => ({ midi: rootMidi + chord.type.tones[i][0], ...t }));
    if (chord.bass !== null) {
      let bass = 48 + chord.bass;
      while (bass >= rootMidi) bass -= 12;
      const tone = chord.tones.find(t => t.pc === chord.bass) ?? Theory.parseNote(chord.symbol.split('/')[1]);
      notes.unshift({ midi: bass, letter: tone.letter, acc: tone.acc, pc: chord.bass, name: tone.name });
    }
    return notes.sort((a, b) => a.midi - b.midi);
  }

  // Every required tone, nothing outside the chord, and the named bass note lowest for slash chords.
  function matches(chord, notes) {
    if (!chord || !notes.length) return false;
    const pcs = new Set(notes.map(n => n % 12));
    if (!chord.required.every(pc => pcs.has(pc))) return false;
    if ([...pcs].some(pc => !chord.pcs.includes(pc))) return false;
    if (chord.bass !== null && notes[0] % 12 !== chord.bass) return false;
    return true;
  }

  const stillRinging = (notes, prev) => prev && notes.length && notes.every(n => prev.pcs.includes(n % 12));

  function wrongMessage(chord, notes) {
    const pcs = new Set(notes.map(n => n % 12));
    const other = Theory.identify(pcs, notes[0] % 12);
    // Right notes but the wrong bass for a slash chord: say what's needed rather than "that's D".
    const sameChord = other && other.root.pc === chord.root.pc && other.type.id === chord.type.id;
    if (sameChord && chord.bass !== null) return `Right notes — now put ${Theory.pcName(chord.bass, chord)} at the bottom for ${chord.symbol}`;
    if (other && other.key !== chord.key) return `Not quite — that's ${other.symbol}`;
    const missing = chord.required.filter(pc => !pcs.has(pc)).map(pc => Theory.pcName(pc, chord));
    const extra = [...pcs].filter(pc => !chord.pcs.includes(pc)).map(pc => Theory.pcName(pc, chord));
    const parts = [];
    if (missing.length) parts.push('missing ' + missing.join(', '));
    if (extra.length) parts.push('extra ' + extra.join(', '));
    if (!parts.length && chord.bass !== null) parts.push(`${Theory.pcName(chord.bass, chord)} must be the lowest note`);
    return 'Not quite — ' + parts.join('; ');
  }

  function renderStaff(box, notes, width) {
    box.innerHTML = '';
    if (!window.Vex || !notes) return;
    const { Renderer, Stave, StaveNote, Accidental, Formatter } = Vex.Flow;
    const r = new Renderer(box, Renderer.Backends.SVG);
    r.resize(width, 150);
    const ctx = r.getContext();
    const stave = new Stave(6, 20, width - 12).addClef('treble');
    stave.setContext(ctx).draw();
    const VF = { '-2': 'bb', '-1': 'b', '1': '#', '2': '##' };
    const note = new StaveNote({
      keys: notes.map(n => `${Theory.LETTERS[n.letter].toLowerCase()}/${Math.floor((n.midi - n.acc) / 12) - 1}`),
      duration: 'w', align_center: true,
    });
    notes.forEach((n, i) => { if (n.acc) note.addModifier(new Accidental(VF[n.acc]), i); });
    Formatter.FormatAndDraw(ctx, stave, [note]);
  }

  // ---------- Feedback ----------

  function setFeedback(text, kind) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
    const f = $('play-feedback');
    f.textContent = text;
    f.className = 'feedback' + (kind ? ' ' + kind : '');
  }

  function fadeFeedback() {
    if (!$('play-feedback').classList.contains('bad')) return setFeedback('');
    if (!feedbackTimer) feedbackTimer = setTimeout(() => setFeedback(''), FEEDBACK_HOLD_MS);
  }

  function notQuite(key, text) {
    if (judgedKey === key) return setFeedback(text, 'bad');
    clearTimeout(notQuiteTimer);
    notQuiteTimer = setTimeout(() => {
      if (app.held().join(',') !== key) return;
      judgedKey = key;
      setFeedback(text, 'bad');
    }, NOT_QUITE_DELAY_MS);
  }

  const cancelNotQuite = () => { clearTimeout(notQuiteTimer); notQuiteTimer = null; };

  // ---------- Progressions ----------

  function list() {
    return [
      ...Progressions.PRESETS.map(p => ({ id: 'preset:' + p.id, group: p.group, name: p.name, text: p.text, about: p.about, level: p.level, song: p.song, key: p.keys.piano ?? 'C' })),
      ...settings.customProgs.map(p => ({ id: 'custom:' + p.id, name: p.name, text: p.text, about: 'Your progression.', key: 'C', custom: true })),
    ];
  }
  const current = () => list().find(p => p.id === settings.prog) ?? list()[0];

  function renderSelect() {
    const sel = $('prog-select');
    fillProgressionMenu(sel, list());
    sel.value = current().id;
    const keySel = $('prog-key');
    keySel.innerHTML = '';
    for (const r of Theory.ROOTS) {
      keySel.append(new Option(r.name + ' major', r.name));
      keySel.append(new Option(r.name + ' minor', r.name + 'm'));
    }
    loadEditor();
  }

  function loadEditor() {
    const p = current();
    $('prog-text').value = settings.progText[p.id] ?? p.text;
    describeProgression(p, $('prog-about'), $('prog-song'));
    $('prog-key').value = settings.progKeys[p.id] ?? p.key;
    $('prog-delete').hidden = !p.custom;
    $('play-smooth').checked = isSmooth();
    parseEditor();
  }

  function parseEditor() {
    const p = current();
    const key = Progressions.parseKey($('prog-key').value);
    const transpose = settings.progTranspose[p.id] ?? 0;
    parsed = Progressions.parse($('prog-text').value, key, transpose);
    $('key-wrap').hidden = !parsed.usesNumerals;
    $('transpose-wrap').hidden = !parsed.usesNames;
    $('tr-val').textContent = transpose > 0 ? '+' + transpose : transpose;
    $('prog-errors').textContent = parsed.errors.length ? `Didn't understand: ${parsed.errors.join(', ')}` : '';
    if (!play) { renderBars(); render(); }
  }

  function renderBars(results = []) {
    const box = $('bars');
    box.innerHTML = '';
    let ei = 0;
    (parsed?.bars ?? []).forEach((bar, b) => {
      const cell = el('div', 'bar');
      cell.dataset.bar = b;
      for (const chord of bar) {
        const span = el('span', 'bar-chord', chord.symbol);
        if (results[ei]) span.classList.add(results[ei]);
        cell.append(span);
        ei++;
      }
      box.append(cell);
    });
  }

  // ---------- Running ----------

  function start(oneMinute = null) {
    stop(false);
    let events;
    if (oneMinute) {
      events = [oneMinute.a, oneMinute.b].map((chord, i) => ({ chord, bar: i, beat: i, beats: 1, change: true }));
      parsed = { bars: [[oneMinute.a], [oneMinute.b]], errors: [] };
    } else {
      parseEditor();
      if (!parsed.bars.length) { setFeedback('Enter some chords first', 'bad'); return; }
      events = Progressions.events(parsed.bars, settings.beats);
    }
    const mode = oneMinute ? 'wait' : settings.playMode;
    play = { mode, events, oneMinute, index: 0, results: [], changeTimes: [], prev: null, lastAt: performance.now(), count: 0 };
    if (oneMinute) play.endsAt = performance.now() + 60000;
    if (mode === 'wait') {
      play.steps = events.filter(e => e.change);
      if (settings.loop && play.steps.length > 1 && play.steps[0].chord.key === play.steps.at(-1).chord.key) play.steps.pop();
    } else {
      play.beatMs = 60000 / settings.tempo;
      play.totalBeats = events.at(-1).beat + events.at(-1).beats;
      play.t0 = performance.now() + settings.beats * play.beatMs; // one bar count-in
      play.lastBeat = -Infinity;
      play.target = -1;
    }
    $('play-start').textContent = 'Stop';
    $('play-summary').hidden = true;
    setFeedback('');
    renderBars();
    render();
    if (mode === 'beat' || oneMinute) play.raf = requestAnimationFrame(tick);
    evaluate();
  }

  function stop(summary = true) {
    const p = play;
    if (!p) return;
    cancelAnimationFrame(p.raf);
    play = null;
    $('play-start').textContent = 'Start';
    if (p.oneMinute) finishOneMinute(p);
    else if (summary) renderSummary(p);
    render();
    renderChanges();
  }

  function target() {
    if (!play) return null;
    if (play.mode === 'wait') return play.steps[play.index].chord;
    return play.target >= 0 ? play.events[play.target].chord : null;
  }

  function nextChord() {
    const p = play;
    if (!p) return parsed?.bars.flat().find(c => c.key !== parsed.bars[0]?.[0]?.key) ?? null;
    if (p.mode === 'wait') {
      if (p.index + 1 < p.steps.length) return p.steps[p.index + 1].chord;
      return settings.loop || p.oneMinute ? p.steps[0].chord : null;
    }
    for (let i = Math.max(0, p.target) + 1; i < p.events.length; i++) if (p.events[i].chord.key !== target()?.key) return p.events[i].chord;
    return settings.loop ? p.events[0].chord : null;
  }

  function evaluate() {
    const p = play;
    const chord = target();
    if (!p || !chord) return;
    const notes = app.held();
    const key = notes.join(',');
    if (key !== judgedKey) judgedKey = null;
    if (!notes.length) { cancelNotQuite(); fadeFeedback(); return; }
    if (matches(chord, notes)) {
      cancelNotQuite();
      return p.mode === 'wait' ? stepDone() : beatHit();
    }
    if (stillRinging(notes, p.prev)) { cancelNotQuite(); return; }
    if (new Set(notes.map(n => n % 12)).size >= chord.required.length) notQuite(key, wrongMessage(chord, notes));
    else { cancelNotQuite(); fadeFeedback(); }
  }

  function stepDone() {
    const p = play;
    const now = performance.now();
    const step = p.steps[p.index];
    if (p.prev && p.prev.key !== step.chord.key) {
      const time = (now - p.lastAt) / 1000;
      recordChange(p.prev, step.chord, true, time);
      p.changeTimes.push({ from: p.prev, to: step.chord, time });
      if (p.oneMinute) p.count++;
    }
    p.results[p.events.indexOf(step)] = 'hit';
    p.prev = step.chord;
    p.lastAt = now;
    app.clearClicked();
    if (!p.oneMinute) setFeedback('');
    p.index++;
    if (p.index >= p.steps.length) {
      if (settings.loop || p.oneMinute) { p.index = 0; p.results = []; }
      else { stop(); return; }
    }
    renderBars(p.results);
    render();
  }

  function beatHit() {
    const p = play;
    const ev = p.events[p.target];
    if (p.results[p.target]) return;
    const late = (performance.now() - (p.t0 + ev.beat * p.beatMs)) / p.beatMs; // beats; negative = early
    p.results[p.target] = late <= 1 ? 'hit' : 'late';
    if (p.prev && p.prev.key !== ev.chord.key) {
      const time = Math.max(0, late * p.beatMs / 1000);
      recordChange(p.prev, ev.chord, true, time);
      p.changeTimes.push({ from: p.prev, to: ev.chord, time });
    }
    p.prev = ev.chord;
    app.clearClicked();
    renderBars(p.results);
    render();
  }

  function tick() {
    const p = play;
    if (!p) return;
    const now = performance.now();
    if (p.oneMinute) {
      const left = Math.max(0, Math.ceil((p.endsAt - now) / 1000));
      $('play-feedback').textContent = `${p.count} change${p.count === 1 ? '' : 's'} · ${left}s left`;
      $('play-feedback').className = 'feedback big';
      if (now >= p.endsAt) { stop(); return; }
      p.raf = requestAnimationFrame(tick);
      return;
    }
    let beat = (now - p.t0) / p.beatMs;
    if (beat >= p.totalBeats) {
      markMissed(p.events.length);
      if (!settings.loop) { stop(); return; }
      p.t0 += p.totalBeats * p.beatMs;
      p.results = [];
      p.lastBeat -= p.totalBeats;
      beat -= p.totalBeats;
    }
    const whole = Math.floor(beat);
    if (whole !== p.lastBeat) {
      p.lastBeat = whole;
      const inBar = ((whole % settings.beats) + settings.beats) % settings.beats;
      if (settings.click) click(inBar === 0);
      renderBeatDots(whole);
    }
    // The target is the chord playing now, or the next change once it's half a beat away.
    let t = -1;
    for (let i = 0; i < p.events.length; i++) if (p.events[i].beat <= beat + 0.5) t = i;
    if (t !== p.target) {
      markMissed(t);
      p.target = t;
      const ev = p.events[t];
      if (ev && !ev.change && p.results[t - 1] && p.results[t - 1] !== 'missed') p.results[t] = p.results[t - 1];
      renderBars(p.results);
      render();
      evaluate();
    }
    p.raf = requestAnimationFrame(tick);
  }

  function markMissed(upTo) {
    const p = play;
    for (let i = 0; i < upTo; i++) {
      if (p.results[i]) continue;
      p.results[i] = 'missed';
      const ev = p.events[i];
      if (ev.change && p.prev && p.prev.key !== ev.chord.key) recordChange(p.prev, ev.chord, false, 0);
    }
  }

  let clickCtx = null;
  function click(accent) {
    try {
      clickCtx ??= new AudioContext();
      const t = clickCtx.currentTime;
      const osc = clickCtx.createOscillator(), gain = clickCtx.createGain();
      osc.frequency.value = accent ? 1600 : 1100;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain).connect(clickCtx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    } catch { /* no audio output */ }
  }

  function renderBeatDots(beat) {
    const box = $('beat-dots');
    box.innerHTML = '';
    if (!play || play.mode !== 'beat') return;
    const inBar = ((beat % settings.beats) + settings.beats) % settings.beats;
    for (let i = 0; i < settings.beats; i++) box.append(el('span', 'beat-dot' + (i === inBar ? ' on' : '') + (i === 0 ? ' one' : '')));
    if (beat < 0) box.append(el('span', 'count-in', `Count-in: ${settings.beats + beat + 1}`));
  }


  // ---------- Smooth voice leading ----------
  //
  // Pianists move between chords with as little hand movement as possible: keep the notes two
  // chords share and move the others to the nearest chord note. That's why a cadence is taught as
  // I – IV⁶₄ – I – V⁶₅ – I (in C: C-E-G, C-F-A, C-E-G, B-F-G, C-E-G) rather than in root position.
  // Each chord here is voiced as the nearest inversion to the one before, starting in root
  // position; 7th chords may leave out the 5th, as teachers usually do. Slash chords keep their
  // bass note lowest.

  const INVERSIONS = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

  // On by default for the cadence drills, which are always taught this way; others start in root position.
  const CADENCES = ['preset:cadence', 'preset:cadenceV', 'preset:minorCadence', 'preset:minorCadenceV'];
  const isSmooth = () => settings.smoothFor[current().id] ?? CADENCES.includes(current().id);

  function spellPc(chord, pc) {
    const tone = chord.tones.find(t => t.pc === pc) ?? Theory.parseNote(chord.symbol.split('/')[1] || '') ?? Theory.rootByPc(pc);
    return { letter: tone.letter, acc: tone.acc, pc, name: tone.name };
  }

  // Close voicings of a chord: every inversion, with and without an optional 5th, in a range around middle C.
  function closeVoicings(chord) {
    const sets = [chord.pcs];
    if (chord.optional.length && chord.pcs.length >= 4) sets.push(chord.pcs.filter(pc => !chord.optional.includes(pc)));
    const out = [];
    for (const pcs of sets) {
      for (const lowestPc of pcs) {
        if (chord.bass !== null && lowestPc !== chord.bass) continue;
        for (let low = 53; low <= 71; low++) {
          if (low % 12 !== lowestPc) continue;
          const notes = [low];
          // Stack the other chord notes upwards in order, each at its next position above.
          const order = [...pcs.slice(pcs.indexOf(lowestPc) + 1), ...pcs.slice(0, pcs.indexOf(lowestPc))];
          for (const pc of order) {
            let n = notes.at(-1) + 1;
            while (n % 12 !== pc) n++;
            notes.push(n);
          }
          out.push(notes);
        }
      }
    }
    return out;
  }

  const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

  // How far the hand moves: each new note's distance to the nearest old one, a cost for changing the
  // number of notes, and a gentle pull back towards middle C so the hand doesn't drift.
  function moveCost(prev, next) {
    const moves = next.reduce((sum, n) => sum + Math.min(...prev.map(p => Math.abs(p - n))), 0);
    return moves + 2 * Math.abs(prev.length - next.length) + 0.2 * Math.abs(meanOf(next) - 64);
  }

  function voiceSteps(chords) {
    const out = [];
    for (const chord of chords) {
      const options = closeVoicings(chord);
      let notes;
      if (!isSmooth() || !out.length || !options.length) {
        notes = voicing(chord).map(n => n.midi);  // root position (or as written, for slash chords)
      } else {
        const prev = out.at(-1).map(n => n.midi);
        notes = options.reduce((best, o) => (moveCost(prev, o) < moveCost(prev, best) ? o : best));
      }
      out.push(notes.map(midi => ({ midi, ...spellPc(chord, midi % 12) })));
    }
    return out;
  }

  // The progression as steps (repeated chords merged) with a voicing for each.
  let stepCache = { key: null };
  function stepPlan() {
    const events = play ? play.events : (parsed?.bars.length ? Progressions.events(parsed.bars, settings.beats) : []);
    if (!events.length) return null;
    const steps = [];
    const stepOf = events.map(e => { if (e.change) steps.push(e.chord); return steps.length - 1; });
    const key = steps.map(c => c.key).join(',') + '|' + isSmooth();
    if (stepCache.key !== key) stepCache = { key, voicings: voiceSteps(steps) };
    return { steps, stepOf, voicings: stepCache.voicings };
  }

  function currentStepIndex(plan) {
    if (!play) return 0;
    if (play.mode === 'wait') return plan.stepOf[play.events.indexOf(play.steps[play.index])] ?? 0;
    return play.target >= 0 ? plan.stepOf[play.target] : 0;
  }

  function inversionName(chord, notes) {
    const i = chord.pcs.indexOf(notes[0].pc);
    return i > 0 && chord.bass === null ? INVERSIONS[i] : '';
  }

  // ---------- Rendering ----------

  function render() {
    const plan = stepPlan();
    let now = null, next = null, nowNotes = null, nextNotes = null;
    if (plan) {
      const s = currentStepIndex(plan);
      const n = s + 1 < plan.steps.length ? s + 1 : (settings.loop || play?.oneMinute) && plan.steps.length > 1 ? 0 : -1;
      now = plan.steps[s];
      nowNotes = plan.voicings[s];
      if (n >= 0 && plan.steps[n].key !== now.key) { next = plan.steps[n]; nextNotes = plan.voicings[n]; }
    }
    $('now-name').textContent = now ? now.symbol : '—';
    const inv = now ? inversionName(now, nowNotes) : '';
    $('now-notes').textContent = now && settings.showNotes ? nowNotes.map(n => n.name).join(' – ') + (inv ? ` (${inv})` : '') : '';
    renderStaff($('now-staff'), nowNotes, 200);
    $('next-name').textContent = next ? next.symbol : '—';
    renderStaff($('next-staff'), nextNotes, 150);
    document.querySelectorAll('.bar').forEach(b => b.classList.remove('current'));
    if (play) {
      const ev = play.mode === 'wait' ? play.steps[play.index] : play.events[play.target];
      if (ev) document.querySelector(`.bar[data-bar="${ev.bar}"]`)?.classList.add('current');
    } else renderBeatDots(0);
    const btn = $('play-notes');
    btn.textContent = `Notes: ${settings.showNotes ? 'on' : 'off'} (Enter)`;
    btn.setAttribute('aria-pressed', settings.showNotes);
    app.renderPiano();
  }

  function renderSummary(p) {
    const box = $('play-summary');
    box.innerHTML = '';
    box.append(el('h3', '', 'How it went'));
    if (p.mode === 'beat') {
      const judged = p.results.filter(Boolean);
      const hits = judged.filter(r => r === 'hit').length, late = judged.filter(r => r === 'late').length;
      box.append(el('p', '', `${hits} on time, ${late} late, ${judged.length - hits - late} missed (this pass).`));
    }
    const by = new Map();
    for (const c of p.changeTimes) {
      const k = `${c.from.symbol} → ${c.to.symbol}`;
      by.set(k, [...(by.get(k) ?? []), c.time]);
    }
    if (by.size) {
      const rows = [...by].map(([k, ts]) => [k, ts.reduce((a, b) => a + b, 0) / ts.length, ts.length]).sort((a, b) => b[1] - a[1]);
      const ul = el('ul', 'summary-list');
      for (const [k, avg, n] of rows) ul.append(el('li', '', `${k}: ${avg.toFixed(1)}s${n > 1 ? ` average over ${n}` : ''}`));
      box.append(el('p', 'note', p.mode === 'wait' ? 'Time to change to each chord, slowest first:' : 'How long after the beat each change landed, slowest first:'), ul);
    } else box.append(el('p', 'note', 'No chord changes were played.'));
    box.hidden = false;
  }

  function renderChanges() {
    const box = $('changes-list');
    box.innerHTML = '';
    const rows = Object.entries(changes).map(([k, e]) => {
      const [from, to] = k.split('>');
      return { from, to, time: median(e.results.slice(-10).filter(r => r.ok).map(r => r.t)) };
    }).filter(r => r.time !== null).sort((a, b) => b.time - a.time).slice(0, 6);
    if (!rows.length) return;
    box.append(el('p', 'note', 'Your slowest changes so far:'));
    for (const r of rows) {
      const a = Theory.chordFromKey(r.from), b = Theory.chordFromKey(r.to);
      const row = el('div', 'change-row');
      row.append(el('span', 'change-name', `${a.symbol} → ${b.symbol}`), el('span', 'change-time', `${r.time.toFixed(1)}s`));
      const best = settings.oneMinuteBest[`${a.key}>${b.key}`] ?? settings.oneMinuteBest[`${b.key}>${a.key}`];
      if (best) row.append(el('span', 'note', `best: ${best} in a minute`));
      const btn = el('button', 'mini', 'Practise for 1 minute');
      btn.addEventListener('click', () => startOneMinute(a, b));
      row.append(btn);
      box.append(row);
    }
  }

  function startOneMinute(a, b) {
    $('omc-a').value = a.symbol;
    $('omc-b').value = b.symbol;
    start({ a, b });
  }

  function finishOneMinute(p) {
    const key = `${p.oneMinute.a.key}>${p.oneMinute.b.key}`;
    const best = settings.oneMinuteBest[key] ?? 0;
    if (p.count > best) settings.oneMinuteBest[key] = p.count;
    save();
    const box = $('play-summary');
    box.innerHTML = '';
    box.append(el('h3', '', `${p.oneMinute.a.symbol} ↔ ${p.oneMinute.b.symbol}: ${p.count} changes in a minute`));
    box.append(el('p', '', p.count > best ? (best ? `New best! (was ${best})` : 'Your first score — try to beat it next time.') : `Your best is ${best}.`));
    box.hidden = false;
    setFeedback('');
    loadEditor();
  }

  // ---------- Tabs ----------

  function setMode(mode) {
    if (play && mode !== 'play') stop(false);
    settings.mode = mode;
    save();
    $('mode-play').hidden = mode !== 'play';
    document.querySelectorAll('.drill-only').forEach(n => { n.hidden = mode === 'play'; });
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === mode));
    if (mode === 'play') { render(); renderChanges(); }
    app.modeChanged(mode);
  }

  function toggleNotes() {
    settings.showNotes = !settings.showNotes;
    save();
    render();
  }

  // ---------- Setup ----------

  function wire() {
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('prog-select').addEventListener('change', e => { stop(false); settings.prog = e.target.value; save(); loadEditor(); });
    $('prog-key').addEventListener('change', e => { settings.progKeys[current().id] = e.target.value; save(); parseEditor(); });
    $('prog-text').addEventListener('input', () => { settings.progText[current().id] = $('prog-text').value; save(); parseEditor(); });
    for (const [id, d] of [['tr-down', -1], ['tr-up', 1]]) {
      $(id).addEventListener('click', () => {
        const p = current();
        settings.progTranspose[p.id] = Math.max(-11, Math.min(11, (settings.progTranspose[p.id] ?? 0) + d));
        save();
        parseEditor();
      });
    }
    $('prog-save').addEventListener('click', () => {
      const name = prompt('Name for this progression:', current().custom ? current().name : 'My progression');
      if (!name) return;
      // Saved with chord names in the current key, so it plays the same wherever it's opened.
      const text = parsed.bars.map(b => b.map(c => c.symbol.replace(/♯/g, '#').replace(/♭/g, 'b')).join(' ')).join(' | ');
      const id = Date.now().toString(36);
      settings.customProgs.push({ id, name, text });
      settings.prog = 'custom:' + id;
      save();
      renderSelect();
    });
    $('prog-delete').addEventListener('click', () => {
      const p = current();
      if (!p.custom || !confirm(`Delete "${p.name}"?`)) return;
      settings.customProgs = settings.customProgs.filter(c => 'custom:' + c.id !== p.id);
      settings.prog = 'preset:blues12';
      save();
      renderSelect();
    });
    const syncBeatOnly = () => document.querySelectorAll('.beat-only').forEach(n => { n.hidden = settings.playMode !== 'beat'; });
    $('play-mode').value = settings.playMode;
    syncBeatOnly();
    $('play-mode').addEventListener('change', e => { settings.playMode = e.target.value; save(); syncBeatOnly(); });
    $('tempo').value = settings.tempo;
    $('tempo-val').textContent = settings.tempo;
    $('tempo').addEventListener('input', e => { settings.tempo = Number(e.target.value); $('tempo-val').textContent = e.target.value; save(); });
    $('beats').value = settings.beats;
    $('beats').addEventListener('change', e => { settings.beats = Number(e.target.value); save(); });
    for (const id of ['click', 'loop']) {
      $(id).checked = settings[id];
      $(id).addEventListener('change', e => { settings[id] = e.target.checked; save(); render(); });
    }
    $('play-smooth').addEventListener('change', e => { settings.smoothFor[current().id] = e.target.checked; save(); render(); });
    $('play-start').addEventListener('click', e => { play ? stop() : start(); e.currentTarget.blur(); });
    $('play-notes').addEventListener('click', e => { toggleNotes(); e.currentTarget.blur(); });
    $('omc-start').addEventListener('click', () => {
      const a = Theory.parseChord($('omc-a').value), b = Theory.parseChord($('omc-b').value);
      if (!a || !b || a.key === b.key) { setFeedback('Enter two different chord names, like C and G', 'bad'); return; }
      startOneMinute(a, b);
    });
  }

  // hooks: { held(), clearClicked(), renderPiano(), modeChanged(mode) }
  function init(hooks) {
    app = hooks;
    load();
    wire();
    renderSelect();
    setMode(settings.mode);
  }

  return {
    init,
    active: () => settings.mode === 'play',
    evaluate,
    // Keys to light on the piano: the current chord's notes, when notes are on.
    hintNotes() {
      const plan = settings.mode === 'play' && settings.showNotes ? stepPlan() : null;
      return new Set(plan ? plan.voicings[currentStepIndex(plan)].map(n => n.midi) : []);
    },
    // Space starts/stops; Enter toggles the notes. Returns true if the key was used.
    key(e) {
      if (settings.mode !== 'play') return false;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return true;
      if (e.key === ' ') { e.preventDefault(); play ? stop() : start(); }
      if (e.key === 'Enter') { e.preventDefault(); toggleNotes(); }
      return true;
    },
  };
})();
