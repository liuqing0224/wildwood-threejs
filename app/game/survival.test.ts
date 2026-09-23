import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enclosedShelter, comfortAfter, randomWeather } from './survival.ts';
import { initialSnapshot, validSave, type Block } from './model.ts';

function room(): Block[] {
  const blocks: Block[] = [];
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) {
      if (Math.abs(x) === 2 || Math.abs(z) === 2)
        blocks.push({
          id: blocks.length,
          kind: x === 0 && z === 2 ? 'door' : 'wall',
          x,
          z,
          rotation: 0,
          hp: 100,
        });
      blocks.push({
        id: blocks.length,
        kind: 'roof',
        x,
        z,
        rotation: 0,
        hp: 100,
      });
    }
  return blocks;
}
test('shelter requires a roof and enclosed walls, with an intact door', () => {
  const blocks = room();
  assert.equal(enclosedShelter(blocks).length, 8);
  assert.equal(
    enclosedShelter(blocks.filter((b) => b.kind !== 'door')).length,
    0,
  );
  assert.equal(
    enclosedShelter(blocks.filter((b) => b.kind !== 'wall')).length,
    0,
  );
  assert.equal(
    enclosedShelter(
      blocks.filter((b) => !(b.kind === 'roof' && b.x === 1 && b.z === 1)),
    ).length,
    7,
  );
  assert.equal(
    enclosedShelter(blocks.filter((b) => b.kind !== 'roof')).length,
    0,
  );
});
test('weather chooses a different state and bounded randomized duration', () => {
  for (const current of ['clear', 'rain', 'storm'] as const)
    for (const n of [0, 0.4, 0.999]) {
      const next = randomWeather(current, () => n);
      assert.notEqual(next.weather, current);
      assert.ok(next.duration >= 45 && next.duration <= 120);
    }
});
test('storm exposure is stronger than rain; shelter restores comfort and clamps', () => {
  assert.ok(
    comfortAfter(100, 'storm', false, 10) <
      comfortAfter(100, 'rain', false, 10),
  );
  assert.equal(comfortAfter(50, 'storm', true, 10), 100);
  assert.equal(comfortAfter(5, 'storm', false, 100), 0);
});
test('agent save fields validate while old v1 saves still load', () => {
  const state = initialSnapshot();
  const save = { version: 1, state, blocks: room(), depleted: [], rotation: 0 };
  assert.ok(validSave(save));
  for (const patch of [
    { agentEnabled: 'yes' },
    { agentGoal: 'fake' },
    { comfort: NaN },
    { comfort: -1 },
    { weatherRemaining: Infinity },
    { daySeconds: 0 },
  ]) {
    assert.equal(validSave({ ...save, state: { ...state, ...patch } }), false);
  }
  const legacy: Record<string, unknown> = { ...state };
  for (const key of [
    'agentEnabled',
    'agentGoal',
    'agentStatus',
    'comfort',
    'sheltered',
    'defending',
    'weatherRemaining',
    'daySeconds',
  ])
    delete legacy[key];
  assert.ok(validSave({ ...save, state: legacy }));
});
