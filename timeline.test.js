import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, BEEP_LENGTH, clampSettings, buildSegments, buildCues } from './timeline.js';

const voice = JSON.parse(readFileSync(new URL('./voice.json', import.meta.url)));
const lengths = Object.fromEntries(Object.entries(voice).map(([name, [, length]]) => [name, length]));

const plan = (settings) => {
  const s = { ...DEFAULTS, ...settings };
  const segments = buildSegments(s);
  return { segments, cues: buildCues(segments, s, lengths) };
};
const spoken = (cues) => cues.filter((c) => c.clip).map((c) => c.clip);

test('default Tabata is 4 minutes: prepare, 8 work, 7 rest', () => {
  const { segments } = plan();
  assert.equal(segments.length, 16);
  assert.deepEqual(segments.slice(0, 3).map((x) => x.kind), ['prepare', 'work', 'rest']);
  assert.equal(segments.at(-1).kind, 'work');
  assert.equal(segments.at(-1).end, 10 + 8 * 20 + 7 * 10);
});

test('two sets have one long rest between them', () => {
  const { segments } = plan({ sets: 2 });
  const setRests = segments.filter((x) => x.kind === 'setRest');
  assert.equal(setRests.length, 1);
  assert.equal(setRests[0].end - setRests[0].start, 60);
  assert.deepEqual([setRests[0].set, setRests[0].round], [2, 1]);
  assert.equal(segments.at(-1).end, 10 + 2 * (8 * 20 + 7 * 10) + 60);
});

test('a setting of 0 seconds makes no segment', () => {
  const { segments } = plan({ prepare: 0, rest: 0 });
  assert.equal(segments.length, 8);
  assert.ok(segments.every((x) => x.kind === 'work'));
});

test('voice says get ready, names each round before it starts, then go, rest and done', () => {
  const { cues } = plan();
  assert.deepEqual(spoken(cues).slice(0, 5), ['get_ready', 'round_1', 'go', 'rest', 'round_2']);
  assert.deepEqual(spoken(cues).slice(-3), ['last_round', 'go', 'done']);
  assert.equal(cues.find((c) => c.clip === 'go').t, 10);
  assert.equal(cues.find((c) => c.clip === 'rest').t, 30);
  assert.deepEqual(cues.at(-1), { t: 240, clip: 'done' });
});

test('three beeps before each change', () => {
  const beeps = plan().cues.filter((c) => c.beep).map((c) => c.t);
  assert.equal(beeps.length, 16 * 3);
  assert.deepEqual(beeps.slice(0, 6), [7, 8, 9, 27, 28, 29]);
});

test('the second set is named before it starts', () => {
  const names = spoken(plan({ sets: 2 }).cues);
  assert.equal(names[names.indexOf('set_2') + 1], 'go');
});

test('with no room in the rest, the work segment names the round itself', () => {
  for (const rest of [0, 2]) {
    const { cues } = plan({ rest });
    assert.equal(cues.find((c) => c.clip === 'round_2').t, 10 + 20 + rest);
    assert.equal(spoken(cues).filter((c) => c === 'go').length, 1);
  }
});

test('all clips exist and no two sounds overlap', () => {
  const cases = [{}, { rest: 0 }, { rest: 1 }, { rest: 2 }, { prepare: 0 }, { prepare: 3 },
    { sets: 3, setRest: 0 }, { work: 5, rest: 1, rounds: 30, sets: 10 }, { work: 5, rest: 0, rounds: 30 }];
  for (const settings of cases) {
    const { cues } = plan(settings);
    for (const c of cues) if (c.clip) assert.ok(c.clip in lengths, `no clip ${c.clip}`);
    for (let i = 1; i < cues.length; i++) {
      const a = cues[i - 1];
      const end = a.t + (a.beep ? BEEP_LENGTH : lengths[a.clip]);
      assert.ok(cues[i].t >= end, `${JSON.stringify(settings)}: ${a.clip ?? 'beep'} at ${a.t} overlaps the next sound`);
    }
  }
});

test('clampSettings keeps values in limits and uses defaults for bad input', () => {
  assert.deepEqual(
    clampSettings({ prepare: '', work: '3', rest: '-5', rounds: '99', sets: '2.6', setRest: 'abc' }),
    { prepare: 10, work: 5, rest: 0, rounds: 30, sets: 3, setRest: 60 },
  );
});
