import type { Block, Weather } from './model';

export type ShelterCell = { x: number; z: number };
const key = (x: number, z: number) => `${x},${z}`;
export const neighbors = ({ x, z }: ShelterCell): ShelterCell[] => [
  { x: x + 1, z },
  { x: x - 1, z },
  { x, z: z + 1 },
  { x, z: z - 1 },
];

// Flood from outdoors: a roof alone is not an enclosed room. Doors seal the
// weather boundary but remain traversable in the resident's navigation graph.
export function enclosedShelter(blocks: Block[]): ShelterCell[] {
  const barriers = new Set(
    blocks
      .filter((b) => b.kind === 'wall' || b.kind === 'door')
      .map((b) => key(b.x, b.z)),
  );
  const outside = new Set<string>([key(-10, -10)]);
  const queue: ShelterCell[] = [{ x: -10, z: -10 }];
  for (let i = 0; i < queue.length; i++) {
    for (const p of neighbors(queue[i])) {
      const id = key(p.x, p.z);
      if (
        Math.abs(p.x) > 10 ||
        Math.abs(p.z) > 10 ||
        barriers.has(id) ||
        outside.has(id)
      )
        continue;
      outside.add(id);
      queue.push(p);
    }
  }
  return blocks
    .filter(
      (b) =>
        b.kind === 'roof' &&
        !outside.has(key(b.x, b.z)) &&
        !barriers.has(key(b.x, b.z)) &&
        (b.x !== 0 || b.z !== 0),
    )
    .map((b) => ({ x: b.x, z: b.z }));
}

export function randomWeather(
  current: Weather,
  random = Math.random,
): { weather: Weather; duration: number } {
  const options: Record<Weather, Weather[]> = {
    clear: ['rain', 'rain', 'storm'],
    rain: ['clear', 'clear', 'storm'],
    storm: ['clear', 'rain', 'rain'],
  };
  return {
    weather: options[current][Math.min(2, Math.floor(random() * 3))],
    duration: 45 + random() * 75,
  };
}

export function comfortAfter(
  comfort: number,
  weather: Weather,
  sheltered: boolean,
  dt: number,
): number {
  const rate = sheltered
    ? 5
    : weather === 'storm'
      ? -2
      : weather === 'rain'
        ? -0.7
        : 0.6;
  return Math.max(0, Math.min(100, comfort + rate * dt));
}
