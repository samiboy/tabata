// Tabata timer page. All sounds use the Web Audio API. Chrome does not ask Android for
// audio focus for Web Audio, so music and podcasts in other apps keep playing.
import { DEFAULTS, LIMITS, BEEP_LENGTH, clampSettings, buildSegments, buildCues } from './timeline.js';

const LOOKAHEAD = 120;  // seconds of sound to schedule ahead, so that slow background timers miss no cue
const LEAD = 0.5;       // seconds from Start to the first sound
const LABELS = { prepare: 'Get ready', work: 'Work', rest: 'Rest', setRest: 'Set rest', done: 'Done' };
const KEYS = Object.keys(DEFAULTS);
const $ = (id) => document.getElementById(id);
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

let settings = loadSettings();
let voice;            // { clips, buffer }: all voice clips in one AudioBuffer, see tools/make_voice.py
let run = null;       // the workout in progress
let wakeLock = null;

function loadSettings() {
  try {
    return clampSettings({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings')) });
  } catch {
    return { ...DEFAULTS };
  }
}

function showSettings() {
  for (const key of KEYS) {
    $(key).min = LIMITS[key][0];
    $(key).max = LIMITS[key][1];
    $(key).value = settings[key];
  }
  $('row-setRest').hidden = settings.sets === 1;
  $('total').textContent = `Total ${mmss(buildSegments(settings).at(-1).end)}`;
}

const voiceReady = Promise.all([
  fetch('voice.json').then((r) => r.json()),
  fetch('voice.mp3').then((r) => r.arrayBuffer()),
]).then(async ([clips, data]) => {
  // An AudioBuffer can play in any AudioContext, so decode it one time, here.
  voice = { clips, buffer: await new OfflineAudioContext(1, 1, 24000).decodeAudioData(data) };
});

async function start() {
  $('start').disabled = true;
  const ctx = new AudioContext({ latencyHint: 'playback' });
  await ctx.resume();
  const segments = buildSegments(settings);
  const lengths = Object.fromEntries(Object.entries(voice.clips).map(([name, [, length]]) => [name, length]));
  run = {
    ctx,
    segments,
    s: settings,
    cues: buildCues(segments, settings, lengths),
    end: segments.at(-1).end,
    t0: ctx.currentTime + LEAD,
    next: 0,      // index of the next cue to schedule
    seg: 0,       // index of the segment on the screen
    view: '',
    paused: false,
    done: false,
    timer: setInterval(schedule, 1000),
  };
  $('pause').hidden = false;
  $('pause').textContent = 'Pause';
  $('stop').textContent = 'Stop';
  document.body.classList.add('running');
  keepScreenOn(true);
  loop();
}

function loop() {
  if (!run) return;
  schedule();
  draw();
  if (!run.done) requestAnimationFrame(loop);
}

// Put the sounds of the next LOOKAHEAD seconds on the audio clock. The audio clock plays them
// on time, also when Chrome slows down the timers of this page.
function schedule() {
  if (!run || run.done) return;
  const { ctx, cues, t0 } = run;
  const now = ctx.currentTime;
  while (run.next < cues.length && t0 + cues[run.next].t < now + LOOKAHEAD) {
    const cue = cues[run.next++];
    const when = t0 + cue.t;
    if (when < now - 0.5) continue;  // too late, for example after the phone was asleep
    if (cue.beep) beep(ctx, when);
    else say(ctx, cue.clip, when);
  }
  if (now > t0 + run.end + 3) finish();
}

function say(ctx, clip, when) {
  const [offset, length] = voice.clips[clip];
  const source = ctx.createBufferSource();
  source.buffer = voice.buffer;
  source.connect(ctx.destination);
  source.start(when, offset, length);
}

function beep(ctx, when) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.5, when);
  gain.gain.setValueAtTime(0.5, when + BEEP_LENGTH - 0.02);
  gain.gain.linearRampToValueAtTime(0, when + BEEP_LENGTH);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + BEEP_LENGTH);
}

function draw() {
  const { ctx, segments, s, end } = run;
  const t = Math.max(0, ctx.currentTime - (ctx.outputLatency || 0) - run.t0);  // the time you hear now
  let kind = 'done';
  let clock = mmss(end);
  let info = 'Workout complete';
  let left = '';
  if (t < end) {
    while (t >= segments[run.seg].end) run.seg++;
    const seg = segments[run.seg];
    const sec = Math.ceil(seg.end - t);
    kind = seg.kind;
    clock = sec < 60 ? String(sec) : mmss(sec);
    info = `${kind === 'work' ? '' : 'Next: '}Round ${seg.round} / ${s.rounds}`;
    if (s.sets > 1) info += ` · Set ${seg.set} / ${s.sets}`;
    left = `Total left ${mmss(Math.ceil(end - t))}`;
  }
  const view = [kind, clock, info, left].join('|');
  if (view === run.view) return;
  run.view = view;
  document.body.dataset.phase = kind;
  $('phase').textContent = LABELS[kind];
  $('clock').textContent = clock;
  $('clock').classList.toggle('long', clock.length > 2);
  $('info').textContent = info;
  $('left').textContent = left;
  if (kind === 'done') {
    $('pause').hidden = true;
    $('stop').textContent = 'Back';
  }
}

function finish() {
  clearInterval(run.timer);
  run.ctx.close();
  run.done = true;
  keepScreenOn(false);
}

async function togglePause() {
  run.paused = !run.paused;
  $('pause').textContent = run.paused ? 'Resume' : 'Pause';
  document.body.classList.toggle('paused', run.paused);
  keepScreenOn(!run.paused);
  // Suspend stops the audio clock, so the sounds already on it move with it.
  if (run.paused) await run.ctx.suspend();
  else await run.ctx.resume();
}

function stop() {
  if (document.body.dataset.phase !== 'done' && !confirm('Stop the workout?')) return;
  clearInterval(run.timer);
  if (run.ctx.state !== 'closed') run.ctx.close();
  run = null;
  keepScreenOn(false);
  document.body.classList.remove('running', 'paused');
  delete document.body.dataset.phase;
  $('start').disabled = false;
}

async function keepScreenOn(on) {
  try {
    if (!on) {
      await wakeLock?.release();
      wakeLock = null;
    } else if (!wakeLock || wakeLock.released) {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    }
  } catch {
    wakeLock = null;  // no Wake Lock API, or the page is hidden
  }
}

// Android releases the wake lock when the page is hidden. When the page is back, take it again and catch up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !run || run.done || run.paused) return;
  keepScreenOn(true);
  if (run.ctx.state !== 'running') run.ctx.resume().catch(() => {});
  schedule();
});

$('settings').addEventListener('submit', (e) => e.preventDefault());
$('settings').addEventListener('change', () => {
  settings = clampSettings(Object.fromEntries(KEYS.map((key) => [key, $(key).value])));
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch {}
  showSettings();
});
$('start').addEventListener('click', start);
$('pause').addEventListener('click', togglePause);
$('stop').addEventListener('click', stop);

showSettings();
voiceReady.then(
  () => {
    $('start').disabled = false;
    $('start').textContent = 'Start';
  },
  () => { $('error').hidden = false; },
);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
