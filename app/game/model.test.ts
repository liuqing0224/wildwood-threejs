import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canPlace,
  CATALOG,
  initialSnapshot,
  validSave,
  type Block,
} from './model.ts';
const wall: Block = { id: 1, kind: 'wall', x: 3, z: 3, hp: 150, rotation: 0 };
test('construction rejects river, out-of-bounds, core and fractional cells', () => {
  for (const [x, z] of [
    [7, 0],
    [10, 0],
    [0, 0],
    [1.5, 2],
  ])
    assert.ok(canPlace([], 'wall', x, z));
});
test('roof requires wall or door, and duplicate occupancy is rejected', () => {
  assert.ok(canPlace([], 'roof', 3, 3));
  assert.equal(canPlace([wall], 'roof', 3, 3), null);
  assert.ok(canPlace([wall], 'wall', 3, 3));
  assert.ok(canPlace([wall], 'tower', 3, 3));
  assert.equal(canPlace([wall], 'floor', 3, 3), null);
});
test('floor supports a new wall while free sites accept towers and fences', () => {
  assert.equal(canPlace([{ ...wall, kind: 'floor' }], 'wall', 3, 3), null);
  assert.equal(canPlace([], 'tower', -4, 4), null);
  assert.equal(canPlace([], 'fence', -4, 4), null);
});
test('new game has enough resources for every build option and a grace period', () => {
  const s = initialSnapshot();
  for (const item of Object.values(CATALOG)) {
    assert.ok(s.wood >= item.wood);
    assert.ok(s.stone >= item.stone);
  }
  assert.ok(s.nextRaid >= 100);
  assert.equal(s.health, 100);
});
test('save validation accepts versioned state and rejects corrupt data', () => {
  const save = {
    version: 1,
    state: initialSnapshot(),
    blocks: [wall],
    depleted: ['tree-1'],
    rotation: 0,
  };
  assert.equal(validSave(save), true);
  assert.equal(validSave({ ...save, version: 2 }), false);
  assert.equal(
    validSave({ ...save, state: { ...save.state, wood: -1 } }),
    false,
  );
  assert.equal(
    validSave({ ...save, state: { ...save.state, hour: NaN } }),
    false,
  );
  assert.equal(
    validSave({ ...save, blocks: [{ ...wall, kind: 'unknown' }] }),
    false,
  );
  assert.equal(
    validSave({ ...save, blocks: [{ ...wall, x: Infinity }] }),
    false,
  );
  assert.equal(validSave({ ...save, depleted: [null] }), false);
  assert.equal(validSave(null), false);
});
