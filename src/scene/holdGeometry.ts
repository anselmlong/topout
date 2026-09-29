// Procedural low-poly hold meshes. Local frame: base on z = 0 (the wall),
// +z out of the wall, +y is the incut side (hold "up" at rot = 0). Metres.
//
// Each hold is a deformed icosphere: squared off with a superellipsoid for
// edges and crimps, carved for pockets and jug lips, jittered per variant so
// no two look quite alike. Per-face colour grain is baked in as vertex colours
// (multiplied with the material colour, so chalk tinting still works).
import * as THREE from 'three';
import { hash, rng } from '../gen/rng';
import type { HoldSize, HoldType } from '../solver/types';

interface Shape {
  scale: [number, number, number];
  detail: number;
  /** Superellipsoid exponent: < 1 squares the shape off, 1 leaves it round. */
  box?: number;
  /** Vertex shaping in unit-sphere space, before scaling. `k` varies per variant (0..1). */
  shape?: (p: THREE.Vector3, k: number) => void;
  /** Darken these vertices (e.g. inside a pocket). */
  shade?: (p: THREE.Vector3) => number;
  jitter: number;
  bolt: boolean;
}

const sgnpow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

interface Profile {
  /** Side view: [out of wall, up] pairs in metres, from the wall at the bottom, round to the wall at the top. */
  pts: [number, number][];
  width: number;
  /** How much the ends round off (0 = boxy rail, 1 = pointed). */
  taper: number;
  /** Narrow toward the top (for blades like pinches). */
  topNarrow?: number;
  /** Ends droop down by this much (m), giving the crescent of a real jug or rail. */
  bend?: number;
  /** How much the ends shrink in height too (0 = full height to the tip). */
  heightTaper?: number;
  shade?: (x: number, y: number, z: number) => number;
}

/** Real-hold shapes, drawn as a side profile and extruded across the width. */
const PROFILES: Partial<Record<HoldType, Profile>> = {
  // A bucket: bulging body, a thick lip curling up and over a deep scoop.
  jug: {
    pts: [
      [0, -0.048],
      [0.02, -0.047],
      [0.038, -0.04],
      [0.052, -0.024],
      [0.06, -0.004],
      [0.062, 0.018],
      [0.058, 0.036],
      [0.048, 0.048],
      [0.038, 0.046],
      [0.034, 0.03],
      [0.028, 0.01],
      [0.014, 0.004],
      [0.008, 0.022],
      [0, 0.03],
    ],
    width: 0.16,
    taper: 0.75,
    bend: 0.04,
    heightTaper: 0.5,
    shade: (_x, y, z) => (y > -0.004 && y < 0.04 && z < 0.036 && z > 0.002 ? 0.5 : 1),
  },
  // Flat-topped ledge with a slight incut.
  edge: {
    pts: [
      [0, -0.03],
      [0.03, -0.026],
      [0.038, 0.004],
      [0.036, 0.016],
      [0.024, 0.014],
      [0.012, 0.017],
      [0, 0.02],
    ],
    width: 0.15,
    taper: 0.4,
    bend: 0.012,
    heightTaper: 0.35,
  },
  // A thin rail: barely a finger pad deep.
  crimp: {
    pts: [
      [0, -0.016],
      [0.016, -0.013],
      [0.022, 0.004],
      [0.019, 0.011],
      [0.012, 0.008],
      [0, 0.012],
    ],
    width: 0.12,
    taper: 0.35,
    bend: 0.008,
    heightTaper: 0.4,
  },
  // A tall fin to squeeze from both sides.
  pinch: {
    pts: [
      [0, -0.075],
      [0.03, -0.06],
      [0.048, -0.02],
      [0.05, 0.03],
      [0.04, 0.066],
      [0.018, 0.08],
      [0, 0.078],
    ],
    width: 0.042,
    taper: 0.08,
    topNarrow: 0.4,
  },
};

function profileGeometry(pr: Profile, scale: number, k: number, r: ReturnType<typeof rng>) {
  const shape = new THREE.Shape();
  const pts = pr.pts.map(([a, b]) => [a * scale * (0.92 + 0.16 * k), b * scale] as const);
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) shape.lineTo(a, b);
  shape.lineTo(0, pts[0][1]);
  const width = pr.width * scale * (0.9 + 0.2 * k);
  const bevel = 0.004 * scale;
  const ext = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 6,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2,
  });
  const g = ext.index ? ext.toNonIndexed() : ext;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const yMin = pts[0][1];
  const yMax = Math.max(...pts.map((p) => p[1]));
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    // Shape x = out of wall, shape y = up, extrude z = across → hold (x across, y up, z out).
    const out = pos.getX(i);
    const up = pos.getY(i);
    const across = pos.getZ(i) - width / 2;
    const t = Math.min(1, Math.abs(across) / (width / 2 + bevel));
    const round = 1 - pr.taper * t * t;
    const hy = (up - yMin) / (yMax - yMin || 1);
    const narrow = 1 - (pr.topNarrow ?? 0) * Math.max(0, hy);
    const id = `${out.toFixed(4)},${up.toFixed(4)},${across.toFixed(4)}`;
    if (!jitter.has(id)) jitter.set(id, r.range(0.94, 1.06));
    const j = jitter.get(id)!;
    const droop = (pr.bend ?? 0) * scale * t * t;
    // Shrink toward the profile's middle height at the tips: a crescent, not a brick.
    const mid = (yMin + yMax) / 2;
    const h = 1 - (pr.heightTaper ?? 0) * t * t;
    pos.setXYZ(i, across * narrow, mid + (up - mid) * h - droop, Math.max(0, out * round * j));
  }
  return g;
}

const SHAPES: Record<HoldType, Shape> = {
  jug: {
    scale: [0.085, 0.056, 0.056],
    detail: 2,
    jitter: 0.07,
    bolt: true,
    // Thick overhanging lip on top curling down over a scooped handle.
    shape: (p, k) => {
      p.x *= 0.9 + 0.25 * k;
      p.z *= 1 + 0.75 * Math.max(0, p.y);
      if (p.y > 0.25) p.y -= 0.3 * p.z;
      if (p.y > -0.2 && p.y < 0.35 && p.z > 0.3) p.z -= 0.18 * (1 - Math.abs(p.x));
    },
    shade: (p) => (p.y > -0.2 && p.y < 0.3 && p.z > 0.25 ? 0.78 : 1),
  },
  edge: {
    scale: [0.08, 0.03, 0.036],
    detail: 2,
    box: 0.45,
    jitter: 0.04,
    bolt: true,
    shape: (p, k) => {
      p.x *= 0.85 + 0.3 * k;
      if (p.y > 0.55) p.y = 0.55;
      p.z *= 1 + 0.2 * p.y;
    },
  },
  crimp: {
    scale: [0.062, 0.018, 0.022],
    detail: 2,
    box: 0.5,
    jitter: 0.05,
    bolt: true,
    shape: (p, k) => {
      p.x *= 0.8 + 0.4 * k;
      if (p.y > 0.6) p.y = 0.6;
      p.x += 0.15 * Math.sin(p.y * 3 + k * 4) * 0.2;
    },
  },
  sloper: {
    scale: [0.1, 0.085, 0.046],
    detail: 2,
    jitter: 0.035,
    bolt: true,
    shape: (p, k) => {
      p.z *= 0.9 + 0.12 * (1 - p.y);
      p.x *= 0.9 + 0.2 * k;
    },
  },
  pinch: {
    scale: [0.03, 0.08, 0.046],
    detail: 2,
    box: 0.6,
    jitter: 0.05,
    bolt: true,
    // Tapered blade: narrower toward the top, faces squeezable on both sides.
    shape: (p, k) => {
      p.x *= 1 - 0.35 * Math.max(0, p.y) + 0.1 * k;
      p.z *= 1 - 0.25 * Math.abs(p.y);
    },
  },
  pocket: {
    scale: [0.062, 0.06, 0.042],
    detail: 3,
    jitter: 0.04,
    bolt: false,
    // A deep finger hole just above centre.
    shape: (p, k) => {
      const d = Math.hypot(p.x * (1.2 - 0.3 * k), p.y - 0.12);
      if (d < 0.5 && p.z > 0) p.z *= 0.12 + d * 1.6;
    },
    shade: (p) => (Math.hypot(p.x, p.y - 0.12) < 0.42 ? 0.55 : 1),
  },
  foot: {
    scale: [0.028, 0.022, 0.018],
    detail: 1,
    jitter: 0.1,
    bolt: false,
  },
  jib: {
    scale: [0.016, 0.013, 0.011],
    detail: 0,
    jitter: 0.12,
    bolt: false,
  },
};

// Drawn ~20% larger than life so holds read at game zoom. Keep in step with holdRadius.
const SIZE: Record<HoldSize, number> = { s: 0.95, m: 1.2, l: 1.5 };
const VARIANTS = 4;

export interface HoldMeshData {
  geometry: THREE.BufferGeometry;
  /** Where the bolt washer sits (local), or null for bolt-less holds. */
  bolt: THREE.Vector3 | null;
}

const cache = new Map<string, HoldMeshData>();

export function holdMesh(type: HoldType, size: HoldSize, variant = 0): HoldMeshData {
  const v = variant % VARIANTS;
  const key = `${type}:${size}:${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = SHAPES[type];
  const r = rng(hash(type.length, type.charCodeAt(0), type.charCodeAt(1), size.charCodeAt(0), v));
  const k = v / (VARIANTS - 1);
  const profile = PROFILES[type];
  if (profile) {
    const data = finish(profileGeometry(profile, SIZE[size], k, r), r, spec.bolt, (x, y, z) => profile.shade?.(x, y, z) ?? 1);
    cache.set(key, data);
    return data;
  }
  const g = new THREE.IcosahedronGeometry(1, spec.detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const s = SIZE[size];
  // Jitter shared vertices consistently so faces stay closed.
  const jitter = new Map<string, [number, number, number]>();
  const shadeOf: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const id = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    if (!jitter.has(id)) jitter.set(id, [r.range(-1, 1), r.range(-1, 1), r.range(-0.8, 0.8)]);
    const [jx, jy, jz] = jitter.get(id)!;
    if (spec.box) p.set(sgnpow(p.x, spec.box), sgnpow(p.y, spec.box), sgnpow(p.z, spec.box));
    p.set(p.x + jx * spec.jitter, p.y + jy * spec.jitter, p.z + jz * spec.jitter);
    spec.shape?.(p, k);
    shadeOf.push(spec.shade?.(p) ?? 1);
    p.z = Math.max(0, p.z);
    pos.setXYZ(i, p.x * spec.scale[0] * s, p.y * spec.scale[1] * s, p.z * spec.scale[2] * s);
  }
  const data = finish(g, r, spec.bolt, (_x, _y, _z, i) => shadeOf[i]);
  cache.set(key, data);
  return data;
}

/** Per-face colour grain (+ shading, e.g. inside a scoop) and the bolt washer's spot. */
function finish(
  g: THREE.BufferGeometry,
  r: ReturnType<typeof rng>,
  hasBolt: boolean,
  shade: (x: number, y: number, z: number, i: number) => number,
): HoldMeshData {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f + 2 < pos.count; f += 3) {
    const grain = r.range(0.9, 1.05);
    let s = 1;
    for (let j = 0; j < 3; j++) s = Math.min(s, shade(pos.getX(f + j), pos.getY(f + j), pos.getZ(f + j), f + j));
    for (let j = 0; j < 3; j++) colors.set([grain * s, grain * s, grain * s], (f + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  let bolt: THREE.Vector3 | null = null;
  if (hasBolt) {
    // Sit the washer on the surface near the middle of the hold.
    bolt = new THREE.Vector3(0, bb.min.y + (bb.max.y - bb.min.y) * 0.35, 0);
    let top = 0;
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getX(i)) < 0.015 && Math.abs(pos.getY(i) - bolt.y) < 0.015) top = Math.max(top, pos.getZ(i));
    bolt.z = (top > 0 ? top : bb.max.z * 0.8) + 0.001;
  }
  return { geometry: g, bolt };
}

/** Geometry only (ghost previews, outlines). */
export function holdGeometry(type: HoldType, size: HoldSize, variant = 0): THREE.BufferGeometry {
  return holdMesh(type, size, variant).geometry;
}
