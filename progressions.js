'use strict';

// Chord progressions: common presets (written in roman numerals so they work in any key) and a
// parser for progressions typed by hand.
//
// Text format: bars separated by "|", chords in a bar separated by spaces. "%" repeats the
// previous bar. Chords can be names (G, F#m7, D/F#) or roman numerals in the chosen key
// (I, IV7, vi, bVII). Without any "|", each chord is one bar.

const Progressions = (() => {
  const PRESETS = [
    {
      id: 'blues12', name: '12-bar blues',
      about: 'The backbone of blues and rock and roll. Three chords, twelve bars.',
      text: 'I7 | I7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7',
      keys: { guitar: 'E', ukulele: 'A' },
    },
    {
      id: 'blues12quick', name: '12-bar blues (quick change)',
      about: 'Same as the 12-bar blues, but goes to the IV chord in bar 2.',
      text: 'I7 | IV7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7',
      keys: { guitar: 'A', ukulele: 'A' },
    },
    {
      id: 'blues12basic', name: '12-bar blues (no 7ths)',
      about: 'A simpler blues with plain major chords. A good first progression.',
      text: 'I | I | I | I | IV | IV | I | I | V | IV | I | V',
      keys: { guitar: 'A', ukulele: 'C' },
    },
    {
      id: 'pop', name: 'Pop: I–V–vi–IV',
      about: 'The "four chords" heard in hundreds of pop songs.',
      text: 'I | V | vi | IV',
      keys: { guitar: 'G', ukulele: 'C' },
    },
    {
      id: 'fifties', name: '50s: I–vi–IV–V',
      about: 'The doo-wop progression ("Stand By Me", "Earth Angel").',
      text: 'I | vi | IV | V',
      keys: { guitar: 'G', ukulele: 'C' },
    },
    {
      id: 'sad', name: 'Minor pop: vi–IV–I–V',
      about: 'The pop progression starting on the minor chord.',
      text: 'vi | IV | I | V',
      keys: { guitar: 'G', ukulele: 'C' },
    },
    {
      id: 'folk', name: 'Three-chord folk: I–IV–V',
      about: 'Countless folk, country and campfire songs use just these three chords.',
      text: 'I | I | IV | I | I | I | V | V | I | I | IV | IV | I | V | I | I',
      keys: { guitar: 'G', ukulele: 'C' },
    },
    {
      id: 'canon', name: 'Canon: I–V–vi–iii–IV–I–IV–V',
      about: "Pachelbel's Canon, and many songs borrowed from it.",
      text: 'I | V | vi | iii | IV | I | IV | V',
      keys: { guitar: 'D', ukulele: 'C' },
    },
    {
      id: 'andalusian', name: 'Andalusian (minor): i–♭VII–♭VI–V',
      about: 'A descending flamenco progression ("Hit the Road Jack", "Stray Cat Strut").',
      text: 'i | bVII | bVI | V',
      keys: { guitar: 'Am', ukulele: 'Am' },
    },
    {
      id: 'jazz', name: 'Jazz: ii–V–I',
      about: 'The most common progression in jazz.',
      text: 'ii7 | V7 | Imaj7 | Imaj7',
      keys: { guitar: 'C', ukulele: 'F' },
    },
  ];

  // "Am" -> { root, minor: true }
  function parseKey(text) {
    const minor = text.endsWith('m');
    const root = Theory.parseNote(minor ? text.slice(0, -1) : text);
    return root ? { root, minor } : null;
  }

  // Shift a chord by semitones (used to transpose progressions written with chord names).
  function transposeChord(chord, semis) {
    if (!semis) return chord;
    const shift = pc => Theory.rootByPc(pc + semis + 12);
    return Theory.buildChord(shift(chord.root.pc), chord.type, chord.bass === null ? null : shift(chord.bass));
  }

  // Returns { bars: [[chord, ...], ...], errors: [token, ...], usesNumerals, usesNames }.
  function parse(text, key, transpose = 0) {
    const bars = [];
    const errors = [];
    let usesNumerals = false, usesNames = false;
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const barTexts = cleaned.includes('|')
      ? cleaned.split('|').map(s => s.trim()).filter(Boolean)
      : cleaned.split(' ').filter(Boolean);
    for (const barText of barTexts) {
      if (barText === '%') {
        if (bars.length) bars.push([...bars[bars.length - 1]]);
        continue;
      }
      const chords = [];
      for (const token of barText.split(' ')) {
        // Chord names start with A-G; roman numerals never do, so there's no ambiguity.
        let chord = null;
        if (/^[A-G]/.test(token)) {
          chord = Theory.parseChord(token);
          if (chord) { chord = transposeChord(chord, transpose); usesNames = true; }
        } else {
          chord = Theory.parseRoman(token, key);
          if (chord) usesNumerals = true;
        }
        if (chord) chords.push(chord);
        else errors.push(token);
      }
      if (chords.length) bars.push(chords);
    }
    return { bars, errors, usesNumerals, usesNames };
  }

  // Flatten bars into timed events: { chord, bar, beat (start), beats (length), first (new chord) }.
  function events(bars, beatsPerBar) {
    const out = [];
    bars.forEach((bar, b) => {
      const each = beatsPerBar / bar.length;
      bar.forEach((chord, i) => {
        const prev = out[out.length - 1];
        out.push({ chord, bar: b, beat: b * beatsPerBar + i * each, beats: each, change: !prev || prev.chord.key !== chord.key });
      });
    });
    return out;
  }

  return { PRESETS, parseKey, parse, events, transposeChord };
})();

if (typeof module !== 'undefined') module.exports = Progressions;
