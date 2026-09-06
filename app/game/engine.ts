import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import pathfinding from 'javascript-astar';
import {
  CATALOG,
  canPlace,
  initialSnapshot,
  validSave,
  type Block,
  type Kind,
  type Mode,
  type Snapshot,
  type Weather,
} from './model';

const { Graph, astar } = pathfinding;
const TILE = 2;
const SAVE_KEY = 'wildwood-save-v1';
type Enemy = {
  mesh: THREE.Group;
  hp: number;
  cooldown: number;
  path: { x: number; y: number }[];
  repath: number;
  target: number | null;
  phase: number;
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
  private rotation = 0;
  private nextId = 1;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private uiTimer = 0;
  private saveTimer = 0;
  private weatherTimer = 0;
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
    this.renderer.domElement.addEventListener(
      'pointerleave',
      this.pointerLeave,
    );
    this.renderer.domElement.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('keydown', this.keyDown);
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
    const person = new THREE.Group();
    box(person, 0.46, 0.57, 0.28, '#e2b579', 0, 0.8, 0);
    box(person, 0.4, 0.4, 0.36, '#ecc6a0', 0, 1.25, 0);
    box(person, 0.53, 0.15, 0.48, '#537467', 0, 1.49, 0);
    box(person, 0.17, 0.45, 0.2, '#4c645f', -0.13, 0.3, 0);
    box(person, 0.17, 0.45, 0.2, '#4c645f', 0.13, 0.3, 0);
    person.position.set(1.8, 0, 5.6);
    person.rotation.y = 0.6;
    this.scene.add(person);
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
        box(group, 0.96, 1.95, 0.15, '#8d7654', 0, 1.24, 0.05);
        for (let i = 0; i < 4; i++)
          box(group, 0.018, 1.8, 0.02, '#725f41', -0.35 + i * 0.23, 1.25, 0.14);
        box(group, 0.11, 0.12, 0.09, '#d8c47d', 0.29, 1.25, 0.18);
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
    const block = { kind, x, z, rotation, hp, id };
    this.blocks.push(block);
    this.nextId = Math.max(this.nextId, id + 1);
    const cabin = kind === 'roof' && Math.abs(x) <= 2 && Math.abs(z) <= 2;
    const mesh = cabin ? this.cabinRoof(x) : this.makeBlock(kind);
    mesh.position.set(x * TILE, 0, z * TILE);
    mesh.rotation.y = cabin ? 0 : rotation;
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
            ...data.state,
            paused: false,
            monsters: 0,
            saved: true,
            nextRaid: Math.max(30, data.state.nextRaid),
          };
          this.rotation = data.rotation;
          data.blocks.forEach((b) =>
            this.addBlock(b.kind, b.x, b.z, b.rotation, b.hp, b.id),
          );
          data.depleted.forEach((key) => {
            this.depleted.add(key);
            const tree = this.resources.get(key);
            if (tree) tree.visible = false;
          });
          loaded = true;
        } else this.notify('旧存档无法读取，已建立新家园');
      }
    } catch {
      this.notify('存档不可用，本次仍可继续游玩');
    }
    if (!loaded) this.starter();
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
    this.onState({ ...this.state });
  }
  select(kind: Kind, mode: Mode) {
    this.selected = kind;
    this.mode = mode;
    this.clearGhost();
    this.ghost = this.makeBlock(kind);
    this.makeGhost();
    this.scene.add(this.ghost);
    this.ghost.visible = false;
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
    this.rotation = (this.rotation + Math.PI / 2) % (Math.PI * 2);
    this.ghost.rotation.y = this.rotation;
    this.notify('部件已旋转 90°');
  }
  toggleGrid(show: boolean) {
    this.grid.visible = show;
  }
  togglePause() {
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
    this.touchCount = 0;
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
    const cell = this.cellAtPointer();
    this.ghost.visible = this.mode === 'build' && !!cell && !this.state.paused;
    if (!cell) return;
    this.ghost.position.set(cell.x * TILE, 0, cell.z * TILE);
    this.ghost.rotation.y = this.rotation;
    const invalid = this.placementError(cell.x, cell.z);
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh)
        (o.material as THREE.MeshStandardMaterial).color.set(
          invalid ? '#e99183' : '#b3edb1',
        );
    });
  };
  private placementError(x: number, z: number) {
    return (
      canPlace(this.blocks, this.selected, x, z) ||
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
    this.projectPointer(e);
    const enemyHits = this.ray.intersectObjects(
      this.enemies.map((m) => m.mesh),
      true,
    );
    if (enemyHits.length) {
      const root = this.findRoot(enemyHits[0].object, 'enemy');
      const enemy = this.enemies.find((m) => m.mesh === root);
      if (enemy) {
        this.damageEnemy(enemy, 36);
        this.beep(200);
        this.publish();
        return;
      }
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
      this.depleted.add(key);
      obj.visible = false;
      const wood = obj.userData.resourceType === 'wood';
      if (wood) this.state.wood += 24;
      else this.state.stone += 18;
      this.state.harvested++;
      this.burst(obj.position, wood ? '#bca477' : '#b0bcb0', 12);
      this.notify(wood ? '获得 24 木材' : '获得 18 石料');
      this.beep(330);
      this.changed();
      return;
    }
    const hits = this.ray.intersectObjects(
      [...this.blockMeshes.values()],
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
        this.state.wood -= 4;
        this.state.health = Math.min(100, this.state.health + 20);
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
        this.state.wood += Math.floor(CATALOG[b.kind].wood / 2);
        this.state.stone += Math.floor(CATALOG[b.kind].stone / 2);
        this.removeBlock(b);
        this.notify('部件已拆除，返还一半材料');
      } else {
        if (b.hp >= CATALOG[b.kind].hp) {
          this.notify('这个部件完好无损');
          return;
        }
        if (this.state.wood < 4) {
          this.notify('修理需要 4 木材');
          return;
        }
        this.state.wood -= 4;
        b.hp = Math.min(CATALOG[b.kind].hp, b.hp + 45);
        this.notify(`修理完成 · 耐久 ${b.hp}/${CATALOG[b.kind].hp}`);
        this.blockMeshes.get(b.id)!.scale.set(1, 1, 1);
      }
      this.changed();
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
    const cost = CATALOG[this.selected];
    if (this.state.wood < cost.wood || this.state.stone < cost.stone) {
      this.notify('材料不够了，去采集一些树木和岩石吧');
      return;
    }
    this.state.wood -= cost.wood;
    this.state.stone -= cost.stone;
    this.addBlock(this.selected, cell.x, cell.z, this.rotation);
    this.state.built++;
    this.burst(
      new THREE.Vector3(cell.x * TILE, 0.5, cell.z * TILE),
      '#e5d5a0',
      8,
    );
    this.beep(520);
    this.changed();
  }
  private changed() {
    this.state.saved = false;
    this.publish();
  }
  private removeBlock(block: Block) {
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
        cone(mesh, 0.12, 0.45, '#cecab0', x, 1.98, 0, 4);
        box(mesh, 0.23, 0.42, 0.28, '#505961', x, 0.32, 0);
      }
      box(mesh, 0.28, 0.75, 0.3, '#555e61', -0.57, 0.9, 0);
      box(mesh, 0.28, 0.75, 0.3, '#555e61', 0.57, 0.9, 0);
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
      });
    }
    this.state.nextRaid = 150;
    this.notify('林中传来异响，怪物正在靠近家园');
    this.beep(120, 0.4);
    this.publish();
  }
  private damageEnemy(enemy: Enemy, damage: number) {
    enemy.hp -= damage;
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
        this.notify('来袭已被击退，林间恢复了宁静');
        this.state.nextRaid = 140;
      }
    }
  }
  private updateEnemies(dt: number) {
    for (const enemy of [...this.enemies]) {
      enemy.cooldown -= dt;
      enemy.repath -= dt;
      if (enemy.repath <= 0) {
        enemy.repath = 1.5;
        const candidates = this.blocks.filter(
          (b) => b.kind !== 'roof' && b.kind !== 'floor',
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
            target.hp -= 18;
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
            enemy.mesh.position.addScaledVector(delta.normalize(), dt * 1.45);
            enemy.mesh.rotation.y = Math.atan2(delta.x, delta.z);
          }
        }
      }
      enemy.mesh.position.y =
        Math.abs(Math.sin(this.elapsed * 5 + enemy.phase)) * 0.12;
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
  private updateLighting() {
    const h = this.state.hour;
    const sunUp = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const daylight = 0.18 + 0.82 * sunUp;
    const rainy = this.state.weather !== 'clear';
    this.sun.intensity = (0.25 + sunUp * 2.8) * (rainy ? 0.4 : 1);
    this.ambient.intensity = (0.55 + daylight * 1.5) * (rainy ? 0.75 : 1);
    this.sun.color.set(h > 16 && h < 20 ? '#ffd09b' : '#fff2d8');
    this.sun.position.set(
      Math.cos(((h - 6) / 12) * Math.PI) * -30,
      Math.max(8, sunUp * 45),
      22,
    );
    const sky = new THREE.Color('#334e69').lerp(
      new THREE.Color(rainy ? '#a2b7b9' : '#c8e0dd'),
      daylight,
    );
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.rain.visible = rainy;
    this.fireLight.intensity = 6 + (1 - daylight) * 12;
  }
  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update();
    if (!this.state.paused && !document.hidden) {
      this.elapsed += dt;
      this.state.hour += dt * 0.08;
      if (this.state.hour >= 24) {
        this.state.hour -= 24;
        this.state.day++;
        this.state.wood += 30;
        this.notify('新的一天到了 · 获得 30 木材');
      }
      this.state.nextRaid = Math.max(0, this.state.nextRaid - dt);
      if (!this.enemies.length && this.state.nextRaid <= 0) this.startRaid();
      this.weatherTimer += dt;
      if (this.state.autoWeather && this.weatherTimer > 65) {
        const choices: Weather[] = ['clear', 'rain', 'clear', 'storm'];
        this.setWeather(choices[Math.floor(Math.random() * choices.length)]);
      }
      this.updateEnemies(dt);
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
        for (let i = 0; i < p.count; i += 2) {
          const y = p.getY(i) - dt * (this.state.weather === 'storm' ? 20 : 13);
          p.setY(i, y < 0 ? 26 : y);
          p.setY(i + 1, (y < 0 ? 26 : y) - 0.8);
        }
        p.needsUpdate = true;
      }
      if (
        this.state.weather === 'storm' &&
        Math.sin(this.elapsed * 2.7) > 0.997
      )
        this.sun.intensity = 7;
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
    this.uiTimer += dt;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.updateLighting();
      this.publish();
    }
    this.renderer.render(this.scene, this.camera);
  };
  restart() {
    for (const mesh of this.blockMeshes.values()) disposeObject(mesh);
    this.blockMeshes.clear();
    this.blocks = [];
    for (const enemy of this.enemies) disposeObject(enemy.mesh);
    this.enemies = [];
    this.depleted.clear();
    for (const res of this.resources.values()) res.visible = true;
    this.state = initialSnapshot();
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
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'r') this.rotate();
    if (e.key === ' ') {
      e.preventDefault();
      this.togglePause();
    }
    if (e.key === 'Escape' && this.state.health > 0) this.togglePause();
  };
  private pageHide = () => this.save();
  private visibility = () => {
    this.clock.getDelta();
  };
  dispose() {
    if (this.disposed) return;
    this.save();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
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
    window.removeEventListener('pagehide', this.pageHide);
    document.removeEventListener('visibilitychange', this.visibility);
    for (const timer of this.beamTimers) clearTimeout(timer);
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
