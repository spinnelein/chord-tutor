'use strict';

// Practice history per chord, and the "smart" choice of which chord to ask next.
//
// Every attempt is recorded against a key of root + type + inversion. A chord's level comes from
// its last 10 attempts: how often it was right, and the median time of the clean correct ones
// (no notes shown). The picker weights each chord by how much it needs practice:
//   - wrong answers and slow times raise the weight; mastered chords drop to a low weight;
//   - chords not seen for a while slowly come back (spaced review);
//   - new chords are introduced a few at a time: while 5 or more are still being learned,
//     unseen chords are rarely picked, so you work on a small set until it sticks;
//   - the chord just asked is never repeated, and the last few are less likely.

const Progress = (() => {
  const STORAGE_KEY = 'chordTutorProgress';
  const KEEP = 20;          // attempts stored per chord
  const WINDOW = 10;        // attempts used to judge a chord
  const MAX_TIME = 30;      // seconds; longer times (walked away?) are capped
  const WORKING_SET = 5;    // chords being learned before new ones are held back
  const LEVELS = ['New', 'Learning', 'Getting there', 'Good', 'Mastered'];

  let data = { chords: {}, sessions: [] };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.chords) data = { sessions: [], ...saved };
    } catch { /* storage unavailable: progress lasts for this session only */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { }
  }

  const keyFor = chord => `${chord.root.pc}:${chord.type.id}:${chord.inversion ?? 'any'}`;

  // result: { ok, time (seconds, when ok), hint (notes were shown), skip }
  function record(chord, result) {
    const key = keyFor(chord);
    const entry = data.chords[key] ??= { results: [] };
    entry.results.push({
      ok: !!result.ok,
      t: result.ok ? Math.round(Math.min(result.time, MAX_TIME) * 100) / 100 : null,
      hint: !!result.hint,
      skip: !!result.skip,
      at: Date.now(),
    });
    if (entry.results.length > KEEP) entry.results.splice(0, entry.results.length - KEEP);
    save();
  }

  const median = xs => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  // Summary of a list of attempts (oldest first).
  function summarize(results, goal) {
    const recent = results.slice(-WINDOW);
    const tries = recent.length;
    const correct = recent.filter(r => r.ok).length;
    const acc = tries ? correct / tries : 0;
    const time = median(recent.filter(r => r.ok && !r.hint).map(r => r.t));
    let level = 0;
    if (tries) {
      if (tries >= 5 && acc >= 0.9 && time !== null && time <= goal) level = 4;
      else if (tries >= 3 && acc >= 0.8 && time !== null && time <= goal * 1.5) level = 3;
      else if (acc >= 0.6) level = 2;
      else level = 1;
    }
    const lastAt = results.length ? results[results.length - 1].at : null;
    return { tries, correct, acc, time, level, lastAt, total: results.length };
  }

  const statsFor = (chord, goal) => summarize(data.chords[keyFor(chord)]?.results ?? [], goal);

  // Stats for a root + chord type across all its inversions (for the progress grid).
  function statsForGroup(pc, typeId, goal) {
    const prefix = `${pc}:${typeId}:`;
    const parts = Object.entries(data.chords).filter(([k]) => k.startsWith(prefix));
    const all = parts.flatMap(([, e]) => e.results).sort((a, b) => a.at - b.at);
    const byInversion = parts.map(([k, e]) => ({ inversion: k.slice(prefix.length), ...summarize(e.results, goal) }));
    return { ...summarize(all, goal), byInversion };
  }

  function weight(s, goal, now) {
    const staleDays = s.lastAt ? (now - s.lastAt) / 86400000 : 0;
    const review = Math.min(1.5, staleDays * 0.5);
    if (s.level === 4) return 0.3 + review;
    const slow = s.time === null ? 1 : Math.min(2, Math.max(0, (s.time - goal) / goal));
    return 1 + 4 * (1 - s.acc) + 1.5 * slow + review;
  }

  // chords: candidate chord objects. recent: keys of the last few chords asked, newest last.
  function pick(chords, recent, goal) {
    const now = Date.now();
    const stats = chords.map(c => statsFor(c, goal));
    const learning = stats.filter(s => s.tries && s.level < 3).length;
    const newWeight = learning >= WORKING_SET ? 0.3 : 3;
    const weights = chords.map((c, i) => {
      const key = keyFor(c);
      let w = stats[i].tries ? weight(stats[i], goal, now) : newWeight;
      if (chords.length > 1 && key === recent[recent.length - 1]) w = 0;
      else if (recent.includes(key)) w *= 0.2;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < chords.length; i++) {
      r -= weights[i];
      if (r < 0) return chords[i];
    }
    return chords[chords.length - 1];
  }

  // Overall trend: the last 20 attempts against the 20 before them.
  function overview() {
    const all = Object.values(data.chords).flatMap(e => e.results).sort((a, b) => a.at - b.at);
    const block = rs => {
      const clean = rs.filter(r => r.ok && !r.hint).map(r => r.t);
      return rs.length ? { acc: rs.filter(r => r.ok).length / rs.length, time: median(clean), n: rs.length } : null;
    };
    return { total: all.length, last: block(all.slice(-20)), before: block(all.slice(-40, -20)) };
  }

  // Everything attempted since `start` (a Date.now() timestamp), per chord and overall.
  // `before` is the chord's median time from its attempts before the session, for comparison.
  function sessionReport(start) {
    const cleanTime = rs => median(rs.filter(r => r.ok && !r.hint).map(r => r.t));
    const chords = [];
    for (const [key, e] of Object.entries(data.chords)) {
      const during = e.results.filter(r => r.at >= start);
      if (!during.length) continue;
      const before = e.results.filter(r => r.at < start).slice(-WINDOW);
      chords.push({
        key,
        tries: during.length,
        correct: during.filter(r => r.ok).length,
        time: cleanTime(during),
        before: cleanTime(before),
      });
    }
    const all = Object.values(data.chords).flatMap(e => e.results).filter(r => r.at >= start);
    return { attempts: all.length, correct: all.filter(r => r.ok).length, time: cleanTime(all), chords };
  }

  function saveSession(summary) {
    data.sessions.push(summary);
    if (data.sessions.length > 50) data.sessions.splice(0, data.sessions.length - 50);
    save();
  }

  const lastSession = () => data.sessions[data.sessions.length - 1] ?? null;

  function reset() {
    data = { chords: {}, sessions: [] };
    save();
  }

  return { load, record, keyFor, statsFor, statsForGroup, pick, overview, sessionReport, saveSession, lastSession, reset, LEVELS };
})();

if (typeof module !== 'undefined') module.exports = Progress;
