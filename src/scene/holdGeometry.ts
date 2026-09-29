// Procedural low-poly hold meshes. Local frame: base on z = 0 (the wall),
// +z out of the wall, +y is the incut side (hold "up" at rot = 0). Metres.
import * as THREE from 'three';
import { hash, rng } from '../gen/rng';
import type { HoldSize, HoldType } from '../solver/types';

interface Shape {
  scale: [number, number, number];
  detail: number;
  /** Vertex shaping in unit-sphere space, before scaling. */
  shape: (p: THREE.Vector3) => void;
}

const SHAPES: Record<HoldType, Shape> = {
  jug: {
    scale: [0.085, 0.055, 0.05],
    detail: 1,
    // Thick overhanging lip on top, flat into the wall below.
    shape: (p) => {
      p.z *= 1 + 0.7 * Math.max(0, p.y);
      if (p.y > 0.3) p.y -= 0.25 * p.z;
    },
  },
  crimp: {
    scale: [0.06, 0.018, 0.022],
    detail: 1,
    shape: (p) => {
      if (p.y > 0) p.y = Math.min(p.y, 0.7);
    },
  },
  sloper: {
    scale: [0.1, 0.085, 0.045],
    detail: 1,
    shape: (p) => {
      p.z *= 0.9 + 0.1 * (1 - p.y);
    },
  },
  pinch: {
    scale: [0.028, 0.075, 0.045],
    detail: 1,
    shape: (p) => {
      p.z *= 1 - 0.3 * Math.abs(p.y);
    },
  },
  pocket: {
    scale: [0.06, 0.06, 0.04],
    detail: 1,
    // A dimple just above centre.
    shape: (p) => {
      const d = Math.hypot(p.x, p.y - 0.15);
      if (d < 0.55) p.z *= 0.25 + d;
    },
  },
  foot: {
    scale: [0.028, 0.022, 0.018],
    detail: 0,
    shape: () => {},
  },
};

const SIZE: Record<HoldSize, number> = { s: 0.8, m: 1, l: 1.25 };

const cache = new Map<string, THREE.BufferGeometry>();

export function holdGeometry(type: HoldType, size: HoldSize, variant = 0): THREE.BufferGeometry {
  const key = `${type}:${size}:${variant % 3}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = SHAPES[type];
  const r = rng(hash(type.length, type.charCodeAt(0), size.charCodeAt(0), variant % 3));
  const g = new THREE.IcosahedronGeometry(1, spec.detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  // Jitter shared vertices consistently so faces stay closed.
  const jitter = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    if (!jitter.has(k)) jitter.set(k, [r.range(-0.1, 0.1), r.range(-0.1, 0.1), r.range(-0.08, 0.08)]);
    const [jx, jy, jz] = jitter.get(k)!;
    p.set(p.x + jx, p.y + jy, p.z + jz);
    spec.shape(p);
    p.z = Math.max(0, p.z);
    const s = SIZE[size];
    p.set(p.x * spec.scale[0] * s, p.y * spec.scale[1] * s, p.z * spec.scale[2] * s);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // Polyhedra are already non-indexed, so normals come out flat-shaded.
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  cache.set(key, flat);
  return flat;
}
