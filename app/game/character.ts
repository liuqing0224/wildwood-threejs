import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type Gesture = 'idle' | 'walk' | 'work' | 'wave' | 'guard';
export type Mood = 'content' | 'rainy' | 'sleepy' | 'brave';
export const MOOD_LABELS: Record<Mood, string> = {
  content: '今天也想把家盖好',
  rainy: '雨声也很好听',
  sleepy: '灯还亮着，心就安稳',
  brave: '这可是我的家！',
};

export class Resident {
  root = new THREE.Group();
  private head = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private brows: THREE.Mesh[] = [];
  private hammer = new THREE.Group();
  private axe = new THREE.Group();
  private umbrella = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<Gesture, THREE.AnimationAction>();
  private current: Gesture = 'idle';
  private time = 0;
  private speechTime = 0;
  private bubble: THREE.Sprite;
  private speechCanvas = document.createElement('canvas');
  private speechTexture: THREE.CanvasTexture;
  mood: Mood = 'content';
  speech = '';

  constructor() {
    this.root.name = 'amu';
    const skin = '#e9b98e',
      shirt = '#e7bc6e',
      denim = '#527d80';
    const part = (
      parent: THREE.Object3D,
      size: number[],
      color: string,
      at: number[],
    ) => {
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(
          size[0],
          size[1],
          size[2],
          2,
          Math.min(...size) * 0.18,
        ),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
      );
      mesh.position.set(at[0], at[1], at[2]);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const joint = (name: string, at: number[]) => {
      const group = new THREE.Group();
      group.name = name;
      group.position.set(at[0], at[1], at[2]);
      this.root.add(group);
      return group;
    };
    part(this.root, [0.68, 0.75, 0.43], shirt, [0, 1.35, 0]);
    part(this.root, [0.55, 0.4, 0.07], denim, [0, 1.12, 0.25]);
    for (const x of [-0.2, 0.2]) {
      part(this.root, [0.09, 0.66, 0.07], denim, [x, 1.41, 0.25]);
      part(this.root, [0.07, 0.07, 0.04], '#f5d68c', [x, 1.46, 0.3]);
    }
    part(this.root, [0.55, 0.63, 0.24], '#a88660', [0, 1.38, -0.34]);
    part(this.root, [0.63, 0.15, 0.25], '#bf9c70', [0, 1.74, -0.34]);
    part(this.root, [0.72, 0.15, 0.47], '#b96d56', [0, 1.77, 0]);
    part(this.root, [0.16, 0.35, 0.06], '#b96d56', [0.2, 1.59, 0.3]);
    for (const [side, x] of [
      ['Left', -0.21],
      ['Right', 0.21],
    ] as const) {
      const leg = joint(`leg${side}`, [x, 0.99, 0]);
      part(leg, [0.25, 0.68, 0.31], denim, [0, -0.3, 0]);
      part(leg, [0.29, 0.22, 0.46], '#635647', [0, -0.72, 0.07]);
    }
    const arms: THREE.Group[] = [];
    for (const [side, x] of [
      ['Left', -0.48],
      ['Right', 0.48],
    ] as const) {
      const arm = joint(`arm${side}`, [x, 1.64, 0]);
      part(arm, [0.27, 0.51, 0.3], shirt, [0, -0.21, 0]);
      part(arm, [0.23, 0.27, 0.25], skin, [0, -0.58, 0]);
      arms.push(arm);
    }
    this.head.name = 'head';
    this.head.position.y = 2.12;
    this.root.add(this.head);
    part(this.head, [0.77, 0.74, 0.64], skin, [0, 0, 0]);
    part(this.head, [0.8, 0.27, 0.65], '#635044', [0, 0.28, -0.015]);
    for (const x of [-0.39, 0.39])
      part(this.head, [0.15, 0.23, 0.21], skin, [x, -0.035, 0]);
    part(this.head, [0.17, 0.15, 0.14], '#daa079', [0, -0.045, 0.37]);
    for (const x of [-0.2, 0.2]) {
      part(this.head, [0.18, 0.2, 0.04], '#fff5de', [x, 0.035, 0.322]);
      const eye = part(this.head, [0.084, 0.115, 0.045], '#333b31', [
        x,
        0.02,
        0.351,
      ]);
      this.eyes.push(eye);
      const brow = part(this.head, [0.21, 0.045, 0.05], '#674f3d', [
        x,
        0.205,
        0.335,
      ]);
      this.brows.push(brow);
      part(this.head, [0.13, 0.08, 0.023], '#d8927b', [
        x * 1.25,
        -0.125,
        0.326,
      ]);
    }
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.105, 0.017, 4, 14, Math.PI),
      new THREE.MeshStandardMaterial({ color: '#965f4e' }),
    );
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.15, 0.344);
    this.head.add(smile);
    part(this.head, [0.92, 0.1, 0.8], '#4d7967', [0, 0.4, 0.06]);
    part(this.head, [0.71, 0.22, 0.61], '#65927b', [0, 0.52, -0.03]);
    part(this.head, [0.18, 0.075, 0.045], '#edd797', [0, 0.48, 0.29]);
    part(this.hammer, [0.09, 0.65, 0.09], '#93734d', [0, -0.07, 0]);
    part(this.hammer, [0.44, 0.23, 0.25], '#8a9a98', [0, 0.24, 0]);
    this.hammer.position.set(0, -0.58, 0.12);
    arms[1].add(this.hammer);
    part(this.axe, [0.085, 0.7, 0.085], '#92714c', [0, -0.1, 0]);
    part(this.axe, [0.45, 0.33, 0.09], '#a4b6ad', [0.12, 0.2, 0]);
    this.axe.position.copy(this.hammer.position);
    arms[1].add(this.axe);
    part(this.umbrella, [0.04, 1.4, 0.04], '#b7bba4', [-0.48, 2.48, 0]);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#e0b45e',
        side: THREE.DoubleSide,
        roughness: 0.8,
        flatShading: true,
      }),
    );
    canopy.scale.y = 0.43;
    canopy.position.set(-0.48, 3.03, 0);
    canopy.castShadow = true;
    this.umbrella.add(canopy);
    this.root.add(this.umbrella);
    this.hammer.visible = false;
    this.axe.visible = false;
    this.umbrella.visible = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.71, 40),
      new THREE.MeshBasicMaterial({
        color: '#e7f0bd',
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    this.root.add(ring);
    this.speechCanvas.width = 640;
    this.speechCanvas.height = 160;
    this.speechTexture = new THREE.CanvasTexture(this.speechCanvas);
    this.speechTexture.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.speechTexture,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.bubble.position.y = 3.6;
    this.bubble.scale.set(5, 1.25, 1);
    this.bubble.renderOrder = 20;
    this.bubble.visible = false;
    this.root.add(this.bubble);
    this.mixer = new THREE.AnimationMixer(this.root);
    const track = (name: string, values: number[]) =>
      new THREE.NumberKeyframeTrack(name, [0, 0.25, 0.5, 0.75, 1], values);
    const makeClip = (
      name: Gesture,
      walk: number,
      work = false,
      wave = false,
    ) =>
      new THREE.AnimationClip(name, 1, [
        track('legLeft.rotation[x]', [0, walk, 0, -walk, 0]),
        track('legRight.rotation[x]', [0, -walk, 0, walk, 0]),
        track('armLeft.rotation[x]', [0, -walk * 0.8, 0, walk * 0.8, 0]),
        track(
          'armRight.rotation[x]',
          work
            ? [-0.4, -1.9, -0.4, -1.9, -0.4]
            : [0, walk * 0.8, 0, -walk * 0.8, 0],
        ),
        track(
          'armRight.rotation[z]',
          wave ? [-2, -2.6, -2, -2.6, -2] : [-0.05, -0.05, -0.05, -0.05, -0.05],
        ),
      ]);
    for (const clip of [
      makeClip('idle', 0.025),
      makeClip('walk', 0.65),
      makeClip('work', 0, true),
      makeClip('wave', 0, false, true),
      makeClip('guard', 0.1, true),
    ])
      this.actions.set(clip.name as Gesture, this.mixer.clipAction(clip));
    this.actions.get('idle')!.play();
    this.root.position.set(2, 0, 6);
    this.root.rotation.y = 0.6;
    this.say('我叫阿木，一起把这里变成家吧。', 7);
  }
  gesture(next: Gesture, tool: 'hammer' | 'axe' = 'hammer') {
    if (next !== this.current) {
      this.actions.get(this.current)!.fadeOut(0.16);
      this.actions.get(next)!.reset().fadeIn(0.16).play();
      this.current = next;
    }
    this.hammer.visible =
      (next === 'work' || next === 'guard') && tool === 'hammer';
    this.axe.visible = next === 'work' && tool === 'axe';
  }
  say(text: string, duration = 4) {
    this.speech = text;
    this.speechTime = duration;
    const ctx = this.speechCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 640, 160);
    ctx.fillStyle = '#fbf9ef';
    ctx.beginPath();
    ctx.roundRect(6, 6, 628, 127, 22);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(303, 128);
    ctx.lineTo(320, 151);
    ctx.lineTo(337, 128);
    ctx.fill();
    ctx.fillStyle = '#42624c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 23px "PingFang SC",sans-serif';
    ctx.fillText('阿 木', 320, 39);
    ctx.fillStyle = '#3d493b';
    ctx.font = '27px "PingFang SC",sans-serif';
    ctx.fillText(text, 320, 87, 586);
    this.speechTexture.needsUpdate = true;
    this.bubble.visible = true;
  }
  update(dt: number, mood: Mood, rain: boolean) {
    this.time += dt;
    this.mood = mood;
    this.mixer.update(dt);
    this.speechTime = Math.max(0, this.speechTime - dt);
    this.bubble.visible = this.speechTime > 0;
    this.umbrella.visible = rain;
    this.bubble.position.y = rain ? 4.15 : 3.6;
    this.head.rotation.y = Math.sin(this.time * 0.8) * 0.08;
    this.head.rotation.z =
      mood === 'sleepy' ? 0.07 : Math.sin(this.time * 0.65) * 0.025;
    const blink = this.time % 4.6 > 4.43;
    for (const eye of this.eyes)
      eye.scale.y = blink ? 0.08 : mood === 'sleepy' ? 0.55 : 1;
    this.brows.forEach(
      (b, i) =>
        (b.rotation.z =
          mood === 'brave'
            ? i === 0
              ? -0.23
              : 0.23
            : mood === 'rainy'
              ? i === 0
                ? 0.1
                : -0.1
              : 0),
    );
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.speechTexture.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.root.removeFromParent();
  }
}
