export const CATALOG = {
  floor: {
    name: '木地板',
    wood: 6,
    stone: 0,
    hp: 100,
    description: '安稳的家，从脚下开始',
  },
  wall: {
    name: '木墙',
    wood: 10,
    stone: 0,
    hp: 150,
    description: '为家园挡住风雨与不速之客',
  },
  door: {
    name: '木门',
    wood: 12,
    stone: 0,
    hp: 120,
    description: '为归来的人留一扇门',
  },
  roof: {
    name: '瓦屋顶',
    wood: 8,
    stone: 6,
    hp: 130,
    description: '红瓦之下，总有一处心安',
  },
  fence: {
    name: '木栅栏',
    wood: 8,
    stone: 0,
    hp: 90,
    description: '把小小的家园围起来',
  },
  tower: {
    name: '守卫塔',
    wood: 20,
    stone: 15,
    hp: 220,
    description: '自动攻击周围 12 格内的怪物',
  },
} as const;
export type Kind = keyof typeof CATALOG;
export type Weather = 'clear' | 'rain' | 'storm';
export type Mode = 'build' | 'harvest' | 'repair' | 'remove';
export type Block = {
  id: number;
  kind: Kind;
  x: number;
  z: number;
  rotation: number;
  hp: number;
};
export type Snapshot = {
  wood: number;
  stone: number;
  health: number;
  hour: number;
  day: number;
  weather: Weather;
  autoWeather: boolean;
  paused: boolean;
  monsters: number;
  nextRaid: number;
  built: number;
  harvested: number;
  defeated: number;
  blocks: number;
  saved: boolean;
};
export function initialSnapshot(): Snapshot {
  return {
    wood: 240,
    stone: 120,
    health: 100,
    hour: 9,
    day: 1,
    weather: 'clear',
    autoWeather: true,
    paused: false,
    monsters: 0,
    nextRaid: 110,
    built: 0,
    harvested: 0,
    defeated: 0,
    blocks: 0,
    saved: false,
  };
}
export function canPlace(
  blocks: Block[],
  kind: Kind,
  x: number,
  z: number,
): string | null {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(z) ||
    Math.abs(x) > 9 ||
    Math.abs(z) > 9
  )
    return '请在营地范围内建造';
  if (x >= 7) return '河岸需要留出空间';
  if (x === 0 && z === 0) return '这里是家园核心';
  const cell = blocks.filter((b) => b.x === x && b.z === z);
  if (cell.some((b) => b.kind === kind)) return '这里已经有相同的部件了';
  if (kind === 'floor')
    return cell.some((b) => b.kind === 'tower' || b.kind === 'fence')
      ? '这里已被占用'
      : null;
  if (kind === 'roof')
    return cell.some((b) => b.kind === 'wall' || b.kind === 'door')
      ? null
      : '屋顶需要放在木墙或木门上';
  if (cell.some((b) => b.kind !== 'floor')) return '这里已被占用';
  return null;
}
export function validSave(
  value: unknown,
): value is {
  version: number;
  state: Snapshot;
  blocks: Block[];
  depleted: string[];
  rotation: number;
} {
  if (!value || typeof value !== 'object') return false;
  const v = value as {
    version?: number;
    state?: Snapshot;
    blocks?: Block[];
    depleted?: string[];
    rotation?: number;
  };
  if (
    v.version !== 1 ||
    !v.state ||
    !Array.isArray(v.blocks) ||
    v.blocks.length > 1000 ||
    !Array.isArray(v.depleted) ||
    !v.depleted.every((k) => typeof k === 'string') ||
    !Number.isFinite(v.rotation)
  )
    return false;
  const s = v.state;
  if (
    ![
      s.wood,
      s.stone,
      s.health,
      s.day,
      s.built,
      s.harvested,
      s.defeated,
      s.nextRaid,
    ].every((n) => Number.isFinite(n) && n >= 0) ||
    s.health > 100 ||
    !Number.isFinite(s.hour) ||
    s.hour < 0 ||
    s.hour >= 24 ||
    !['clear', 'rain', 'storm'].includes(s.weather) ||
    typeof s.autoWeather !== 'boolean'
  )
    return false;
  return v.blocks.every(
    (b) =>
      Object.hasOwn(CATALOG, b.kind) &&
      Number.isInteger(b.id) &&
      Number.isInteger(b.x) &&
      Math.abs(b.x) <= 9 &&
      Number.isInteger(b.z) &&
      Math.abs(b.z) <= 9 &&
      Number.isFinite(b.hp) &&
      b.hp > 0 &&
      Number.isFinite(b.rotation),
  );
}
