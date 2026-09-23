import assert from 'node:assert/strict';
import { test } from 'node:test';
import { residentPath, walkable } from './navigation.ts';
import type { Block } from './model.ts';
const wall: Block = { id: 1, kind: 'wall', x: 1, z: 1, hp: 150, rotation: 0 };
test('solid furniture blocks walking but rugs remain traversable', () => {
  for (const kind of ['bed', 'table', 'chair', 'chest', 'lamp'] as const)
    assert.equal(walkable(wall, [{ ...wall, kind }], []), false);
  assert.equal(walkable(wall, [{ ...wall, kind: 'rug' }], []), true);
});
test('resident goes around walls with cardinal steps, without cutting corners', () => {
  const path = residentPath({ x: 0, z: 1 }, { x: 2, z: 1 }, [wall], []);
  assert.deepEqual(path.at(-1), { x: 2, z: 1 });
  assert.ok(path.length > 2);
  let previous = { x: 0, z: 1 };
  for (const cell of path) {
    assert.ok(walkable(cell, [wall], []));
    assert.equal(
      Math.abs(cell.x - previous.x) + Math.abs(cell.z - previous.z),
      1,
    );
    previous = cell;
  }
});
test('river, core, resources and walls are not walking destinations', () => {
  for (const target of [
    { x: 7, z: 1 },
    { x: 0, z: 0 },
    { x: 1, z: 1 },
    { x: 2, z: 2 },
  ])
    assert.deepEqual(
      residentPath({ x: 0, z: 1 }, target, [wall], [{ x: 2, z: 2 }]),
      [],
    );
  assert.ok(walkable({ x: 1, z: 1 }, [{ ...wall, kind: 'door' }], []));
});
test('work approaches an occupied building without walking through it', () => {
  const route = residentPath({ x: 0, z: 2 }, { x: 1, z: 1 }, [wall], [], true);
  assert.ok(route.length);
  assert.notDeepEqual(route.at(-1), { x: 1, z: 1 });
  route.forEach((cell) => assert.ok(walkable(cell, [wall], [])));
});
