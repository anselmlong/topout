// Mapping between wall-plane coordinates (u, v in cm) and 3D world space (metres).
// The wall faces +z; overhanging panels lean toward the camera.
import * as THREE from 'three';
import { rng } from '../gen/rng';
import type { Wall } from '../solver/types';

/**
 * A flat rectangle of wall: wall-plane range [u0,u1]×[v0,v1] cm, mapped to world
 * (metres) from `origin` (the (u0, v0) corner) along `right` and `up`.
 * A plain wall has one facet per panel; a dihedral (see Wall.fold) splits each
 * panel into two facets turned toward each other about the fold line.
 */
export interface PanelFrame {
  index: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  origin: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
}

export function panelFrames(wall: Wall): PanelFrame[] {
  const frames: PanelFrame[] = [];
  // Where the panel's bottom edge crosses the fold line (or the wall's centre), in world metres.
  const spine = new THREE.Vector3(0, 0, 0);
  const foldU = wall.fold?.u ?? wall.width / 2;
  const half = ((wall.fold?.angle ?? 0) / 2) * (Math.PI / 180);
  let v0 = 0;
  wall.panels.forEach((p, i) => {
    const a = (p.angle * Math.PI) / 180;
    const up = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const x = new THREE.Vector3(1, 0, 0);
    const spineHere = spine.clone().add(x.clone().multiplyScalar((foldU - wall.width / 2) / 100));
    // Turn the x axis about `up` by ±half: the left face comes toward you from the fold, and the right too.
    const turned = (theta: number) =>
      x
        .clone()
        .multiplyScalar(Math.cos(theta))
        .add(up.clone().cross(x).multiplyScalar(Math.sin(theta)))
        .normalize();
    const sides = wall.fold
      ? [
          { u0: 0, u1: foldU, right: turned(half) },
          { u0: foldU, u1: wall.width, right: turned(-half) },
        ]
      : [{ u0: 0, u1: wall.width, right: x.clone() }];
    for (const side of sides) {
      const origin = spineHere.clone().addScaledVector(side.right, (side.u0 - foldU) / 100);
      const normal = side.right.clone().cross(up).normalize();
      frames.push({ index: i * 2 + (side.u0 > 0 ? 1 : 0), u0: side.u0, u1: side.u1, v0, v1: v0 + p.length, origin, right: side.right, up, normal });
    }
    spine.addScaledVector(up, p.length / 100);
    v0 += p.length;
  });
  return frames;
}

/** The crash pad under the wall (metres). Shared by the floor mesh and the ragdoll. */
export function padBox(wall: Wall) {
  const frames = panelFrames(wall);
  // Furthest any part of the wall comes toward the room.
  let depth = 0;
  for (const f of frames)
    for (const [u, v] of [
      [f.u0, f.v1],
      [f.u1, f.v1],
      [f.u0, f.v0],
      [f.u1, f.v0],
    ])
      depth = Math.max(depth, uvToWorld(wall, frames, u, v).z);
  const length = Math.max(2, depth + 1.4);
  return { width: wall.width / 100 + 0.6, top: 0.3, minZ: -0.05, maxZ: length - 0.05, length };
}

/** The facet a world point is closest to (for the climber's body, which isn't on the wall). */
export function nearestFrame(frames: PanelFrame[], p: THREE.Vector3): PanelFrame {
  let best = frames[0];
  let bestScore = Infinity;
  for (const f of frames) {
    const rel = p.clone().sub(f.origin);
    const u = rel.dot(f.right) * 100;
    const v = rel.dot(f.up) * 100;
    const outside =
      Math.max(0, -u, u - (f.u1 - f.u0)) + Math.max(0, -v, v - (f.v1 - f.v0));
    const score = outside * 10 + Math.abs(rel.dot(f.normal)) * 100;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** Approximate wall v (cm) for a world point. */
export function worldV(frames: PanelFrame[], p: THREE.Vector3): number {
  const f = nearestFrame(frames, p);
  return f.v0 + Math.max(0, p.clone().sub(f.origin).dot(f.up) * 100);
}

export function frameAt(frames: PanelFrame[], u: number, v: number): PanelFrame {
  const inRow = frames.filter((f) => v < f.v1);
  const row = inRow.length ? inRow.filter((f) => f.v0 === inRow[0].v0) : frames.filter((f) => f.v1 === frames[frames.length - 1].v1);
  return row.find((f) => u < f.u1) ?? row[row.length - 1];
}

export function uvToWorld(_wall: Wall, frames: PanelFrame[], u: number, v: number, out = new THREE.Vector3()) {
  const f = frameAt(frames, u, v);
  return out
    .copy(f.origin)
    .addScaledVector(f.up, (v - f.v0) / 100)
    .addScaledVector(f.right, (u - f.u0) / 100);
}

export function worldToUv(_wall: Wall, frame: PanelFrame, p: THREE.Vector3) {
  const local = p.clone().sub(frame.origin);
  return { u: frame.u0 + local.dot(frame.right) * 100, v: frame.v0 + local.dot(frame.up) * 100 };
}

/** Orientation for an object sitting on the wall, rotated `rot` about the normal. */
export function holdQuaternion(frame: PanelFrame, rot: number) {
  const basis = new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.normal);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot));
}

/** A faceted plywood panel with a little cosmetic relief. */
export function panelGeometry(_wall: Wall, frame: PanelFrame, seed: number) {
  const r = rng(seed + frame.index * 101);
  const cell = 30;
  const width = frame.u1 - frame.u0;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.ceil((frame.v1 - frame.v0) / cell);
  const pos: number[] = [];
  const grid: THREE.Vector3[][] = [];
  for (let j = 0; j <= rows; j++) {
    grid[j] = [];
    for (let i = 0; i <= cols; i++) {
      const u = Math.min(width, i * cell);
      const v = Math.min(frame.v1, frame.v0 + j * cell);
      const edge = i === 0 || i === cols || j === 0 || j === rows;
      const p = frame.origin
        .clone()
        .addScaledVector(frame.up, (v - frame.v0) / 100)
        .addScaledVector(frame.right, u / 100);
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
