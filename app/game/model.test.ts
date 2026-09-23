import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canPlace,
  CATALOG,
  initialSnapshot,
  validSave,
  normalizeRotation,
  snapRotation,
  craftFurniture,
  furnitureRecipeError,
  FURNITURE,
  type FurnitureKind,
  type Block,
} from './model.ts';
const wall: Block = { id: 1, kind: 'wall', x: 3, z: 3, hp: 150, rotation: 0 };
test('each furniture recipe consumes exact materials and creates one finished item', () => {
  for (const kind of Object.keys(FURNITURE) as FurnitureKind[]) {
    const s = initialSnapshot();
    s.fiber = 20;
    const cost = FURNITURE[kind];
    assert.equal(craftFurniture(s, kind), true);
    assert.deepEqual(
      [s.wood, s.stone, s.fiber],
      [240 - cost.wood, 120 - cost.stone, 20 - cost.fiber],
    );
    assert.equal(s.furnitureStock[kind], 1);
    assert.equal(s.crafted, 1);
  }
});
test('missing resources and full stock never partially debit a recipe', () => {
  const s = initialSnapshot();
  assert.match(furnitureRecipeError(s, 'bed')!, /12 纤维/);
  const before = structuredClone(s);
  assert.equal(craftFurniture(s, 'bed'), false);
  assert.deepEqual(s, before);
  s.fiber = 100;
  s.furnitureStock.bed = 999;
  const full = structuredClone(s);
  assert.equal(craftFurniture(s, 'bed'), false);
  assert.deepEqual(s, full);
});
test('furniture requires floor, tolerates roof and rug, rejects occupied sites', () => {
  const floor: Block = { ...wall, kind: 'floor' };
  const roof: Block = { ...wall, kind: 'roof', id: 2 };
  const bed: Block = { ...wall, kind: 'bed', id: 3 };
  const rug: Block = { ...wall, kind: 'rug', id: 4 };
  assert.ok(canPlace([], 'bed', 3, 3));
  assert.equal(canPlace([floor, roof], 'bed', 3, 3), null);
  assert.equal(canPlace([floor, roof, rug], 'bed', 3, 3), null);
  assert.equal(canPlace([floor, roof, bed], 'rug', 3, 3), null);
  assert.ok(canPlace([floor, bed], 'chair', 3, 3));
  assert.ok(canPlace([floor, wall], 'bed', 3, 3));
  assert.ok(canPlace([floor, rug], 'rug', 3, 3));
});
test('furniture save fields remain optional for v1 and reject malformed inventories', () => {
  const save = {
    version: 1,
    state: initialSnapshot(),
    blocks: [{ ...wall, kind: 'bed' }],
    depleted: [],
    rotation: 0,
  };
  assert.ok(validSave(save));
  const { fiber, furnitureStock, crafted, ...old } = save.state;
  assert.ok(validSave({ ...save, state: old }));
  assert.ok(
    validSave({ ...save, state: { ...old, furnitureStock: { bed: 2 } } }),
  );
  for (const stock of [
    null,
    [],
    { bed: -1 },
    { bed: 0.5 },
    { bed: Infinity },
    { fake: 2 },
  ])
    assert.equal(
      validSave({ ...save, state: { ...old, furnitureStock: stock } }),
      false,
    );
  assert.equal(validSave({ ...save, state: { ...old, fiber: -1 } }), false);
  assert.equal(validSave({ ...save, state: { ...old, crafted: NaN } }), false);
});
test('rotation wraps full turns and snaps pointer controls to quarter turns', () => {
  let rotation = 0;
  for (const expected of [Math.PI / 2, Math.PI, Math.PI * 1.5, 0]) {
    rotation = normalizeRotation(rotation + Math.PI / 2);
    assert.equal(rotation, expected);
  }
  assert.equal(normalizeRotation(-Math.PI / 2), Math.PI * 1.5);
  assert.equal(normalizeRotation(Math.PI / 4), Math.PI / 4);
  assert.equal(normalizeRotation((359 * Math.PI) / 180), (359 * Math.PI) / 180);
  assert.equal(normalizeRotation(Math.PI * 2), 0);
  assert.equal(snapRotation((44 * Math.PI) / 180), 0);
  assert.equal(snapRotation((46 * Math.PI) / 180), Math.PI / 2);
  assert.equal(snapRotation((259 * Math.PI) / 180), Math.PI * 1.5);
  const save = {
    version: 1,
    state: initialSnapshot(),
    rotation: Math.PI / 2,
    blocks: [{ ...wall, rotation: Math.PI / 2 }],
    depleted: [],
  };
  assert.ok(validSave(JSON.parse(JSON.stringify(save))));
  assert.equal(
    JSON.parse(JSON.stringify(save)).blocks[0].rotation,
    Math.PI / 2,
  );
});
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
  assert.equal(validSave({ ...save, resident: { x: 2, z: 6 } }), true);
  assert.equal(validSave({ ...save, resident: { x: NaN, z: 6 } }), false);
  assert.equal(validSave({ ...save, resident: { x: 20, z: 6 } }), false);
  assert.equal(validSave({ ...save, resident: null }), false);
});
