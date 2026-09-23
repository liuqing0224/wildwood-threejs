import * as THREE from 'three';
import type { FurnitureKind } from './model';

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function makeFurniture(kind: FurnitureKind): THREE.Group {
  const group = new THREE.Group();
  const material = (color: string) => {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
      );
    return materials.get(color)!;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = kind !== 'rug';
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const legs = (width: number, depth: number, height: number) => {
    for (const x of [-width, width])
      for (const z of [-depth, depth])
        box(0.13, height, 0.13, '#805437', x, 0.25 + height / 2, z);
  };
  if (kind === 'bed') {
    legs(0.62, 0.76, 0.45);
    box(1.45, 0.18, 1.75, '#a77c51', 0, 0.61, 0);
    box(1.34, 0.22, 1.62, '#eee9db', 0, 0.8, 0);
    box(1.35, 0.09, 1.02, '#419996', 0, 0.95, 0.28);
    box(0.93, 0.16, 0.38, '#fff7e5', 0, 0.97, -0.55);
    box(1.48, 0.65, 0.12, '#936441', 0, 0.96, -0.86);
    for (const x of [-0.47, 0, 0.47])
      box(0.035, 0.015, 1.01, '#b6d4bf', x, 1.005, 0.28);
  } else if (kind === 'table') {
    legs(0.62, 0.5, 0.83);
    box(1.65, 0.16, 1.4, '#ba8d59', 0, 1.16, 0);
    for (const z of [-0.35, 0.35])
      box(1.64, 0.015, 0.025, '#8a653e', 0, 1.245, z);
    box(0.24, 0.25, 0.24, '#b76654', 0.35, 1.36, -0.2);
    box(0.3, 0.3, 0.3, '#649c5d', 0.35, 1.63, -0.2);
  } else if (kind === 'chair') {
    legs(0.3, 0.3, 0.6);
    box(0.84, 0.14, 0.84, '#b08658', 0, 0.89, 0);
    box(0.7, 0.1, 0.68, '#b85e64', 0, 1, 0.04);
    for (const x of [-0.34, 0.34])
      box(0.12, 0.9, 0.12, '#805437', x, 1.1, -0.35);
    box(0.82, 0.32, 0.13, '#b08658', 0, 1.44, -0.35);
  } else if (kind === 'chest') {
    box(1.35, 0.69, 0.94, '#95663f', 0, 0.63, 0);
    box(1.43, 0.16, 1.02, '#bf925c', 0, 1.045, 0);
    for (const x of [-0.45, 0.45]) {
      box(0.11, 0.74, 0.025, '#575b56', x, 0.66, 0.483);
      box(0.11, 0.035, 1.025, '#575b56', x, 1.14, 0);
    }
    box(0.17, 0.21, 0.07, '#d9b956', 0, 0.91, 0.53);
  } else if (kind === 'lamp') {
    box(0.65, 0.12, 0.65, '#626963', 0, 0.32, 0);
    box(0.1, 1.45, 0.1, '#ac8550', 0, 1.09, 0);
    const shadeMaterial = material('#fff0c5');
    shadeMaterial.emissive.set('#ffbb52');
    shadeMaterial.emissiveIntensity = 0.6;
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.51, 0.53, 12),
      shadeMaterial,
    );
    shade.position.y = 1.92;
    shade.castShadow = true;
    group.add(shade);
    box(0.17, 0.1, 0.17, '#b18a4f', 0, 2.23, 0);
  } else {
    box(1.85, 0.035, 1.85, '#ba6470', 0, 0.277, 0);
    box(1.55, 0.012, 1.55, '#ead7b3', 0, 0.301, 0);
    box(1.25, 0.012, 1.25, '#528c89', 0, 0.313, 0);
    const center = box(0.6, 0.012, 0.6, '#e4b95f', 0, 0.325, 0);
    center.rotation.y = Math.PI / 4;
    for (let x = -0.8; x <= 0.8; x += 0.2)
      for (const z of [-0.96, 0.96])
        box(0.08, 0.024, 0.14, '#ead7b3', x, 0.276, z);
  }
  return group;
}
