import pathfinding from 'javascript-astar';
import type { Block } from './model';

export type Cell = { x: number; z: number };
const OFFSET = 17;
export function walkable(
  cell: Cell,
  blocks: Block[],
  obstacles: Cell[],
): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.z) &&
    cell.x >= -17 &&
    cell.x <= 6 &&
    Math.abs(cell.z) <= 17 &&
    !(cell.x === 0 && cell.z === 0) &&
    !blocks.some(
      (b) =>
        b.x === cell.x &&
        b.z === cell.z &&
        !['floor', 'roof', 'door', 'rug'].includes(b.kind),
    ) &&
    !obstacles.some((o) => o.x === cell.x && o.z === cell.z)
  );
}
export function residentPath(
  from: Cell,
  to: Cell,
  blocks: Block[],
  obstacles: Cell[],
  closest = false,
): Cell[] {
  if (
    !Number.isInteger(to.x) ||
    !Number.isInteger(to.z) ||
    Math.abs(to.x) > 17 ||
    Math.abs(to.z) > 17
  )
    return [];
  if (!walkable(to, blocks, obstacles) && !closest) return [];
  const grid = Array.from({ length: 35 }, (_, x) =>
    Array.from({ length: 35 }, (_, z) =>
      walkable({ x: x - OFFSET, z: z - OFFSET }, blocks, obstacles) ? 1 : 0,
    ),
  );
  const sx = Math.max(0, Math.min(34, from.x + OFFSET)),
    sz = Math.max(0, Math.min(34, from.z + OFFSET));
  grid[sx][sz] = 1;
  const graph = new pathfinding.Graph(grid, { diagonal: false });
  return pathfinding.astar
    .search(
      graph,
      graph.grid[sx][sz],
      graph.grid[to.x + OFFSET][to.z + OFFSET],
      { closest },
    )
    .map((node) => ({ x: node.x - OFFSET, z: node.y - OFFSET }));
}
