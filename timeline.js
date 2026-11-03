// Workout plan: segments and the sounds to play. No DOM and no audio here, so the tests can use it.

export const DEFAULTS = { prepare: 10, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60 };

// [min, max] for each setting. Keep MAX_ROUNDS and MAX_SETS in tools/make_voice.py the same.
export const LIMITS = {
  prepare: [0, 600], work: [5, 600], rest: [0, 600],
  rounds: [1, 30], sets: [1, 10], setRest: [0, 600],
};

export const BEEP_LENGTH = 0.15;
const BEEPS = 3;    // countdown beeps before each change
const GAP = 0.2;    // minimum silence between two sounds, in seconds

export function clampSettings(input) {
  const s = {};
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = input[key] === '' ? NaN : Math.round(Number(input[key]));
    s[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULTS[key];
  }
  return s;
}

// Each segment is { kind, start, end, set, round } in seconds from the start.
// For prepare and rest segments, set and round tell which work segment comes next.
export function buildSegments(s) {
  const segments = [];
  let t = 0;
  const add = (kind, duration, set, round) => {
    if (duration > 0) segments.push({ kind, start: t, end: t + duration, set, round });
    t += duration;
  };
  add('prepare', s.prepare, 1, 1);
  for (let set = 1; set <= s.sets; set++) {
    for (let round = 1; round <= s.rounds; round++) {
      add('work', s.work, set, round);
      if (round < s.rounds) add('rest', s.rest, set, round + 1);
      else if (set < s.sets) add('setRest', s.setRest, set + 1, 1);
    }
  }
  return segments;
}

// The voice clip that names a work segment.
export function announcement(seg, s) {
  if (seg.round === 1 && seg.set > 1) return `set_${seg.set}`;
  if (seg.round === s.rounds && s.rounds > 1) return 'last_round';
  return `round_${seg.round}`;
}

// Sounds to play, sorted by time: { t, clip } for a voice clip, { t, beep: true } for a beep.
// clipLength gives the length of each voice clip in seconds.
export function buildCues(segments, s, clipLength) {
  const cues = [];
  const announced = new Set();
  segments.forEach((seg, i) => {
    let clip = seg.kind === 'prepare' ? 'get_ready' : 'rest';
    // A work segment starts with "Go!" if the segment before named the round. If not, it names the round itself.
    if (seg.kind === 'work') clip = announced.has(i) ? 'go' : announcement(seg, s);
    cues.push({ t: seg.start, clip });
    const free = seg.start + clipLength[clip] + GAP;

    const beeps = [];
    for (let k = BEEPS; k >= 1; k--) if (seg.end - k >= free) beeps.push(seg.end - k);

    const next = segments[i + 1];
    if (seg.kind !== 'work' && next?.kind === 'work') {
      const name = announcement(next, s);
      const t = (beeps[0] ?? seg.end) - GAP - clipLength[name];
      if (t >= free) {
        cues.push({ t, clip: name });
        announced.add(i + 1);
      }
    }
    for (const t of beeps) cues.push({ t, beep: true });
  });
  cues.push({ t: segments.at(-1).end, clip: 'done' });
  return cues.sort((a, b) => a.t - b.t);
}
