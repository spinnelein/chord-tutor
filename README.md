# Chord Tutor

A browser-based chord trainer. It shows a chord name — C major, F♯m7, B♭/D — and you play it on
your instrument. It listens through a **USB MIDI keyboard** or your **microphone** (handy for
accordion, piano, or anything else with keys), tracks how fast and accurately you find each chord,
and keeps asking the ones you need to practise.

Everything runs in your browser. There's no account and no server; your progress is saved in your
own browser.

## Features

- **MIDI or microphone input.** The microphone detects up to four notes at once, with tuning
  controls and a live view of what it hears.
- **11 chord types** in all 12 keys: major, minor, diminished, augmented, sus2, sus4, maj7, 7, m7,
  m7♭5 and dim7.
- **Inversions.** Accept any voicing, or ask for root position, 1st, 2nd or 3rd inversion, with
  optional slash-chord names (Fm/A♭).
- **Staff notation.** See each chord on the treble staff, or hide the name and read it from the
  staff alone.
- **Name styles:** written out (C Major), abbreviated (Cmaj) or lead-sheet symbols (C, Cm, C°).
- **Smart practice order.** Weak and slow chords come up more often, new chords are introduced a
  few at a time, and mastered chords come back for occasional review.
- **Progress grid** showing your level and median time for every chord.
- **Timed sessions** (5–20 minutes) with a report comparing you with your last session.
- **Helpful feedback.** If you play the wrong chord, it tells you which chord you played.

## Using it

Open the app in **Chrome or Edge** (Firefox doesn't fully support MIDI), choose **Microphone** or
your MIDI device at the top right, and allow access when the browser asks.

Shortcuts: <kbd>Space</kbd> skip · <kbd>Enter</kbd> show/hide notes · <kbd>N</kbd> change name style.

**Microphone tips:** play in a quiet room, and turn off Windows audio enhancements (noise
suppression) for your mic if it struggles. If room noise shows up as notes, raise the *Noise gate*.
If overtones show up as extra notes, lower *Sensitivity*.

## Running it locally

No build step is needed. Download the repository and open `index.html` in Chrome or Edge. The
browser may ask for microphone permission each time when the page is opened from a file; the hosted
version remembers it.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page layout and styling |
| `app.js` | Chord theory, chord checking, MIDI, prompts, settings and progress view |
| `audio.js` | Microphone note detection |
| `progress.js` | Practice history, chord levels, the smart chord order and session reports |
| `lib/vexflow.js` | [VexFlow](https://www.vexflow.com) 4.2.2 for drawing the staff (MIT license) |

## License

[MIT](LICENSE). Free to use, change and share.
