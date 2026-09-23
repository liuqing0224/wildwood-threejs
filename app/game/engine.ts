import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import pathfinding from 'javascript-astar';
import { Resident, MOOD_LABELS, type Gesture, type Mood } from './character';
import { makeFurniture } from './furniture';
import { residentPath, walkable, type Cell } from './navigation';
import {
  enclosedShelter,
  comfortAfter,
  randomWeather,
  neighbors,
} from './survival';
import {
  CATALOG,
  isFurniture,
  craftFurniture,
  furnitureRecipeError,
  emptyFurnitureStock,
  type FurnitureKind,
  canPlace,
  snapRotation,
  initialSnapshot,
  validSave,
  type Block,
  type Kind,
  type Mode,
  type Snapshot,
  type Weather,
  type AgentGoal,
} from './model';

const { Graph, astar } = pathfinding;
const TILE = 2;
const SAVE_KEY = 'wildwood-save-v1';
type AgentTask = { cell: Cell; remaining: number } & (
  | { type: 'harvest'; key: string }
  | { type: 'repair'; id: number | null }
  | { type: 'build'; kind: Kind; rotation: number }
);
type Enemy = {
  mesh: THREE.Group;
  hp: number;
  cooldown: number;
  path: { x: number; y: number }[];
  repath: number;
  target: number | null;
  phase: number;
  speed: number;
  hurt: number;
};
type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number };
const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(
  color: string,
  options: THREE.MeshStandardMaterialParameters = {},
) {
  const key = color + JSON.stringify(options);
  if (!materials.has(key))
    materials.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        flatShading: true,
        ...options,
      }),
    );
  return materials.get(key)!;
}
function box(
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    mat(color),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cone(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  color: string,
  x: number,
  y: number,
  z: number,
  sides = 7,
) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, sides),
    mat(color),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.LineSegments ||
      o instanceof THREE.Points
    )
      o.geometry.dispose();
  });
  object.removeFromParent();
}
function mergeGroup(group: THREE.Group) {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.updateMatrixWorld(true);
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material))
      continue;
    const geometries = batches.get(child.material) ?? [];
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrix);
    geometries.push(geometry);
    batches.set(child.material, geometries);
    child.geometry.dispose();
    group.remove(child);
  }
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

export class GameEngine {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 240);
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  state = initialSnapshot();
  blocks: Block[] = [];
  private blockMeshes = new Map<number, THREE.Group>();
  private resources = new Map<string, THREE.Group>();
  private depleted = new Set<string>();
  private enemies: Enemy[] = [];
  private particles: Particle[] = [];
  private sun = new THREE.DirectionalLight('#fff1d5', 3);
  private ambient = new THREE.HemisphereLight('#e6f3ed', '#6f8156', 2);
  private hearth = new THREE.Group();
  private fireLight = new THREE.PointLight('#ffbd64', 6, 12, 2);
  private trees: THREE.Group[] = [];
  private clouds: THREE.Group[] = [];
  private water!: THREE.Mesh;
  private ripples: THREE.Mesh[] = [];
  private smoke: THREE.Mesh[] = [];
  private rain!: THREE.LineSegments;
  private grid = new THREE.GridHelper(38, 19, '#fafce0', '#e4f2c8');
  private ghost: THREE.Group;
  private selected: Kind = 'wall';
  private mode: Mode = 'build';
  private placementArmed = false;
  private rotation = 0;
  private previewCell: Cell | null = null;
  private hoveredBlockId: number | null = null;
  private rotationTargetId: number | null = null;
  private rotationOutline: THREE.BoxHelper | null = null;
  private nextId = 1;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private uiTimer = 0;
  private saveTimer = 0;
  private weatherTimer = 0;
  private heldKeys = new Set<string>();
  private agentTask: AgentTask | null = null;
  private agentTimer = 0;
  private defenseTimer = 0;
  private shelterOrder = false;
  private shelterCache: Cell[] | null = null;
  private towerTimer = 0;
  private frame = 0;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down = { x: 0, y: 0 };
  private touchCount = 0;
  private resizeObserver: ResizeObserver;
  private sound = false;
  private audio?: AudioContext;
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private disposed = false;
  private resident = new Resident();
  private residentRoute: Cell[] = [];
  private residentJob: {
    gesture: Gesture;
    tool: 'hammer' | 'axe';
    target: THREE.Vector3;
    label: string;
  } | null = null;
  private residentWorkTime = 0;
  private residentIdleTime = 0;
  private lastResidentMood: Mood = 'content';
  constructor(
    private container: HTMLDivElement,
    private onState: (state: Snapshot) => void,
    private notify: (text: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#c7dfdf');
    this.scene.fog = new THREE.Fog('#c7dfdf', 70, 155);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 78;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.25;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
    this.controls.panSpeed = 0.7;
    this.scene.add(this.sun, this.ambient);
    this.sun.position.set(-25, 40, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -35,
      right: 35,
      top: 35,
      bottom: -35,
      near: 1,
      far: 100,
    });
    this.sun.shadow.normalBias = 0.05;
    this.makeWorld();
    this.load();
    this.updateLighting(0, true);
    this.ghost = this.makeBlock(this.selected);
    this.makeGhost();
    this.scene.add(this.ghost);
    this.ghost.visible = false;
    this.grid.position.set(0, 0.055, 0);
    this.grid.visible = false;
    this.scene.add(this.grid);
    const gridMat = this.grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.3;
    this.resetCamera();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('wheel', this.rotationWheel, {
      capture: true,
      passive: false,
    });
    this.renderer.domElement.addEventListener(
      'pointerleave',
      this.pointerLeave,
    );
    this.renderer.domElement.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearKeys);
    window.addEventListener('pagehide', this.pageHide);
    document.addEventListener('visibilitychange', this.visibility);
    this.publish();
    this.animate();
  }
  private resize = () => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
  resetCamera() {
    const mobile = this.container.clientWidth < 760;
    this.camera.position.set(
      mobile ? 29 : 31,
      mobile ? 34 : 31,
      mobile ? 42 : 38,
    );
    this.controls.target.set(-1, 0, -1);
    this.controls.update();
  }
  zoom(factor: number) {
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(factor)
      .clampLength(15, 78)
      .add(this.controls.target);
    this.controls.update();
  }
  private makeWorld() {
    const rand = seeded(72);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      mat('#849e60'),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.17;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // A colored low-poly surface breaks the clearing into natural patches without image dependencies.
    const terrain = new THREE.PlaneGeometry(130, 130, 42, 42);
    terrain.rotateX(-Math.PI / 2);
    const pos = terrain.attributes.position;
    const colors = [];
    const greens = ['#94ad70', '#a1b87c', '#9db577', '#90aa6c', '#a6bb81'];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const river = Math.abs(x - (20 + Math.sin(z * 0.055) * 5)) < 4.6;
      pos.setY(
        i,
        river
          ? -0.3
          : d < 21
            ? -0.035
            : Math.max(0, (d - 20) / 20) * (0.5 + rand() * 0.6),
      );
      const c = new THREE.Color(greens[Math.floor(rand() * greens.length)]);
      colors.push(c.r, c.g, c.b);
    }
    terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    const land = new THREE.Mesh(
      terrain,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        flatShading: true,
      }),
    );
    land.receiveShadow = true;
    this.scene.add(land);
    const clearing = new THREE.Mesh(
      new THREE.CircleGeometry(16.2, 32),
      mat('#afbb83'),
    );
    clearing.rotation.x = -Math.PI / 2;
    clearing.position.set(-2, 0.005, 0);
    clearing.receiveShadow = true;
    this.scene.add(clearing);
    // Winding river ribbon. Its banks and animated glints follow the same centerline.
    const center = (z: number) => 20 + Math.sin(z * 0.055) * 5;
    const rv: number[] = [];
    const banks: number[] = [];
    for (let z = -68; z < 68; z += 2) {
      for (const [arr, w] of [
        [rv, 3.2],
        [banks, 4.1],
      ] as [number[], number][]) {
        const a = center(z),
          b = center(z + 2);
        arr.push(
          a - w,
          0,
          z,
          a + w,
          0,
          z,
          b - w,
          0,
          z + 2,
          a + w,
          0,
          z,
          b + w,
          0,
          z + 2,
          b - w,
          0,
          z + 2,
        );
      }
    }
    const ribbon = (vertices: number[], color: string, y: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(
        g,
        mat(color, { side: THREE.DoubleSide, roughness: 0.48 }),
      );
      m.position.y = y;
      this.scene.add(m);
      return m;
    };
    ribbon(banks, '#c3c4a0', 0.015);
    this.water = ribbon(rv, '#69b6ba', 0.03);
    for (let i = 0; i < 70; i++) {
      const z = rand() * 130 - 65;
      const ripple = box(
        this.scene,
        0.2 + rand() * 1.2,
        0.012,
        0.045,
        '#c3e4d8',
        center(z) + (rand() - 0.5) * 5,
        0.07,
        z,
      );
      ripple.castShadow = false;
      this.ripples.push(ripple);
    }
    for (let i = 0; i < 150; i++) {
      let x = rand() * 110 - 55,
        z = rand() * 100 - 60;
      if (Math.hypot(x + 2, z) < 18 || Math.abs(x - center(z)) < 5) continue;
      this.makeTree(
        x,
        z,
        1 + rand() * 0.85,
        rand() > 0.75 ? '#81914e' : '#477653',
        `tree-${i}`,
      );
    }
    [
      [-12, 7],
      [-14, -2],
      [-10, -11],
      [9, -11],
      [10, 6],
      [-7, 13],
      [4, 13],
      [-15, 14],
    ].forEach(([x, z], i) =>
      this.makeTree(x, z, 0.8 + (i % 3) * 0.15, '#587d4a', `near-${i}`),
    );
    for (let i = 0; i < 32; i++) {
      const x = rand() * 65 - 30,
        z = rand() * 60 - 25;
      if (Math.hypot(x, z) < 10 || Math.abs(x - center(z)) < 4) continue;
      const group = new THREE.Group();
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.6 + rand() * 0.7, 0),
        mat('#9baba0'),
      );
      rock.scale.set(1, 0.65, 0.8);
      rock.position.y = 0.35;
      rock.castShadow = true;
      group.add(rock);
      group.position.set(x, 0, z);
      group.userData = { resource: `rock-${i}`, resourceType: 'stone' };
      this.resources.set(`rock-${i}`, group);
      this.scene.add(group);
    }
    const grasses = new THREE.Group();
    for (let i = 0; i < 220; i++) {
      const x = rand() * 66 - 33,
        z = rand() * 60 - 30;
      if (Math.hypot(x, z) < 8 || Math.abs(x - center(z)) < 4) continue;
      for (let j = 0; j < 3; j++)
        cone(
          grasses,
          0.08,
          0.25 + rand() * 0.2,
          rand() > 0.8 ? '#e3d49b' : '#769354',
          x + (rand() - 0.5) * 0.3,
          0.14,
          z + (rand() - 0.5) * 0.3,
          3,
        );
    }
    mergeGroup(grasses);
    this.scene.add(grasses);
    for (let i = 0; i < 13; i++) {
      const x = -60 + i * 11,
        z = -56 - Math.sin(i) * 8;
      const h = 12 + rand() * 16;
      cone(this.scene, 10 + rand() * 8, h, '#769992', x, h / 2 - 1, z, 5);
      cone(this.scene, 3.5, h * 0.3, '#d9e4dc', x, h * 0.85 - 1, z, 5);
    }
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.5 + rand() * 2, 0),
          mat('#ecf1e7'),
        );
        puff.position.set(j * 2.7, rand(), rand());
        puff.scale.y = 0.6;
        cloud.add(puff);
      }
      cloud.position.set(rand() * 100 - 50, 19 + rand() * 10, rand() * 90 - 70);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
    const path = new THREE.Group();
    for (let i = 0; i < 19; i++) {
      const stone = box(
        path,
        1.1,
        0.06,
        0.65,
        '#c4c2a0',
        Math.sin(i * 0.55) * 0.45,
        0.055,
        3 + i * 0.75,
      );
      stone.rotation.y = rand() * 0.4;
    }
    this.scene.add(path);
    // Small bridge across the stream.
    const bridge = new THREE.Group();
    for (let i = 0; i < 15; i++)
      box(
        bridge,
        0.5,
        0.18,
        2.7,
        i % 2 ? '#b4a279' : '#c0ad80',
        i * 0.5 - 3.5,
        0.27,
        0,
      );
    for (const z of [-1.3, 1.3]) {
      box(bridge, 7.5, 0.12, 0.12, '#917e58', 0, 1.3, z);
      for (const x of [-3.3, 0, 3.3])
        box(bridge, 0.16, 1.2, 0.16, '#8c7b54', x, 0.75, z);
    }
    bridge.position.set(center(8), 0, 8);
    this.scene.add(bridge);
    // The hearth is the protected home core, independent of the removable starter house.
    this.hearth.userData = { core: true };
    box(this.hearth, 1.2, 0.4, 1.2, '#8a9283', 0, 0.22, 0);
    const flame = cone(this.hearth, 0.26, 0.75, '#ffc775', 0, 0.76, 0, 5);
    flame.material = mat('#ffcf78', {
      emissive: '#ed9848',
      emissiveIntensity: 1,
    });
    this.hearth.add(this.fireLight);
    this.fireLight.position.y = 1.3;
    this.scene.add(this.hearth);
    // Garden, wood pile, lamps and a little resident make the starting home feel inhabited.
    const garden = new THREE.Group();
    box(garden, 3.5, 0.13, 2.6, '#7d7850', -7, 0.11, 3);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++) {
        cone(
          garden,
          0.18,
          0.45,
          '#608c46',
          -8.2 + i * 0.8,
          0.4,
          2.2 + j * 0.8,
          5,
        );
      }
    this.scene.add(garden);
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 1.8, 7),
        mat('#aa8e60'),
      );
      log.rotation.z = Math.PI / 2;
      log.position.set(
        -5.8,
        0.25 + Math.floor(i / 3) * 0.43,
        5.5 + (i % 3) * 0.44,
      );
      log.castShadow = true;
      this.scene.add(log);
    }
    for (const [x, z] of [
      [-3, 5],
      [4, 5],
    ]) {
      box(this.scene, 0.13, 1.5, 0.13, '#817853', x, 0.8, z);
      box(this.scene, 0.4, 0.5, 0.4, '#c9ad6c', x, 1.65, z);
      const light = new THREE.PointLight('#ffd28b', 2.5, 7, 2);
      light.position.set(x, 1.7, z);
      this.scene.add(light);
    }
    this.scene.add(this.resident.root);
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.22 + i * 0.018, 0),
        new THREE.MeshStandardMaterial({
          color: '#dddcd0',
          transparent: true,
          opacity: 0.32,
          flatShading: true,
          depthWrite: false,
        }),
      );
      this.scene.add(puff);
      this.smoke.push(puff);
    }
    const rainPos = new Float32Array(650 * 6);
    for (let i = 0; i < 650; i++) {
      const x = rand() * 65 - 32,
        y = rand() * 26,
        z = rand() * 65 - 32;
      rainPos.set([x, y, z, x + 0.15, y - 0.8, z], i * 6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: '#c3dde3',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.rain.visible = false;
    this.scene.add(this.rain);
  }
  private makeTree(
    x: number,
    z: number,
    scale: number,
    color: string,
    key: string,
  ) {
    const tree = new THREE.Group();
    box(tree, 0.34, 2, 0.34, '#8d7853', 0, 1, 0);
    cone(tree, 1.7, 3.2, color, 0, 3.1, 0);
    cone(tree, 1.35, 2.8, color, 0, 4.4, 0);
    cone(tree, 0.95, 2.2, color, 0, 5.5, 0);
    mergeGroup(tree);
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = x;
    tree.userData = { resource: key, resourceType: 'wood' };
    this.scene.add(tree);
    this.resources.set(key, tree);
    this.trees.push(tree);
  }
  private makeBlock(kind: Kind) {
    if (isFurniture(kind)) return makeFurniture(kind);
    const group = new THREE.Group();
    if (kind === 'floor') {
      for (let i = 0; i < 5; i++)
        box(
          group,
          0.37,
          0.16,
          1.96,
          i % 2 ? '#bda372' : '#cab080',
          -0.78 + i * 0.39,
          0.17,
          0,
        );
      box(group, 2, 0.15, 0.18, '#91794f', 0, 0.07, 0.85);
      box(group, 2, 0.15, 0.18, '#91794f', 0, 0.07, -0.85);
    }
    if (kind === 'wall' || kind === 'door') {
      for (const x of [-0.91, 0.91])
        box(group, 0.16, 2.6, 0.3, '#846d45', x, 1.5, 0);
      if (kind === 'wall') {
        for (let i = 0; i < 7; i++)
          box(
            group,
            1.82,
            0.32,
            0.23,
            i % 2 ? '#c6ad7a' : '#cdb583',
            0,
            0.43 + i * 0.35,
            0,
          );
        box(group, 0.9, 1, 0.08, '#876f48', 0, 1.62, 0.15);
        box(group, 0.7, 0.8, 0.09, '#8fb8aa', 0, 1.62, 0.2);
        box(group, 0.055, 0.83, 0.11, '#e7d3a0', 0, 1.62, 0.26);
        box(group, 0.73, 0.055, 0.11, '#e7d3a0', 0, 1.62, 0.26);
      } else {
        box(group, 0.38, 2.4, 0.25, '#c2a777', -0.65, 1.45, 0);
        box(group, 0.38, 2.4, 0.25, '#c2a777', 0.65, 1.45, 0);
        box(group, 1.8, 0.4, 0.25, '#c8af7f', 0, 2.48, 0);
      }
      box(group, 2, 0.17, 0.36, '#856d47', 0, 2.79, 0);
    }
    if (kind === 'roof') {
      const shape = new THREE.Shape();
      shape.moveTo(-1.13, 0);
      shape.lineTo(0, 0.92);
      shape.lineTo(1.13, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 2.15,
        bevelEnabled: false,
      });
      const mesh = new THREE.Mesh(geo, mat('#bd7057'));
      mesh.position.set(0, 2.83, -1.075);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const side of [-1, 1]) {
        const panel = box(
          group,
          1.48,
          0.12,
          2.25,
          side === 1 ? '#b56b52' : '#d58c6b',
          side * 0.56,
          3.33,
          0,
        );
        panel.rotation.z = -side * 0.685;
        for (let i = 0; i < 5; i++) {
          const seam = box(
            group,
            1.46,
            0.02,
            0.025,
            '#a9604c',
            side * 0.56,
            3.4,
            -0.98 + i * 0.49,
          );
          seam.rotation.z = -side * 0.685;
        }
      }
      box(group, 0.13, 0.12, 2.3, '#dc9572', 0, 3.81, 0);
    }
    if (kind === 'fence') {
      for (const x of [-0.85, 0.85]) {
        box(group, 0.15, 1.2, 0.15, '#947b50', x, 0.62, 0);
        cone(group, 0.13, 0.18, '#b49b66', x, 1.31, 0, 4);
      }
      box(group, 1.9, 0.16, 0.11, '#b69b65', 0, 0.55, 0);
      box(group, 1.9, 0.16, 0.11, '#b69b65', 0, 1.03, 0);
    }
    if (kind === 'tower') {
      box(group, 1.4, 0.45, 1.4, '#a8aa91', 0, 0.25, 0);
      for (const x of [-0.46, 0.46])
        for (const z of [-0.46, 0.46])
          box(group, 0.2, 2.8, 0.2, '#938261', x, 1.65, z);
      box(group, 1.65, 0.2, 1.65, '#ae9b70', 0, 2.8, 0);
      for (const z of [-0.8, 0.8])
        box(group, 1.75, 0.45, 0.14, '#718d72', 0, 3.1, z);
      for (const x of [-0.8, 0.8])
        box(group, 0.14, 0.45, 1.75, '#718d72', x, 3.1, 0);
      const top = cone(group, 1.35, 0.9, '#5c8475', 0, 3.95, 0, 4);
      top.rotation.y = Math.PI / 4;
      box(group, 0.7, 0.15, 0.14, '#b9a67a', 0, 3.4, 0.7);
    }
    mergeGroup(group);
    if (kind === 'door') {
      const leaf = new THREE.Group();
      leaf.name = 'door-leaf';
      leaf.position.set(-0.48, 0, 0.05);
      box(leaf, 0.96, 1.95, 0.15, '#8d7654', 0.48, 1.24, 0);
      for (let i = 0; i < 4; i++)
        box(leaf, 0.018, 1.8, 0.02, '#725f41', 0.13 + i * 0.23, 1.25, 0.09);
      box(leaf, 0.11, 0.12, 0.09, '#d8c47d', 0.77, 1.25, 0.13);
      group.add(leaf);
    }
    return group;
  }
  private cabinRoof(x: number) {
    const group = new THREE.Group();
    const cuts = x === 0 ? [-1.05, 0, 1.05] : [-1.05, 1.05];
    for (let i = 0; i < cuts.length - 1; i++) {
      const left = cuts[i],
        right = cuts[i + 1];
      const height = (local: number) =>
        2.95 + (5.1 - Math.abs(x * TILE + local)) * 0.45;
      const vertices = [
        left,
        height(left),
        -1.06,
        right,
        height(right),
        -1.06,
        left,
        height(left),
        1.06,
        right,
        height(right),
        -1.06,
        right,
        height(right),
        1.06,
        left,
        height(left),
        1.06,
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        mat(x < 0 ? '#ce8967' : '#b96650', { side: THREE.DoubleSide }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const z of [-1.02, -0.5, 0, 0.5, 1.02]) {
        const trim = box(
          group,
          right - left,
          0.055,
          0.045,
          '#a65945',
          (left + right) / 2,
          (height(left) + height(right)) / 2 + 0.035,
          z,
        );
        trim.rotation.z = Math.atan2(
          height(right) - height(left),
          right - left,
        );
      }
    }
    return group;
  }
  private starter() {
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        if (x || z) this.addBlock('floor', x, z, 0);
        if (z === -2 || z === 2)
          this.addBlock(z === 2 && x === 0 ? 'door' : 'wall', x, z, 0);
        else if (x === -2 || x === 2) this.addBlock('wall', x, z, Math.PI / 2);
      }
    // Full roof on the starter cabin, each tile remains individually destructible.
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) this.addBlock('roof', x, z, 0);
    for (let x = -4; x <= 4; x++) {
      if (Math.abs(x) > 1) this.addBlock('fence', x, 4, 0);
    }
    for (let z = -3; z < 4; z++) this.addBlock('fence', -4, z, Math.PI / 2);
    for (let x = 3; x <= 4; x++)
      for (let z = -1; z <= 1; z++) this.addBlock('floor', x, z, 0);
  }
  private addBlock(
    kind: Kind,
    x: number,
    z: number,
    rotation: number,
    hp: number = CATALOG[kind].hp,
    id = this.nextId++,
  ) {
    this.shelterCache = null;
    const block = { kind, x, z, rotation, hp, id };
    this.blocks.push(block);
    this.nextId = Math.max(this.nextId, id + 1);
    const cabin = kind === 'roof' && Math.abs(x) <= 2 && Math.abs(z) <= 2;
    const mesh = cabin ? this.cabinRoof(x) : this.makeBlock(kind);
    mesh.position.set(x * TILE, 0, z * TILE);
    mesh.rotation.y = rotation;
    mesh.userData = { blockId: id };
    this.scene.add(mesh);
    this.blockMeshes.set(id, mesh);
    return block;
  }
  private load() {
    let loaded = false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data: unknown = JSON.parse(raw);
        if (validSave(data)) {
          this.state = {
            ...initialSnapshot(),
            ...data.state,
            furnitureStock: {
              ...emptyFurnitureStock(),
              ...data.state.furnitureStock,
            },
            interiorView: false,
            paused: data.state.health <= 0,
            monsters: 0,
            saved: true,
            nextRaid: Math.max(30, data.state.nextRaid),
          };
          this.rotation = snapRotation(data.rotation);
          data.blocks.forEach((b) =>
            this.addBlock(
              b.kind,
              b.x,
              b.z,
              snapRotation(b.rotation),
              b.hp,
              b.id,
            ),
          );
          data.depleted.forEach((key) => {
            this.depleted.add(key);
            const tree = this.resources.get(key);
            if (tree) tree.visible = false;
          });
          if (
            data.resident &&
            walkable(
              {
                x: Math.round(data.resident.x / TILE),
                z: Math.round(data.resident.z / TILE),
              },
              this.blocks,
              this.residentObstacles(),
            )
          )
            this.resident.root.position.set(
              data.resident.x,
              0,
              data.resident.z,
            );
          loaded = true;
        } else this.notify('旧存档无法读取，已建立新家园');
      }
    } catch {
      this.notify('存档不可用，本次仍可继续游玩');
    }
    if (!loaded) {
      this.randomizeDay();
      this.state.hour = 8 + Math.random() * 3;
      this.state.weatherRemaining = 45 + Math.random() * 75;
      this.starter();
    }
    this.state.defending = false;
    this.state.sheltered = false;
  }
  save(show = false) {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          version: 1,
          state: this.state,
          blocks: this.blocks,
          depleted: [...this.depleted],
          rotation: this.rotation,
          resident: {
            x: this.resident.root.position.x,
            z: this.resident.root.position.z,
          },
        }),
      );
      this.state.saved = true;
      if (show) this.notify('家园已保存到这台设备');
    } catch {
      this.state.saved = false;
      if (show) this.notify('设备存储不可用，暂时无法保存');
    }
    this.publish();
  }
  private publish() {
    this.state.blocks = this.blocks.length;
    this.state.monsters = this.enemies.length;
    this.state.residentMood = MOOD_LABELS[this.resident.mood];
    this.state.buildRotation = this.rotation;
    const rotating = this.blocks.find((b) => b.id === this.rotationTargetId);
    this.state.editRotation = rotating?.rotation ?? null;
    this.state.rotatingName = rotating ? CATALOG[rotating.kind].name : '';
    this.onState({
      ...this.state,
      furnitureStock: { ...this.state.furnitureStock },
    });
  }
  setInteriorView(show: boolean) {
    if (show && !this.state.interiorView) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const mobile = this.container.clientWidth < 760;
      offset.y = Math.max(offset.y, Math.hypot(offset.x, offset.z) * 2.5);
      offset.setLength(mobile ? 34 : 24);
      this.controls.target.set(0, 0.6, mobile ? 1.5 : 0);
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
    this.state.interiorView = show;
    this.updateShelterVisuals(0);
    this.publish();
  }
  craft(kind: FurnitureKind) {
    if (this.state.paused || this.state.health <= 0) return;
    const error = furnitureRecipeError(this.state, kind);
    if (error) {
      this.notify(error);
      return;
    }
    if (!craftFurniture(this.state, kind)) {
      this.notify('成品数量已达上限');
      return;
    }
    this.takeManualControl();
    this.notify(`${CATALOG[kind].name}制作完成`);
    this.changed();
  }
  select(kind: Kind, mode: Mode, armPlacement = false) {
    this.selected = kind;
    this.mode = mode;
    this.placementArmed = mode === 'build' && armPlacement;
    this.rotationTargetId = null;
    this.clearRotationOutline();
    this.clearGhost();
    this.ghost = this.makeBlock(kind);
    this.makeGhost();
    this.scene.add(this.ghost);
    this.refreshPreview();
    this.publish();
  }
  focusResident() {
    this.takeManualControl();
    const target = this.resident.root.position.clone().setY(1.2);
    const offset = this.camera.position
      .clone()
      .sub(this.controls.target)
      .setLength(this.container.clientWidth < 760 ? 23 : 26);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
    this.residentRoute = [];
    this.resident.root.rotation.y = Math.atan2(
      this.camera.position.x - target.x,
      this.camera.position.z - target.z,
    );
    this.resident.say('我在这里呢。今天想去哪里？');
    this.resident.gesture('wave');
    this.residentWorkTime = 2;
    this.residentJob = {
      gesture: 'wave',
      tool: 'hammer',
      target: this.resident.root.position.clone(),
      label: '和你打招呼',
    };
  }
  private residentObstacles(): Cell[] {
    return [...this.resources.entries()]
      .filter(([key]) => !this.depleted.has(key))
      .map(([, obj]) => ({
        x: Math.round(obj.position.x / TILE),
        z: Math.round(obj.position.z / TILE),
      }));
  }
  private moveResident(target: Cell, closest = false) {
    const from = {
      x: Math.round(this.resident.root.position.x / TILE),
      z: Math.round(this.resident.root.position.z / TILE),
    };
    const route = residentPath(
      from,
      target,
      this.blocks,
      this.residentObstacles(),
      closest,
    );
    if (!route.length) {
      if (!closest) this.resident.say('那边走不过去，换个地方吧。');
      return false;
    }
    this.residentRoute = route;
    this.residentIdleTime = 0;
    return true;
  }
  private residentAction(
    target: THREE.Vector3,
    gesture: Gesture,
    speech: string,
    tool: 'hammer' | 'axe' = 'hammer',
  ) {
    this.residentRoute = [];
    this.residentWorkTime = 2.5;
    this.residentIdleTime = 0;
    this.residentJob = {
      gesture,
      tool,
      target: target.clone(),
      label:
        gesture === 'guard'
          ? '守护家园'
          : tool === 'axe'
            ? '收集材料'
            : '打理小屋',
    };
    if (gesture === 'work')
      this.moveResident(
        { x: Math.round(target.x / TILE), z: Math.round(target.z / TILE) },
        true,
      );
    this.resident.say(speech, 5);
  }
  private updateResident(dt: number) {
    const mood: Mood = this.enemies.length
      ? 'brave'
      : this.state.weather !== 'clear'
        ? 'rainy'
        : this.state.hour >= 19 || this.state.hour < 6
          ? 'sleepy'
          : 'content';
    if (mood !== this.lastResidentMood) {
      this.lastResidentMood = mood;
      this.resident.say(
        mood === 'brave'
          ? '别碰我的小屋！'
          : mood === 'rainy'
            ? '雨来了，还好带了伞。'
            : mood === 'sleepy'
              ? '天黑了，留一盏灯等星星。'
              : '太阳出来了，今天也要加油。',
        5,
      );
    }
    this.resident.update(
      dt,
      mood,
      this.state.weather !== 'clear' && !this.state.sheltered,
    );
    if (this.updateKeyboardMovement(dt)) return;
    const next = this.residentRoute[0];
    if (next) {
      if (!walkable(next, this.blocks, this.residentObstacles())) {
        this.residentRoute = [];
        this.resident.say('路被挡住了，我等一下。');
        return;
      }
      const delta = new THREE.Vector3(next.x * TILE, 0, next.z * TILE).sub(
        this.resident.root.position.clone().setY(0),
      );
      const step = dt * this.walkSpeed();
      if (delta.length() <= step) {
        this.resident.root.position.set(next.x * TILE, 0, next.z * TILE);
        this.residentRoute.shift();
      } else {
        this.resident.root.position.addScaledVector(delta.normalize(), step);
        this.resident.root.rotation.y = THREE.MathUtils.lerp(
          this.resident.root.rotation.y,
          Math.atan2(delta.x, delta.z),
          Math.min(1, dt * 12),
        );
      }
      this.resident.gesture('walk');
      this.state.residentActivity = this.residentJob
        ? '走向劳动地点'
        : '在营地散步';
      this.resident.root.position.y =
        Math.abs(Math.sin(this.elapsed * 10)) * 0.04;
    } else if (this.residentJob && this.residentWorkTime > 0) {
      this.residentWorkTime -= dt;
      this.resident.root.position.y = 0;
      this.resident.gesture(this.residentJob.gesture, this.residentJob.tool);
      this.state.residentActivity = this.residentJob.label;
      const delta = this.residentJob.target
        .clone()
        .sub(this.resident.root.position);
      if (delta.length() > 0.2)
        this.resident.root.rotation.y = Math.atan2(delta.x, delta.z);
      if (this.residentWorkTime <= 0) this.residentJob = null;
    } else {
      this.resident.root.position.y = 0;
      this.resident.gesture(this.enemies.length ? 'guard' : 'idle');
      this.state.residentActivity = this.enemies.length
        ? '警惕地守着家'
        : this.state.weather !== 'clear'
          ? '撑伞听雨'
          : '在家园小憩';
      this.residentIdleTime += dt;
      if (
        this.residentIdleTime > 20 &&
        !this.state.agentEnabled &&
        !this.shelterOrder &&
        this.mode !== 'walk' &&
        !this.enemies.length
      ) {
        this.residentIdleTime = 0;
        const spots: Cell[] = [
          { x: 1, z: 3 },
          { x: 0, z: 5 },
          { x: 2, z: 5 },
          { x: -1, z: 3 },
        ];
        this.moveResident(
          spots[Math.floor(this.elapsed / 20) % spots.length],
          true,
        );
      }
    }
  }
  private walkSpeed() {
    return 3.2 * (0.55 + (this.state.comfort / 100) * 0.45);
  }
  private randomizeDay() {
    this.state.daySeconds = 240 + Math.random() * 120;
  }
  private currentCell(): Cell {
    return {
      x: Math.round(this.resident.root.position.x / TILE),
      z: Math.round(this.resident.root.position.z / TILE),
    };
  }
  private shelters() {
    return (this.shelterCache ??= enclosedShelter(this.blocks));
  }
  private takeManualControl() {
    this.state.agentEnabled = false;
    this.state.agentStatus = '手动控制';
    this.state.defending = false;
    this.shelterOrder = false;
    this.agentTask = null;
    this.residentRoute = [];
    this.residentJob = null;
    this.residentWorkTime = 0;
  }
  setAgent(enabled: boolean, goal: AgentGoal = this.state.agentGoal) {
    this.takeManualControl();
    this.clearKeys();
    this.state.agentEnabled = enabled;
    this.state.agentGoal = goal;
    this.state.agentStatus = enabled ? '正在安排任务' : '手动控制';
    this.agentTimer = 0;
    this.changed();
  }
  seekShelter() {
    this.takeManualControl();
    this.clearKeys();
    this.shelterOrder = true;
    this.agentTimer = 0;
    this.publish();
  }
  private updateKeyboardMovement(dt: number) {
    const forward =
      Number(this.heldKeys.has('w') || this.heldKeys.has('arrowup')) -
      Number(this.heldKeys.has('s') || this.heldKeys.has('arrowdown'));
    const right =
      Number(this.heldKeys.has('d') || this.heldKeys.has('arrowright')) -
      Number(this.heldKeys.has('a') || this.heldKeys.has('arrowleft'));
    if (!forward && !right) return false;
    const direction = this.controls.target
      .clone()
      .sub(this.camera.position)
      .setY(0)
      .normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    direction
      .multiplyScalar(forward)
      .addScaledVector(side, right)
      .normalize()
      .multiplyScalar(dt * this.walkSpeed());
    const position = this.resident.root.position;
    const before = position.clone();
    const obstacles = this.residentObstacles();
    for (const axis of ['x', 'z'] as const) {
      const candidate = position.clone();
      candidate[axis] += direction[axis];
      const clear = [-0.22, 0.22].every((x) =>
        [-0.22, 0.22].every((z) =>
          walkable(
            {
              x: Math.round((candidate.x + x) / TILE),
              z: Math.round((candidate.z + z) / TILE),
            },
            this.blocks,
            obstacles,
          ),
        ),
      );
      if (clear) position[axis] = candidate[axis];
    }
    const delta = position.clone().sub(before).setY(0);
    if (delta.lengthSq() > 0) {
      this.resident.root.rotation.y = Math.atan2(delta.x, delta.z);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    position.y = Math.abs(Math.sin(this.elapsed * 10)) * 0.04;
    this.resident.gesture(delta.lengthSq() ? 'walk' : 'idle');
    this.state.residentActivity = delta.lengthSq()
      ? '自由行走'
      : '前方被挡住了';
    return true;
  }
  private approach(cell: Cell): Cell[] | null {
    const from = this.currentCell();
    const obstacles = this.residentObstacles();
    let best: Cell[] | null = null;
    for (const target of neighbors(cell)) {
      if (!walkable(target, this.blocks, obstacles)) continue;
      if (from.x === target.x && from.z === target.z) return [];
      const route = residentPath(from, target, this.blocks, obstacles);
      if (route.length && (!best || route.length < best.length)) best = route;
    }
    return best;
  }
  private beginTask(task: AgentTask) {
    const route = this.approach(task.cell);
    if (route === null) return false;
    this.agentTask = task;
    this.residentRoute = route;
    this.residentJob = null;
    this.residentWorkTime = 0;
    return true;
  }
  private harvestResource(key: string) {
    const object = this.resources.get(key);
    if (!object || this.depleted.has(key)) return false;
    this.depleted.add(key);
    object.visible = false;
    const wood = object.userData.resourceType === 'wood';
    if (wood) {
      this.state.wood += 24;
      this.state.fiber += 6;
    } else this.state.stone += 18;
    this.state.harvested++;
    this.burst(object.position, wood ? '#bca477' : '#b0bcb0', 12);
    this.changed();
    return true;
  }
  private repairTarget(id: number | null) {
    const block = this.blocks.find((b) => b.id === id);
    if (
      this.state.wood < 4 ||
      (id !== null && !block) ||
      (block ? block.hp >= CATALOG[block.kind].hp : this.state.health >= 100)
    )
      return false;
    this.state.wood -= 4;
    if (block) {
      block.hp = Math.min(CATALOG[block.kind].hp, block.hp + 45);
      this.blockMeshes.get(block.id)?.scale.set(1, 1, 1);
    } else this.state.health = Math.min(100, this.state.health + 20);
    this.changed();
    return true;
  }
  private buildTarget(kind: Kind, cell: Cell, rotation: number) {
    const cost = CATALOG[kind];
    if (this.placementError(cell.x, cell.z, kind) || this.buildCostError(kind))
      return false;
    if (isFurniture(kind)) this.state.furnitureStock[kind]--;
    else {
      this.state.wood -= cost.wood;
      this.state.stone -= cost.stone;
    }
    this.addBlock(kind, cell.x, cell.z, rotation);
    this.state.built++;
    this.changed();
    return true;
  }
  private buildCostError(kind: Kind): string | null {
    if (isFurniture(kind))
      return this.state.furnitureStock[kind] > 0
        ? null
        : '还没有这件成品，请先制作';
    return this.state.wood < CATALOG[kind].wood ||
      this.state.stone < CATALOG[kind].stone
      ? '材料不足'
      : null;
  }
  private planHarvest(type?: 'wood' | 'stone') {
    const position = this.resident.root.position;
    const candidates = [...this.resources.entries()]
      .filter(
        ([key, object]) =>
          !this.depleted.has(key) &&
          (!type || object.userData.resourceType === type),
      )
      .sort(
        (a, b) =>
          a[1].position.distanceToSquared(position) -
          b[1].position.distanceToSquared(position),
      );
    for (const [key, object] of candidates) {
      const cell = {
        x: Math.round(object.position.x / TILE),
        z: Math.round(object.position.z / TILE),
      };
      if (this.beginTask({ type: 'harvest', key, cell, remaining: 2.5 }))
        return true;
    }
    return false;
  }
  private planAgentTask() {
    if (this.state.wood < 12 && this.planHarvest('wood')) return;
    if (
      this.state.wood >= 4 &&
      this.state.health < 100 &&
      this.beginTask({
        type: 'repair',
        id: null,
        cell: { x: 0, z: 0 },
        remaining: 2,
      })
    )
      return;
    const damaged = this.blocks
      .filter((b) => b.hp < CATALOG[b.kind].hp)
      .sort((a, b) => a.hp / CATALOG[a.kind].hp - b.hp / CATALOG[b.kind].hp);
    for (const b of damaged)
      if (
        this.state.wood >= 4 &&
        this.beginTask({ type: 'repair', id: b.id, cell: b, remaining: 2 })
      )
        return;
    if (this.state.agentGoal === 'harvest') {
      this.state.agentStatus = this.planHarvest()
        ? '收集营地材料'
        : '没有可到达的资源';
      return;
    }
    if (this.state.agentGoal === 'repair') {
      this.state.agentStatus =
        damaged.length || this.state.health < 100
          ? '维修等待 · 缺少材料或通路'
          : '维修巡查 · 暂无可修理部件';
      return;
    }
    if (this.state.harvested < 3 && this.planHarvest()) return;
    const projects: { kind: Kind; cell: Cell; rotation: number }[] = [
      { kind: 'tower', cell: { x: -3, z: -3 }, rotation: 0 },
      { kind: 'tower', cell: { x: 3, z: -3 }, rotation: 0 },
      { kind: 'fence', cell: { x: 3, z: 3 }, rotation: 0 },
    ];
    for (const project of projects) {
      if (
        this.blocks.some(
          (b) =>
            b.kind === project.kind &&
            b.x === project.cell.x &&
            b.z === project.cell.z,
        )
      )
        continue;
      if (this.placementError(project.cell.x, project.cell.z, project.kind))
        continue;
      const cost = CATALOG[project.kind];
      if (this.state.wood < cost.wood) {
        if (!this.planHarvest('wood'))
          this.state.agentStatus = '等待可采集的木材';
        return;
      }
      if (this.state.stone < cost.stone) {
        if (!this.planHarvest('stone'))
          this.state.agentStatus = '等待可采集的石料';
        return;
      }
      if (this.beginTask({ type: 'build', ...project, remaining: 3 })) return;
    }
    this.state.agentStatus = projects.every((p) =>
      this.blocks.some(
        (b) => b.kind === p.kind && b.x === p.cell.x && b.z === p.cell.z,
      ),
    )
      ? '发展计划完成 · 巡查待命'
      : '建设等待 · 预定位置或通路被占用';
  }
  private updateAgent(dt: number) {
    const cell = this.currentCell();
    this.state.sheltered = this.shelters().some(
      (p) => p.x === cell.x && p.z === cell.z,
    );
    this.state.comfort = comfortAfter(
      this.state.comfort,
      this.state.weather,
      this.state.sheltered,
      dt,
    );
    if (
      this.state.sheltered &&
      !this.residentRoute.length &&
      !this.agentTask &&
      !this.residentJob
    ) {
      const nearby = this.blocks.filter(
        (b) =>
          (b.kind === 'bed' || b.kind === 'chair') &&
          Math.hypot(b.x - cell.x, b.z - cell.z) <= 1.5,
      );
      const bonus = nearby.some((b) => b.kind === 'bed')
        ? 2
        : nearby.length
          ? 1
          : 0;
      this.state.comfort = Math.min(100, this.state.comfort + bonus * dt);
    }
    const safety =
      this.shelterOrder ||
      (this.state.agentEnabled &&
        (this.state.weather !== 'clear' ||
          this.enemies.length > 0 ||
          this.state.hour >= 20 ||
          this.state.hour < 6));
    this.state.defending = Boolean(
      safety &&
      this.state.sheltered &&
      (this.enemies.length || this.state.weather === 'storm'),
    );
    this.defenseTimer -= dt;
    if (this.state.defending && this.defenseTimer <= 0) {
      this.defenseTimer = 1.2;
      const enemy = this.enemies.find(
        (e) => e.mesh.position.distanceTo(this.resident.root.position) < 8,
      );
      if (enemy) {
        this.resident.gesture('guard');
        this.burst(enemy.mesh.position, '#e9d698', 5);
        this.damageEnemy(enemy, 22);
      }
    }
    if (safety) {
      if (this.agentTask) {
        this.agentTask = null;
        this.residentRoute = [];
        this.residentJob = null;
      }
      this.state.agentStatus = this.state.sheltered
        ? this.state.defending
          ? '屋内守卫'
          : this.state.weather === 'rain'
            ? '屋内避雨'
            : '屋内休息'
        : this.state.agentStatus.startsWith('无可达')
          ? this.state.agentStatus
          : '正在回屋避险';
      if (this.state.sheltered) {
        if (
          Math.hypot(
            this.resident.root.position.x - cell.x * TILE,
            this.resident.root.position.z - cell.z * TILE,
          ) > 0.1
        ) {
          this.residentRoute = [cell];
          this.state.agentStatus = '进入屋内';
          return;
        }
        this.residentRoute = [];
        this.residentJob = {
          gesture: this.state.defending ? 'guard' : 'idle',
          tool: 'hammer',
          target: new THREE.Vector3(0, 0, 6),
          label: this.state.agentStatus,
        };
        this.residentWorkTime = 1;
        return;
      }
      this.agentTimer -= dt;
      if (this.agentTimer > 0) return;
      this.agentTimer = 1;
      const obstacles = this.residentObstacles();
      const routes = this.shelters()
        .map((p) => residentPath(cell, p, this.blocks, obstacles))
        .filter((r) => r.length)
        .sort((a, b) => a.length - b.length);
      if (routes[0]) {
        this.residentRoute = routes[0];
        this.state.agentStatus = '正在回屋避险';
      } else {
        this.residentRoute = [];
        this.state.agentStatus = '无可达安全屋 · 需要完整墙顶和入口';
      }
      return;
    }
    if (this.agentTask) {
      const task = this.agentTask;
      this.state.agentStatus = this.residentRoute.length
        ? '前往任务地点'
        : task.type === 'harvest'
          ? '正在采集'
          : task.type === 'repair'
            ? '正在维修'
            : '正在建造';
      if (this.residentRoute.length) return;
      if (Math.hypot(cell.x - task.cell.x, cell.z - task.cell.z) > 1.1) {
        this.agentTask = null;
        this.residentJob = null;
        this.state.agentStatus = '路线受阻 · 重新安排';
        return;
      }
      task.remaining -= dt * (0.5 + this.state.comfort / 200);
      this.residentJob = {
        gesture: 'work',
        tool: task.type === 'harvest' ? 'axe' : 'hammer',
        target: new THREE.Vector3(task.cell.x * TILE, 0, task.cell.z * TILE),
        label: this.state.agentStatus,
      };
      this.residentWorkTime = 1;
      if (task.remaining > 0) return;
      if (task.type === 'harvest') this.harvestResource(task.key);
      else if (task.type === 'repair') this.repairTarget(task.id);
      else this.buildTarget(task.kind, task.cell, task.rotation);
      this.agentTask = null;
      this.residentJob = null;
      this.agentTimer = 0.5;
      return;
    }
    if (!this.state.agentEnabled) return;
    this.agentTimer -= dt;
    if (this.agentTimer <= 0) {
      this.agentTimer = 2;
      this.planAgentTask();
    }
  }
  private updateShelterVisuals(dt: number) {
    const cell = this.currentCell();
    for (const b of this.blocks) {
      const mesh = this.blockMeshes.get(b.id);
      if (!mesh) continue;
      if (b.kind === 'roof')
        mesh.visible =
          !this.state.interiorView &&
          !(
            Math.abs(b.x - cell.x) <= 3 &&
            Math.abs(b.z - cell.z) <= 3 &&
            this.state.sheltered
          );
      const leaf = mesh.getObjectByName('door-leaf');
      if (leaf) {
        const near =
          Math.hypot(
            this.resident.root.position.x - b.x * TILE,
            this.resident.root.position.z - b.z * TILE,
          ) < 1.65;
        leaf.rotation.y = THREE.MathUtils.lerp(
          leaf.rotation.y,
          near ? -Math.PI / 2 : 0,
          1 - Math.exp(-dt * 12),
        );
      }
    }
  }
  interactNearby() {
    if (this.state.paused || this.state.health <= 0) return;
    if (this.mode === 'rotate') {
      this.rotate();
      return;
    }
    if (this.mode === 'remove') {
      this.notify('请点击需要拆除的部件');
      return;
    }
    this.takeManualControl();
    this.clearKeys();
    const cell = this.currentCell();
    const near = (p: Cell) =>
      Math.abs(p.x - cell.x) + Math.abs(p.z - cell.z) <= 1;
    if (this.mode === 'build') {
      const yaw = this.resident.root.rotation.y;
      const forward =
        Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw))
          ? { x: Math.sign(Math.sin(yaw)), z: 0 }
          : { x: 0, z: Math.sign(Math.cos(yaw)) };
      const target = { x: cell.x + forward.x, z: cell.z + forward.z };
      const error = this.placementError(target.x, target.z);
      if (error) this.notify(error);
      else if (this.buildCostError(this.selected))
        this.notify(this.buildCostError(this.selected)!);
      else
        this.beginTask({
          type: 'build',
          kind: this.selected,
          rotation: this.rotation,
          cell: target,
          remaining: 3,
        });
    } else if (this.mode === 'repair') {
      const b = this.blocks.find((b) => near(b) && b.hp < CATALOG[b.kind].hp);
      if (this.state.wood < 4) this.notify('维修需要 4 木材');
      else if (b)
        this.beginTask({ type: 'repair', id: b.id, cell: b, remaining: 2 });
      else if (near({ x: 0, z: 0 }) && this.state.health < 100)
        this.beginTask({
          type: 'repair',
          id: null,
          cell: { x: 0, z: 0 },
          remaining: 2,
        });
      else this.notify('附近没有受损部件');
    } else {
      const resource = [...this.resources.entries()].find(
        ([key, obj]) =>
          !this.depleted.has(key) &&
          near({
            x: Math.round(obj.position.x / TILE),
            z: Math.round(obj.position.z / TILE),
          }),
      );
      if (resource)
        this.beginTask({
          type: 'harvest',
          key: resource[0],
          cell: {
            x: Math.round(resource[1].position.x / TILE),
            z: Math.round(resource[1].position.z / TILE),
          },
          remaining: 2.5,
        });
      else this.notify('走近树木或岩石后再采集');
    }
    this.publish();
  }
  attackNearby() {
    if (this.state.paused || this.state.health <= 0 || this.defenseTimer > 0)
      return;
    this.takeManualControl();
    const enemy = this.enemies.find(
      (e) => e.mesh.position.distanceTo(this.resident.root.position) < 5,
    );
    if (!enemy) {
      this.notify('附近没有怪物');
      return;
    }
    this.defenseTimer = 0.65;
    this.residentAction(enemy.mesh.position, 'guard', '不许拆我的家！');
    this.damageEnemy(enemy, 36);
  }
  private makeGhost() {
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = new THREE.MeshStandardMaterial({
          color: '#a5e5a8',
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        });
        o.castShadow = false;
      }
    });
  }
  private clearGhost() {
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    disposeObject(this.ghost);
  }
  rotate() {
    this.rotateByQuarter(1);
  }
  rotateByQuarter(direction: -1 | 1) {
    if (this.mode === 'rotate') {
      const target = this.hoveredBlockId ?? this.rotationTargetId;
      if (target !== null) {
        const block = this.blocks.find((item) => item.id === target);
        if (block)
          this.rotateBlock(
            target,
            snapRotation(block.rotation) + direction * (Math.PI / 2),
          );
      }
      else this.notify('先选中需要旋转的建筑部件');
      return;
    }
    this.setBuildRotation(
      snapRotation(this.rotation) + direction * (Math.PI / 2),
    );
  }
  setBuildRotation(rotation: number) {
    if (!Number.isFinite(rotation)) return;
    this.rotation = snapRotation(rotation);
    this.refreshPreview();
    this.changed();
  }
  setRotation(rotation: number) {
    if (!Number.isFinite(rotation)) return;
    if (this.mode === 'rotate') {
      if (this.rotationTargetId !== null)
        this.rotateBlock(this.rotationTargetId, rotation, false);
    } else this.setBuildRotation(rotation);
  }
  private refreshPreview() {
    this.ghost.rotation.y = this.rotation;
    this.ghost.visible =
      this.mode === 'build' &&
      this.placementArmed &&
      this.previewCell !== null &&
      !this.state.paused &&
      this.state.health > 0;
    if (!this.previewCell) return;
    const { x, z } = this.previewCell;
    this.ghost.position.set(x * TILE, 0, z * TILE);
    const invalid =
      this.placementError(x, z) || this.buildCostError(this.selected);
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh)
        (o.material as THREE.MeshStandardMaterial).color.set(
          invalid ? '#e99183' : '#b3edb1',
        );
    });
  }
  private clearRotationOutline() {
    this.hoveredBlockId = null;
    if (!this.rotationOutline) return;
    this.rotationOutline.geometry.dispose();
    this.rotationOutline.material.dispose();
    this.rotationOutline.removeFromParent();
    this.rotationOutline = null;
  }
  private hoverRotationTarget() {
    const hit = this.ray.intersectObjects(
      [...this.blockMeshes.values()].filter((m) => m.visible),
      true,
    )[0];
    const id = hit
      ? (this.findRoot(hit.object, 'blockId')?.userData.blockId ?? null)
      : null;
    if (id === this.hoveredBlockId) return;
    this.clearRotationOutline();
    const mesh = this.blockMeshes.get(id);
    if (!mesh) return;
    this.hoveredBlockId = id;
    this.rotationOutline = new THREE.BoxHelper(mesh, '#63c6e5');
    this.scene.add(this.rotationOutline);
  }
  private rotateBlock(id: number, rotation?: number, announce = true) {
    if (this.state.paused || this.state.health <= 0) {
      this.notify('先继续游戏，再旋转建筑');
      return;
    }
    const block = this.blocks.find((b) => b.id === id);
    const mesh = this.blockMeshes.get(id);
    if (!block || !mesh) return;
    if (
      ['wall', 'door', 'fence', 'tower'].includes(block.kind) &&
      Math.hypot(
        this.resident.root.position.x - block.x * TILE,
        this.resident.root.position.z - block.z * TILE,
      ) < 1.15
    ) {
      this.notify('阿木还站在这里，先让他挪一挪');
      return;
    }
    this.takeManualControl();
    this.rotationTargetId = id;
    block.rotation = snapRotation(
      rotation ?? block.rotation + Math.PI / 2,
    );
    mesh.rotation.y = block.rotation;
    mesh.updateMatrixWorld(true);
    this.rotationOutline?.update();
    if (announce)
      this.notify(
        `${CATALOG[block.kind].name}已旋转至 ${Math.round((block.rotation * 180) / Math.PI)}°`,
      );
    this.changed();
  }
  toggleGrid(show: boolean) {
    this.grid.visible = show;
  }
  togglePause() {
    this.clearKeys();
    if (this.state.health <= 0) {
      this.state.paused = true;
      this.publish();
      return;
    }
    this.state.paused = !this.state.paused;
    this.publish();
  }
  setHour(hour: number) {
    this.state.hour = hour;
    this.publish();
    this.updateLighting();
  }
  setWeather(weather: Weather) {
    this.state.weather = weather;
    this.weatherTimer = 0;
    this.state.weatherRemaining = 45 + Math.random() * 75;
    this.publish();
    this.updateLighting();
  }
  setAutoWeather(enabled: boolean) {
    this.state.autoWeather = enabled;
    this.publish();
  }
  setSound(enabled: boolean) {
    this.sound = enabled;
    if (enabled) {
      this.audio ??= new AudioContext();
      void this.audio.resume();
      this.beep(440, 0.12);
    }
  }
  private beep(freq: number, duration = 0.08) {
    if (!this.sound || !this.audio) return;
    const osc = this.audio.createOscillator(),
      gain = this.audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, this.audio.currentTime);
    gain.gain.setValueAtTime(0.06, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      this.audio.currentTime + duration,
    );
    osc.connect(gain);
    gain.connect(this.audio.destination);
    osc.start();
    osc.stop(this.audio.currentTime + duration);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  private pointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch') this.touchCount++;
  };
  private pointerUp = (e: PointerEvent) => {
    const multi = this.touchCount > 1;
    if (e.pointerType === 'touch')
      this.touchCount = Math.max(0, this.touchCount - 1);
    if (
      e.button !== 0 ||
      multi ||
      Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7
    )
      return;
    this.act(e);
  };
  private pointerLeave = () => {
    this.ghost.visible = false;
    this.clearRotationOutline();
    if (this.mode === 'rotate' && this.rotationTargetId !== null) {
      const mesh = this.blockMeshes.get(this.rotationTargetId);
      if (mesh) {
        this.rotationOutline = new THREE.BoxHelper(mesh, '#63c6e5');
        this.scene.add(this.rotationOutline);
      }
    }
    this.touchCount = 0;
  };
  private rotationWheel = (e: WheelEvent) => {
    if (!e.shiftKey || (this.mode !== 'build' && this.mode !== 'rotate')) return;
    e.preventDefault();
    e.stopPropagation();
    this.rotateByQuarter(e.deltaY < 0 ? -1 : 1);
  };
  private contextMenu = (e: Event) => e.preventDefault();
  private projectPointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  private cellAtPointer() {
    const point = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, point)) return null;
    return { x: Math.round(point.x / TILE), z: Math.round(point.z / TILE) };
  }
  private pointerMove = (e: PointerEvent) => {
    this.projectPointer(e);
    if (this.mode === 'rotate') this.hoverRotationTarget();
    this.previewCell = this.cellAtPointer();
    this.refreshPreview();
  };
  private placementError(x: number, z: number, kind = this.selected) {
    if (
      (['wall', 'door', 'fence', 'tower'].includes(kind) ||
        (isFurniture(kind) && kind !== 'rug')) &&
      Math.hypot(
        this.resident.root.position.x - x * TILE,
        this.resident.root.position.z - z * TILE,
      ) < 1.15
    )
      return '阿木还站在这里，先让他挪一挪';
    if (isFurniture(kind) && kind !== 'rug') {
      const shelter = this.shelters();
      for (const door of this.blocks.filter((b) => b.kind === 'door')) {
        const entrances = neighbors(door).filter((p) =>
          shelter.some((s) => s.x === p.x && s.z === p.z),
        );
        if (
          entrances.some((p) => p.x === x && p.z === z) &&
          entrances.every(
            (p) => (p.x === x && p.z === z) || !walkable(p, this.blocks, []),
          )
        )
          return '这里是门内通道，请留出进出空间';
      }
    }
    return (
      canPlace(this.blocks, kind, x, z) ||
      ([...this.resources.entries()].some(
        ([key, obj]) =>
          !this.depleted.has(key) &&
          Math.hypot(obj.position.x - x * TILE, obj.position.z - z * TILE) <
            1.5,
      )
        ? '先采集这里的树木或岩石'
        : null)
    );
  }
  private findRoot(object: THREE.Object3D, key: string) {
    let obj: THREE.Object3D | null = object;
    while (obj) {
      if (obj.userData[key] !== undefined) return obj;
      obj = obj.parent;
    }
    return null;
  }
  private act(e: PointerEvent) {
    if (this.state.paused || this.state.health <= 0) {
      this.notify('先继续游戏，再进行操作');
      return;
    }
    this.takeManualControl();
    this.projectPointer(e);
    if (this.mode === 'rotate') {
      this.hoverRotationTarget();
      if (this.hoveredBlockId !== null) {
        const block = this.blocks.find((item) => item.id === this.hoveredBlockId);
        if (block)
          this.rotateBlock(
            block.id,
            snapRotation(block.rotation) +
              (e.shiftKey ? -Math.PI / 2 : Math.PI / 2),
          );
      }
      else this.notify('选中一个建筑部件');
      return;
    }
    const enemyHits = this.ray.intersectObjects(
      this.enemies.map((m) => m.mesh),
      true,
    );
    if (enemyHits.length) {
      const root = this.findRoot(enemyHits[0].object, 'enemy');
      const enemy = this.enemies.find((m) => m.mesh === root);
      if (enemy) {
        this.residentAction(
          enemy.mesh.position,
          'guard',
          '这可是我亲手盖的家！',
        );
        this.damageEnemy(enemy, 36);
        this.beep(200);
        this.publish();
        return;
      }
    }
    if (this.mode === 'walk') {
      if (this.ray.intersectObject(this.resident.root, true).length) {
        this.focusResident();
        return;
      }
      const cell = this.cellAtPointer();
      if (cell) {
        this.residentJob = null;
        this.residentWorkTime = 0;
        this.residentRoute = [];
        if (this.moveResident(cell)) this.resident.say('好，去那边看看。', 3);
      }
      return;
    }
    if (this.mode === 'harvest') {
      const hits = this.ray.intersectObjects(
        [...this.resources.values()].filter((m) => m.visible),
        true,
      );
      if (!hits.length) {
        this.notify('选中一棵树或一块岩石');
        return;
      }
      const obj = this.findRoot(hits[0].object, 'resource')!;
      const key = obj.userData.resource;
      this.harvestResource(key);
      this.residentAction(
        obj.position,
        'work',
        '这些材料，正好派上用场。',
        'axe',
      );
      const wood = obj.userData.resourceType === 'wood';
      this.notify(wood ? '获得 24 木材 · 6 纤维' : '获得 18 石料');
      this.beep(330);
      this.changed();
      return;
    }
    const hits = this.ray.intersectObjects(
      [...this.blockMeshes.values()].filter((mesh) => mesh.visible),
      true,
    );
    if (this.mode === 'repair' || this.mode === 'remove') {
      if (
        this.mode === 'repair' &&
        this.ray.intersectObject(this.hearth, true).length
      ) {
        if (this.state.health >= 100) {
          this.notify('家园核心完好无损');
          return;
        }
        if (this.state.wood < 4) {
          this.notify('修理需要 4 木材');
          return;
        }
        this.repairTarget(null);
        this.residentAction(
          this.hearth.position,
          'work',
          '修一修，家就又暖和了。',
        );
        this.changed();
        return;
      }
      if (!hits.length) {
        this.notify('选中一个建筑部件');
        return;
      }
      const root = this.findRoot(hits[0].object, 'blockId');
      const b = this.blocks.find((b) => b.id === root?.userData.blockId)!;
      if (this.mode === 'remove') {
        if (
          b.kind === 'floor' &&
          this.blocks.some(
            (other) =>
              other.x === b.x && other.z === b.z && isFurniture(other.kind),
          )
        ) {
          this.notify('请先收起地板上的家具');
          return;
        }
        if (isFurniture(b.kind)) {
          if (b.hp < CATALOG[b.kind].hp) {
            this.notify('家具已损坏，请先修好再收起');
            return;
          }
          if (this.state.furnitureStock[b.kind] >= 999) {
            this.notify('成品数量已达上限');
            return;
          }
          this.state.furnitureStock[b.kind]++;
        } else {
          this.state.wood += Math.floor(CATALOG[b.kind].wood / 2);
          this.state.stone += Math.floor(CATALOG[b.kind].stone / 2);
        }
        this.removeBlock(b);
        this.notify(
          isFurniture(b.kind)
            ? '家具已收起，可重新摆放'
            : '部件已拆除，返还一半材料',
        );
      } else {
        if (b.hp >= CATALOG[b.kind].hp) {
          this.notify('这个部件完好无损');
          return;
        }
        if (this.state.wood < 4) {
          this.notify('修理需要 4 木材');
          return;
        }
        this.repairTarget(b.id);
        this.notify(`修理完成 · 耐久 ${b.hp}/${CATALOG[b.kind].hp}`);
        this.blockMeshes.get(b.id)!.scale.set(1, 1, 1);
      }
      this.residentAction(
        new THREE.Vector3(b.x * TILE, 0, b.z * TILE),
        'work',
        this.mode === 'remove'
          ? '这里腾出来，重新想个好主意。'
          : '补好了，又能安心住啦。',
      );
      this.changed();
      return;
    }
    if (this.mode === 'build' && !this.placementArmed) {
      if (!hits.length) return;
      const root = this.findRoot(hits[0].object, 'blockId');
      const block = this.blocks.find(
        (item) => item.id === root?.userData.blockId,
      );
      if (block) this.rotateBlock(block.id);
      return;
    }
    let cell = this.cellAtPointer();
    if (this.selected === 'roof' && hits.length) {
      const root = this.findRoot(hits[0].object, 'blockId');
      const b = this.blocks.find((b) => b.id === root?.userData.blockId);
      if (b) cell = { x: b.x, z: b.z };
    }
    if (!cell) return;
    const invalid = this.placementError(cell.x, cell.z);
    if (invalid) {
      this.notify(invalid);
      return;
    }
    const costError = this.buildCostError(this.selected);
    if (costError) {
      this.notify(costError);
      return;
    }
    this.buildTarget(this.selected, cell, this.rotation);
    this.placementArmed = false;
    this.ghost.visible = false;
    this.residentAction(
      new THREE.Vector3(cell.x * TILE, 0, cell.z * TILE),
      'work',
      '一点一点，把家变成喜欢的样子。',
    );
    this.burst(
      new THREE.Vector3(cell.x * TILE, 0.5, cell.z * TILE),
      '#e5d5a0',
      8,
    );
    this.beep(520);
    this.changed();
  }
  private changed() {
    this.shelterCache = null;
    this.state.saved = false;
    this.publish();
  }
  private removeBlock(block: Block) {
    if (this.rotationTargetId === block.id) this.rotationTargetId = null;
    if (this.hoveredBlockId === block.id) this.clearRotationOutline();
    this.shelterCache = null;
    const mesh = this.blockMeshes.get(block.id);
    if (mesh) {
      this.burst(mesh.position, '#b79a6a', 12);
      disposeObject(mesh);
      this.blockMeshes.delete(block.id);
    }
    this.blocks = this.blocks.filter((b) => b.id !== block.id);
    if (block.kind === 'wall' || block.kind === 'door') {
      for (const roof of this.blocks.filter(
        (b) => b.x === block.x && b.z === block.z && b.kind === 'roof',
      ))
        this.removeBlock(roof);
    }
  }
  startRaid() {
    if (this.state.health <= 0 || this.state.paused) {
      this.notify('先继续游戏，再召唤怪物');
      return;
    }
    if (this.enemies.length) {
      this.notify('先击退正在来袭的怪物');
      return;
    }
    const n = Math.min(7, 2 + this.state.day);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Group();
      const body = box(mesh, 0.85, 0.85, 0.65, '#666b74', 0, 0.9, 0);
      body.rotation.z = 0.08;
      box(mesh, 0.72, 0.57, 0.63, '#788079', 0, 1.51, 0.04);
      for (const x of [-0.24, 0.24]) {
        box(mesh, 0.13, 0.1, 0.035, '#ffce85', x, 1.55, 0.37);
        const brow = box(mesh, 0.2, 0.06, 0.08, '#414b42', x, 1.68, 0.37);
        brow.rotation.z = x < 0 ? -0.25 : 0.25;
        cone(mesh, 0.12, 0.45, '#cecab0', x, 1.98, 0, 4);
        const leg = new THREE.Group();
        leg.name = x < 0 ? 'legLeft' : 'legRight';
        leg.position.set(x, 0.55, 0);
        box(leg, 0.25, 0.5, 0.32, '#505961', 0, -0.2, 0.04);
        mesh.add(leg);
      }
      box(mesh, 0.33, 0.12, 0.14, '#464b42', 0, 1.31, 0.34);
      box(mesh, 0.1, 0.15, 0.06, '#e8dfbd', -0.08, 1.29, 0.43);
      box(mesh, 0.1, 0.15, 0.06, '#e8dfbd', 0.08, 1.29, 0.43);
      box(
        mesh,
        0.85,
        0.18,
        0.7,
        ['#a96f54', '#7b7eab', '#bd9f61'][i % 3],
        0,
        1.19,
        0,
      );
      for (const x of [-0.57, 0.57]) {
        const arm = new THREE.Group();
        arm.name = x < 0 ? 'armLeft' : 'armRight';
        arm.position.set(x, 1.2, 0);
        box(arm, 0.28, 0.75, 0.3, '#555e61', 0, -0.3, 0);
        mesh.add(arm);
      }
      mesh.position.set(-22 + i * 3, 0, -19 - i * 1.7);
      mesh.userData = { enemy: true };
      this.scene.add(mesh);
      this.enemies.push({
        mesh,
        hp: 100,
        cooldown: 0,
        path: [],
        repath: 0,
        target: null,
        phase: i,
        speed: [1.35, 1.6, 1.45][i % 3],
        hurt: 0,
      });
    }
    this.state.nextRaid = 150;
    this.notify('林中传来异响，怪物正在靠近家园');
    this.beep(120, 0.4);
    this.publish();
  }
  private damageEnemy(enemy: Enemy, damage: number) {
    enemy.hp -= damage;
    enemy.hurt = 0.35;
    this.burst(
      enemy.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)),
      '#efca85',
      5,
    );
    if (enemy.hp <= 0) {
      disposeObject(enemy.mesh);
      this.enemies = this.enemies.filter((e) => e !== enemy);
      this.state.defeated++;
      this.state.wood += 8;
      this.state.stone += 4;
      if (!this.enemies.length) {
        this.residentAction(
          this.resident.root.position,
          'wave',
          '呼，守住啦！小屋还好好的。',
        );
        this.notify('来袭已被击退，林间恢复了宁静');
        this.state.nextRaid = 140;
      }
    }
  }
  private updateEnemies(dt: number) {
    for (const enemy of [...this.enemies]) {
      enemy.hurt = Math.max(0, enemy.hurt - dt);
      enemy.cooldown -= dt;
      enemy.repath -= dt;
      if (enemy.repath <= 0) {
        enemy.repath = 1.5;
        const candidates = this.blocks.filter(
          (b) => b.kind !== 'roof' && b.kind !== 'floor' && b.kind !== 'rug',
        );
        const nearest = candidates.sort(
          (a, b) =>
            Math.hypot(
              a.x * TILE - enemy.mesh.position.x,
              a.z * TILE - enemy.mesh.position.z,
            ) -
            Math.hypot(
              b.x * TILE - enemy.mesh.position.x,
              b.z * TILE - enemy.mesh.position.z,
            ),
        )[0];
        enemy.target = nearest?.id ?? null;
        const tx = nearest?.x ?? 0,
          tz = nearest?.z ?? 0;
        const grid = Array.from({ length: 39 }, () => Array(39).fill(1));
        for (let x = 0; x < 39; x++)
          for (let z = 0; z < 39; z++) if (x - 19 >= 7) grid[x][z] = 0;
        for (const b of candidates) grid[b.x + 19][b.z + 19] = 0;
        grid[tx + 19][tz + 19] = 1;
        const graph = new Graph(grid, { diagonal: true });
        const sx = THREE.MathUtils.clamp(
            Math.round(enemy.mesh.position.x / TILE) + 19,
            0,
            38,
          ),
          sz = THREE.MathUtils.clamp(
            Math.round(enemy.mesh.position.z / TILE) + 19,
            0,
            38,
          );
        enemy.path = astar.search(
          graph,
          graph.grid[sx][sz],
          graph.grid[tx + 19][tz + 19],
          { closest: true },
        );
      }
      const target = this.blocks.find((b) => b.id === enemy.target);
      const dest = new THREE.Vector3(
        (target?.x ?? 0) * TILE,
        0,
        (target?.z ?? 0) * TILE,
      );
      const distance = enemy.mesh.position.clone().setY(0).distanceTo(dest);
      if (distance < 1.85) {
        if (enemy.cooldown <= 0) {
          enemy.cooldown = 1.1;
          this.burst(
            dest.clone().add(new THREE.Vector3(0, 1, 0)),
            '#bd9e71',
            5,
          );
          if (target) {
            const guarded =
              this.state.defending &&
              dest.distanceTo(this.resident.root.position) < 6;
            target.hp -= guarded ? 9 : 18;
            const mesh = this.blockMeshes.get(target.id);
            if (mesh) mesh.scale.y = 0.96;
            if (target.hp <= 0) {
              this.removeBlock(target);
              enemy.repath = 0;
              this.notify('一处建筑被怪物拆毁了');
            }
          } else {
            this.state.health = Math.max(0, this.state.health - 6);
            if (!this.state.health) {
              this.state.paused = true;
              this.save();
            }
          }
          this.changed();
        }
      } else {
        const next = enemy.path[0];
        if (next) {
          const waypoint = new THREE.Vector3(
            (next.x - 19) * TILE,
            0,
            (next.y - 19) * TILE,
          );
          const delta = waypoint.sub(enemy.mesh.position.clone().setY(0));
          if (delta.length() < 0.3) enemy.path.shift();
          else {
            enemy.mesh.position.addScaledVector(
              delta.normalize(),
              dt * enemy.speed,
            );
            enemy.mesh.rotation.y = Math.atan2(delta.x, delta.z);
          }
        }
      }
      enemy.mesh.position.y =
        Math.abs(Math.sin(this.elapsed * 5 + enemy.phase)) * 0.12;
      const attacking = distance < 1.85;
      for (const [name, sign] of [
        ['legLeft', 1],
        ['legRight', -1],
        ['armLeft', -1],
        ['armRight', 1],
      ] as const) {
        const limb = enemy.mesh.getObjectByName(name)!;
        limb.rotation.x =
          attacking && name.startsWith('arm')
            ? -0.9 - Math.sin((1.1 - enemy.cooldown) * 9) * 0.8
            : Math.sin(this.elapsed * 6 + enemy.phase) * 0.6 * sign;
      }
      enemy.mesh.rotation.z =
        enemy.hurt > 0
          ? Math.sin(enemy.hurt * 40) * 0.17
          : attacking
            ? Math.sin(this.elapsed * 8) * 0.06
            : 0;
    }
    this.towerTimer += dt;
    if (this.towerTimer > 1) {
      this.towerTimer = 0;
      for (const tower of this.blocks.filter((b) => b.kind === 'tower')) {
        const from = new THREE.Vector3(tower.x * TILE, 3.4, tower.z * TILE);
        const enemy = this.enemies.find(
          (e) => e.mesh.position.distanceTo(from) < 24,
        );
        if (enemy) {
          const geometry = new THREE.BufferGeometry().setFromPoints([
            from,
            enemy.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)),
          ]);
          const beam = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({ color: '#f4dc8e' }),
          );
          this.scene.add(beam);
          this.damageEnemy(enemy, 30);
          const timer = setTimeout(() => {
            beam.geometry.dispose();
            (beam.material as THREE.Material).dispose();
            beam.removeFromParent();
            this.beamTimers.delete(timer);
          }, 160);
          this.beamTimers.add(timer);
        }
      }
    }
  }
  private beamTimers = new Set<ReturnType<typeof setTimeout>>();
  private durabilityBar(mesh: THREE.Group, ratio: number, height: number) {
    let bar = mesh.getObjectByName('durability');
    if (ratio >= 1) {
      if (bar) bar.visible = false;
      return;
    }
    if (!bar) {
      bar = new THREE.Group();
      bar.name = 'durability';
      const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.35, 0.12),
        mat('#503e36', { depthTest: false }),
      );
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(1.27, 0.065),
        mat('#abc98a', { depthTest: false }),
      );
      fill.name = 'fill';
      fill.position.z = 0.01;
      bar.add(bg, fill);
      mesh.add(bar);
    }
    bar.visible = true;
    bar.position.y = height;
    bar.quaternion.copy(
      mesh.quaternion.clone().invert().multiply(this.camera.quaternion),
    );
    const fill = bar.getObjectByName('fill')!;
    fill.scale.x = Math.max(0, ratio);
    fill.position.x = -(1 - ratio) * 0.635;
  }
  private burst(position: THREE.Vector3, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        mat(color),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          2 + Math.random() * 2,
          (Math.random() - 0.5) * 3,
        ),
        life: 0.6 + Math.random() * 0.4,
      });
    }
  }
  private updateLighting(dt = 1 / 60, immediate = false) {
    const h = this.state.hour;
    const sunUp = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const daylight = 0.18 + 0.82 * sunUp;
    const rainy = this.state.weather !== 'clear';
    // One lighting writer per frame: weather changes must not compete with flashes.
    const blend = immediate ? 1 : 1 - Math.exp(-Math.max(0, dt) * 3);
    this.sun.intensity = THREE.MathUtils.lerp(
      this.sun.intensity,
      (0.25 + sunUp * 2.8) * (rainy ? 0.4 : 1),
      blend,
    );
    this.ambient.intensity = THREE.MathUtils.lerp(
      this.ambient.intensity,
      (0.55 + daylight * 1.5) * (rainy ? 0.75 : 1),
      blend,
    );
    this.sun.color.lerp(
      new THREE.Color(h > 16 && h < 20 ? '#ffd09b' : '#fff2d8'),
      blend,
    );
    this.sun.position.lerp(
      new THREE.Vector3(
        Math.cos(((h - 6) / 12) * Math.PI) * -30,
        Math.max(8, sunUp * 45),
        22,
      ),
      blend,
    );
    const sky = new THREE.Color('#334e69').lerp(
      new THREE.Color(rainy ? '#a2b7b9' : '#c8e0dd'),
      daylight,
    );
    (this.scene.background as THREE.Color).lerp(sky, blend);
    (this.scene.fog as THREE.Fog).color.copy(
      this.scene.background as THREE.Color,
    );
    this.rain.visible = rainy;
    this.fireLight.intensity = THREE.MathUtils.lerp(
      this.fireLight.intensity,
      6 + (1 - daylight) * 12,
      blend,
    );
  }
  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update();
    if (!this.state.paused && this.state.health > 0 && !document.hidden) {
      this.elapsed += dt;
      this.state.hour += (dt * 24) / this.state.daySeconds;
      if (this.state.hour >= 24) {
        this.state.hour -= 24;
        this.state.day++;
        this.randomizeDay();
        this.state.wood += 30;
        this.notify('新的一天到了 · 获得 30 木材');
      }
      this.state.nextRaid = Math.max(0, this.state.nextRaid - dt);
      if (!this.enemies.length && this.state.nextRaid <= 0) this.startRaid();
      this.weatherTimer += dt;
      if (this.state.autoWeather)
        this.state.weatherRemaining = Math.max(
          0,
          this.state.weatherRemaining - dt,
        );
      if (this.state.autoWeather && this.state.weatherRemaining <= 0) {
        const next = randomWeather(this.state.weather);
        this.setWeather(next.weather);
        this.state.weatherRemaining = next.duration;
      }
      this.updateAgent(dt);
      this.updateEnemies(dt);
      this.updateResident(dt);
      if ((this.state.agentEnabled || this.shelterOrder) && !this.heldKeys.size)
        this.state.residentActivity = this.state.agentStatus;
      this.updateShelterVisuals(dt);
      for (const tree of this.trees) {
        tree.rotation.z =
          Math.sin(this.elapsed * 1.1 + tree.position.x) *
          0.012 *
          (this.state.weather === 'storm' ? 3 : 1);
      }
      for (const cloud of this.clouds) {
        cloud.position.x += dt * 0.12;
        if (cloud.position.x > 65) cloud.position.x = -65;
      }
      this.ripples.forEach((r, i) => {
        r.position.z += dt * 0.32;
        if (r.position.z > 65) r.position.z = -65;
        r.scale.x = 0.7 + Math.sin(this.elapsed * 1.7 + i) * 0.3;
      });
      this.smoke.forEach((p, i) => {
        const t = (this.elapsed * 0.45 + i * 0.32) % 3;
        p.position.set(-2 + t * 0.35, 5.2 + t, -2);
        p.scale.setScalar(0.6 + t * 0.3);
        (p.material as THREE.MeshStandardMaterial).opacity = (1 - t / 3) * 0.28;
      });
      if (this.rain.visible) {
        const p = this.rain.geometry.attributes.position;
        const roofs = new Set(
          this.blocks
            .filter((b) => b.kind === 'roof')
            .map((b) => `${b.x},${b.z}`),
        );
        for (let i = 0; i < p.count; i += 2) {
          const y = p.getY(i) - dt * (this.state.weather === 'storm' ? 20 : 13);
          const covered = roofs.has(
            `${Math.round(p.getX(i) / TILE)},${Math.round(p.getZ(i) / TILE)}`,
          );
          const nextY = y < (covered ? 4.6 : 0) ? 26 : y;
          p.setY(i, nextY);
          p.setY(i + 1, nextY - 0.8);
        }
        p.needsUpdate = true;
      }
      for (const particle of this.particles) {
        particle.life -= dt;
        particle.velocity.y -= dt * 6;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.x += dt * 3;
      }
      this.particles = this.particles.filter((p) => {
        if (p.life <= 0) {
          disposeObject(p.mesh);
          return false;
        }
        return true;
      });
      this.saveTimer += dt;
      if (this.saveTimer > 15) {
        this.saveTimer = 0;
        this.save();
      }
    }
    for (const block of this.blocks) {
      const mesh = this.blockMeshes.get(block.id);
      if (mesh)
        this.durabilityBar(
          mesh,
          block.hp / CATALOG[block.kind].hp,
          block.kind === 'tower' ? 4.7 : block.kind === 'roof' ? 5.5 : 3.1,
        );
    }
    for (const enemy of this.enemies)
      this.durabilityBar(enemy.mesh, enemy.hp / 100, 2.4);
    this.updateLighting(dt);
    this.uiTimer += dt;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.publish();
    }
    this.renderer.render(this.scene, this.camera);
  };
  restart() {
    this.rotationTargetId = null;
    this.placementArmed = false;
    this.clearRotationOutline();
    this.previewCell = null;
    this.ghost.visible = false;
    for (const mesh of this.blockMeshes.values()) disposeObject(mesh);
    this.blockMeshes.clear();
    this.blocks = [];
    for (const enemy of this.enemies) disposeObject(enemy.mesh);
    this.enemies = [];
    this.depleted.clear();
    for (const res of this.resources.values()) res.visible = true;
    this.state = initialSnapshot();
    this.takeManualControl();
    this.clearKeys();
    this.shelterCache = null;
    this.randomizeDay();
    this.state.hour = 8 + Math.random() * 3;
    this.state.weatherRemaining = 45 + Math.random() * 75;
    this.residentRoute = [];
    this.residentJob = null;
    this.residentWorkTime = 0;
    this.residentIdleTime = 0;
    this.resident.root.position.set(2, 0, 6);
    this.resident.gesture('idle');
    this.resident.say('重新来过，也是一件好事。');
    this.nextId = 1;
    this.weatherTimer = 0;
    this.saveTimer = 0;
    this.towerTimer = 0;
    this.starter();
    this.resetCamera();
    this.save();
    this.notify('新家园已准备好');
  }
  private keyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target?.closest('input, textarea, select, [contenteditable="true"]') ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    const key = e.code === 'KeyR' ? 'r' : e.key.toLowerCase();
    if (
      [
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
      ].includes(key)
    ) {
      e.preventDefault();
      if (!this.state.paused && this.state.health > 0) {
        if (!this.heldKeys.has(key)) this.takeManualControl();
        this.heldKeys.add(key);
      }
      return;
    }
    if (e.repeat) return;
    if (key === 'r') {
      e.preventDefault();
      this.rotate();
    }
    if (key === 't') this.setAgent(!this.state.agentEnabled);
    if (key === 'h') this.seekShelter();
    if (key === 'e') this.interactNearby();
    if (key === 'f') this.attackNearby();
    if (e.key === ' ') {
      if (target?.closest('button')) return;
      e.preventDefault();
      this.togglePause();
    }
    if (e.key === 'Escape' && this.state.health > 0) this.togglePause();
  };
  private keyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.key.toLowerCase());
  };
  private clearKeys = () => {
    this.heldKeys.clear();
  };
  private pageHide = () => this.save();
  private visibility = () => {
    this.clearKeys();
    this.clock.getDelta();
  };
  dispose() {
    if (this.disposed) return;
    this.save();
    this.disposed = true;
    this.clearRotationOutline();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.rotationWheel, {
      capture: true,
    });
    this.renderer.domElement.removeEventListener(
      'pointermove',
      this.pointerMove,
    );
    this.renderer.domElement.removeEventListener(
      'pointerleave',
      this.pointerLeave,
    );
    this.renderer.domElement.removeEventListener(
      'contextmenu',
      this.contextMenu,
    );
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('pagehide', this.pageHide);
    document.removeEventListener('visibilitychange', this.visibility);
    for (const timer of this.beamTimers) clearTimeout(timer);
    this.resident.dispose();
    this.scene.traverse((o) => {
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.Line ||
        o instanceof THREE.Points
      ) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
    materials.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
  }
}
