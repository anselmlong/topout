// Mapping between wall-plane coordinates (u, v in cm) and 3D world space (metres).
// The wall faces +z; overhanging panels lean toward the camera.
import * as THREE from 'three';
import { rng } from '../gen/rng';
import type { Wall } from '../solver/types';

export interface PanelFrame {
  index: number;
  v0: number;
  v1: number;
  origin: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
}

export function panelFrames(wall: Wall): PanelFrame[] {
  const frames: PanelFrame[] = [];
  const origin = new THREE.Vector3(0, 0, 0);
  let v0 = 0;
  wall.panels.forEach((p, index) => {
    const a = (p.angle * Math.PI) / 180;
    const up = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const normal = new THREE.Vector3(0, -Math.sin(a), Math.cos(a));
    frames.push({ index, v0, v1: v0 + p.length, origin: origin.clone(), up, normal });
    origin.addScaledVector(up, p.length / 100);
    v0 += p.length;
  });
  return frames;
}

/** The crash pad under the wall (metres). Shared by the floor mesh and the ragdoll. */
export function padBox(wall: Wall) {
  const frames = panelFrames(wall);
  const top = frames[frames.length - 1];
  const depth = top.origin.clone().addScaledVector(top.up, (top.v1 - top.v0) / 100).z;
  const length = Math.max(2, depth + 1.4);
  return { width: wall.width / 100 + 0.6, top: 0.3, minZ: -0.05, maxZ: length - 0.05, length };
}

/** Approximate wall v (cm) for a world point, by projecting onto the panel stack. */
export function worldV(frames: PanelFrame[], p: THREE.Vector3): number {
  for (const f of frames) {
    const along = p.clone().sub(f.origin).dot(f.up) * 100;
    if (along <= f.v1 - f.v0 || f === frames[frames.length - 1]) return f.v0 + Math.max(0, along);
  }
  return 0;
}

export function frameAt(frames: PanelFrame[], v: number): PanelFrame {
  return frames.find((f) => v < f.v1) ?? frames[frames.length - 1];
}

export function uvToWorld(wall: Wall, frames: PanelFrame[], u: number, v: number, out = new THREE.Vector3()) {
  const f = frameAt(frames, v);
  return out
    .copy(f.origin)
    .addScaledVector(f.up, (v - f.v0) / 100)
    .add(new THREE.Vector3((u - wall.width / 2) / 100, 0, 0));
}

export function worldToUv(wall: Wall, frame: PanelFrame, p: THREE.Vector3) {
  const local = p.clone().sub(frame.origin);
  return { u: local.x * 100 + wall.width / 2, v: frame.v0 + local.dot(frame.up) * 100 };
}

/** Orientation for an object sitting on the wall, rotated `rot` about the normal. */
export function holdQuaternion(frame: PanelFrame, rot: number) {
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), frame.up, frame.normal);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot));
}

/** A faceted plywood panel with a little cosmetic relief. */
export function panelGeometry(wall: Wall, frame: PanelFrame, seed: number) {
  const r = rng(seed + frame.index * 101);
  const cell = 30;
  const cols = Math.ceil(wall.width / cell);
  const rows = Math.ceil((frame.v1 - frame.v0) / cell);
  const pos: number[] = [];
  const grid: THREE.Vector3[][] = [];
  for (let j = 0; j <= rows; j++) {
    grid[j] = [];
    for (let i = 0; i <= cols; i++) {
      const u = Math.min(wall.width, i * cell);
      const v = Math.min(frame.v1, frame.v0 + j * cell);
      const edge = i === 0 || i === cols || j === 0 || j === rows;
      const p = frame.origin
        .clone()
        .addScaledVector(frame.up, (v - frame.v0) / 100)
        .add(new THREE.Vector3((u - wall.width / 2) / 100, 0, 0));
      if (!edge) p.addScaledVector(frame.normal, r.range(-0.0018, 0.0018));
      grid[j][i] = p;
    }
  }
  const colors: number[] = [];
  const base = new THREE.Color('#cdbfa6');
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const c = grid[j + 1][i + 1];
      const d = grid[j + 1][i];
      for (const tri of [
        [a, b, c],
        [a, c, d],
      ]) {
        const shade = base.clone().offsetHSL(0, 0, r.range(-0.02, 0.02));
        for (const p of tri) {
          pos.push(p.x, p.y, p.z);
          colors.push(shade.r, shade.g, shade.b);
        }
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
