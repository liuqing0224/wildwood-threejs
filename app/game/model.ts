export const BUILDINGS = {
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
export const FURNITURE = {
  bed: {
    name: '木床',
    wood: 24,
    stone: 0,
    fiber: 12,
    hp: 100,
    description: '靠近床铺休息，更快恢复舒适度',
  },
  table: {
    name: '木桌',
    wood: 16,
    stone: 2,
    fiber: 0,
    hp: 90,
    description: '给小屋添一张结实的桌子',
  },
  chair: {
    name: '木椅',
    wood: 8,
    stone: 0,
    fiber: 2,
    hp: 65,
    description: '靠近座椅休息，额外恢复舒适度',
  },
  chest: {
    name: '木箱',
    wood: 18,
    stone: 4,
    fiber: 0,
    hp: 110,
    description: '带搭扣的木制收纳家具',
  },
  lamp: {
    name: '落地灯',
    wood: 6,
    stone: 6,
    fiber: 4,
    hp: 60,
    description: '为夜晚的小屋添一盏暖光',
  },
  rug: {
    name: '编织地毯',
    wood: 0,
    stone: 0,
    fiber: 10,
    hp: 50,
    description: '柔软的织物，可以铺在家具下面',
  },
} as const;
export const CATALOG = { ...BUILDINGS, ...FURNITURE };
export type FurnitureKind = keyof typeof FURNITURE;
export type Kind = keyof typeof CATALOG;
export function isFurniture(kind: Kind): kind is FurnitureKind {
  return Object.hasOwn(FURNITURE, kind);
}
export function emptyFurnitureStock(): Record<FurnitureKind, number> {
  return { bed: 0, table: 0, chair: 0, chest: 0, lamp: 0, rug: 0 };
}
export function furnitureRecipeError(
  resources: { wood: number; stone: number; fiber: number },
  kind: FurnitureKind,
): string | null {
  const cost = FURNITURE[kind];
  const names = { wood: '木材', stone: '石料', fiber: '纤维' };
  const missing = (['wood', 'stone', 'fiber'] as const)
    .filter((key) => resources[key] < cost[key])
    .map((key) => `${cost[key] - resources[key]} ${names[key]}`);
  return missing.length ? `缺少 ${missing.join(' · ')}` : null;
}
export function craftFurniture(
  state: Pick<
    Snapshot,
    'wood' | 'stone' | 'fiber' | 'furnitureStock' | 'crafted'
  >,
  kind: FurnitureKind,
): boolean {
  if (furnitureRecipeError(state, kind) || state.furnitureStock[kind] >= 999)
    return false;
  const cost = FURNITURE[kind];
  state.wood -= cost.wood;
  state.stone -= cost.stone;
  state.fiber -= cost.fiber;
  state.furnitureStock[kind]++;
  state.crafted++;
  return true;
}
export type Weather = 'clear' | 'rain' | 'storm';
export type Mode =
  | 'build'
  | 'harvest'
  | 'repair'
  | 'remove'
  | 'walk'
  | 'rotate';
export function normalizeRotation(rotation: number): number {
  const circle = Math.PI * 2;
  const wrapped = rotation % circle;
  return wrapped < 0 ? wrapped + circle : wrapped === 0 ? 0 : wrapped;
}
export function snapRotation(rotation: number): number {
  const quarterTurn = Math.PI / 2;
  return normalizeRotation(Math.round(rotation / quarterTurn) * quarterTurn);
}
export type AgentGoal = 'develop' | 'harvest' | 'repair';
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
  residentMood: string;
  residentActivity: string;
  agentEnabled: boolean;
  agentGoal: AgentGoal;
  agentStatus: string;
  comfort: number;
  sheltered: boolean;
  defending: boolean;
  weatherRemaining: number;
  daySeconds: number;
  buildRotation: number;
  editRotation: number | null;
  rotatingName: string;
  fiber: number;
  furnitureStock: Record<FurnitureKind, number>;
  crafted: number;
  interiorView: boolean;
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
    residentMood: '今天也想把家盖好',
    residentActivity: '在家园小憩',
    agentEnabled: false,
    agentGoal: 'develop',
    agentStatus: '手动控制',
    comfort: 100,
    sheltered: false,
    defending: false,
    weatherRemaining: 75,
    daySeconds: 300,
    buildRotation: 0,
    editRotation: null,
    rotatingName: '',
    fiber: 0,
    furnitureStock: emptyFurnitureStock(),
    crafted: 0,
    interiorView: false,
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
  if (isFurniture(kind)) {
    if (!cell.some((b) => b.kind === 'floor')) return '家具需要放在木地板上';
    if (
      cell.some(
        (b) =>
          !['floor', 'roof', 'rug'].includes(b.kind) &&
          !(kind === 'rug' && isFurniture(b.kind)),
      )
    )
      return '这里没有足够的家具空间';
    return null;
  }
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
export function validSave(value: unknown): value is {
  version: number;
  state: Snapshot;
  blocks: Block[];
  depleted: string[];
  rotation: number;
  resident?: { x: number; z: number };
} {
  if (!value || typeof value !== 'object') return false;
  const v = value as {
    version?: number;
    state?: Snapshot;
    blocks?: Block[];
    depleted?: string[];
    rotation?: number;
    resident?: { x: number; z: number };
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
  if (s.fiber !== undefined && (!Number.isFinite(s.fiber) || s.fiber < 0))
    return false;
  if (
    s.crafted !== undefined &&
    (!Number.isSafeInteger(s.crafted) || s.crafted < 0)
  )
    return false;
  if (
    s.furnitureStock !== undefined &&
    (!s.furnitureStock ||
      typeof s.furnitureStock !== 'object' ||
      Array.isArray(s.furnitureStock) ||
      !Object.entries(s.furnitureStock).every(
        ([kind, count]) =>
          Object.hasOwn(FURNITURE, kind) &&
          Number.isSafeInteger(count) &&
          count >= 0 &&
          count <= 100000,
      ))
  )
    return false;
  for (const key of ['sheltered', 'defending'] as const) {
    if (s[key] !== undefined && typeof s[key] !== 'boolean') return false;
  }
  for (const key of [
    'agentStatus',
    'residentActivity',
    'residentMood',
  ] as const) {
    if (
      s[key] !== undefined &&
      (typeof s[key] !== 'string' || s[key].length > 160)
    )
      return false;
  }
  if (
    (s.agentEnabled !== undefined && typeof s.agentEnabled !== 'boolean') ||
    (s.agentGoal !== undefined &&
      !['develop', 'harvest', 'repair'].includes(s.agentGoal)) ||
    (s.comfort !== undefined &&
      (!Number.isFinite(s.comfort) || s.comfort < 0 || s.comfort > 100)) ||
    (s.weatherRemaining !== undefined &&
      (!Number.isFinite(s.weatherRemaining) ||
        s.weatherRemaining < 0 ||
        s.weatherRemaining > 150)) ||
    (s.daySeconds !== undefined &&
      (!Number.isFinite(s.daySeconds) ||
        s.daySeconds < 240 ||
        s.daySeconds > 360))
  )
    return false;
  if (
    v.resident !== undefined &&
    (!v.resident ||
      ![v.resident.x, v.resident.z].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 34,
      ) ||
      v.resident.x > 12)
  )
    return false;
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
