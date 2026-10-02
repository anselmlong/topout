// Procedural low-poly hold meshes. Local frame: base on z = 0 (the wall),
// +z out of the wall, +y is the incut side (hold "up" at rot = 0). Metres.
//
// Edges and crimps are side profiles extruded across their width; jugs,
// slopers, pinches, pockets and foot chips are built in rings around their
// outline; jibs are knapped icospheres. Each is jittered per variant so
// no two look quite alike. Per-face colour grain is baked in as vertex colours
// (multiplied with the material colour). A per-vertex `grip` attribute marks
// the surfaces hands and shoes actually use, so chalk builds up there and
// nowhere else (see the hold material in Scene.tsx).
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
  /** Where chalk collects, from a face's outward normal (defaults to upward-facing faces). */
  grip?: GripFn;
}

/** 0..1 chalkiness of a face, from its normal and centre (local frame). */
type GripFn = (n: THREE.Vector3, c: THREE.Vector3) => number;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Fingers wrap over the top: faces pointing up, and a little onto the lip. */
const TOP_GRIP: GripFn = (n) => smooth(0.05, 0.75, n.y + 0.25 * Math.max(0, n.z) * (n.y > -0.1 ? 1 : 0));

const sgnpow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

interface Profile {
  /** Side view: [out of wall, up] pairs in metres, from the wall at the bottom, round to the wall at the top. */
  pts: [number, number][];
  width: number;
  /** How much the ends round off (0 = boxy rail, 1 = pointed). */
  taper: number;
  /** Narrow toward the top (for blades like pinches). */
  topNarrow?: number;
  /**
   * Width multiplier from height (0 at the bottom, 1 at the top) and reach
   * out of the wall (0 at the wall, 1 at the outermost point). Rounds a fin's
   * ends and gives it a wedge cross-section instead of a slab.
   */
  widthAt?: (hy: number, ho: number) => number;
  /** Ends droop down by this much (m), giving the crescent of a real jug or rail. */
  bend?: number;
  /** How much the ends shrink in height too (0 = full height to the tip). */
  heightTaper?: number;
  /**
   * Hand-sculpted lip: how far (as a fraction) the reach out of the wall and
   * the top edge wander along the width, in two or three soft lumps. Real
   * edges are shaped by hand, so the lip is never a ruler-straight rail.
   */
  lumps?: number;
  /** Per-variant range for `bend`: below 0 the ends curl up into a smile instead of drooping. */
  bendRange?: [number, number];
  /** Cross-sections along the width (default 6); more lets the lumps show. */
  steps?: number;
  shade?: (x: number, y: number, z: number) => number;
  grip?: GripFn;
}

/** Real-hold shapes, drawn as a side profile and extruded across the width. */
const PROFILES: Partial<Record<HoldType, Profile>> = {
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
    lumps: 0.13,
    bendRange: [-0.6, 1.6],
    steps: 10,
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
    lumps: 0.16,
    bendRange: [-0.8, 1.8],
    steps: 10,
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
    steps: pr.steps ?? 6,
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
  const outMax = Math.max(...pts.map((p) => p[0]));
  const jitter = new Map<string, number>();
  // Lumps along the lip: two soft waves with this variant's phases, plus a
  // lean so one end is a little fuller than the other.
  const ph = [r.range(0, 6.3), r.range(0, 6.3), r.range(0, 6.3)];
  const lean = r.range(-0.6, 0.6);
  const wave = (u: number) => 0.6 * Math.sin(Math.PI * (1.4 + 0.5 * k) * u + ph[0]) + 0.4 * Math.sin(Math.PI * 2.7 * u + ph[1]) + lean * u;
  const crest = (u: number) => Math.sin(Math.PI * (1.8 + 0.4 * k) * u + ph[2]);
  const lumps = pr.lumps ?? 0;
  const bend = (pr.bend ?? 0) * (pr.bendRange ? r.range(...pr.bendRange) : 1);
  for (let i = 0; i < pos.count; i++) {
    // Shape x = out of wall, shape y = up, extrude z = across → hold (x across, y up, z out).
    const out = pos.getX(i);
    const up = pos.getY(i);
    const across = pos.getZ(i) - width / 2;
    const t = Math.min(1, Math.abs(across) / (width / 2 + bevel));
    const round = 1 - pr.taper * t * t;
    const hy = (up - yMin) / (yMax - yMin || 1);
    const ho = Math.max(0, out) / (outMax || 1);
    const narrow = (1 - (pr.topNarrow ?? 0) * Math.max(0, hy)) * (pr.widthAt?.(hy, ho) ?? 1);
    const id = `${out.toFixed(4)},${up.toFixed(4)},${across.toFixed(4)}`;
    if (!jitter.has(id)) jitter.set(id, r.range(0.94, 1.06));
    const j = jitter.get(id)!;
    const droop = bend * scale * t * t;
    // Lumps push the lip out and in along its length, and the top edge
    // (not the base on the wall) rises and dips with them.
    const u = Math.max(-1, Math.min(1, across / (width / 2)));
    const lump = 1 + lumps * wave(u) * ho;
    const rise = lumps * 0.3 * (yMax - yMin) * crest(u) * smooth(0.35, 1, hy) * ho;
    // Shrink toward the profile's middle height at the tips: a crescent, not a brick.
    const mid = (yMin + yMax) / 2;
    const h = 1 - (pr.heightTaper ?? 0) * t * t;
    pos.setXYZ(i, across * narrow, mid + (up - mid) * h - droop + rise, Math.max(0, out * round * j * lump));
  }
  // Swapping the extrusion's x and z axes mirrors it, which turns every face
  // inside out; swap two corners of each triangle so the outside faces out.
  for (let f = 0; f + 2 < pos.count; f += 3) {
    const x = pos.getX(f + 1), y = pos.getY(f + 1), z = pos.getZ(f + 1);
    pos.setXYZ(f + 1, pos.getX(f + 2), pos.getY(f + 2), pos.getZ(f + 2));
    pos.setXYZ(f + 2, x, y, z);
  }
  return g;
}

/**
 * A finger pocket: a domed teardrop body with a crisp oval hole above
 * centre. Built as rings around the hole rather than a dented ball, so the
 * rim is a sharp rolled edge, the hole has real walls and a floor, and the
 * top of the hole is hooded: the cavity runs up behind the lip, which is what
 * makes a good pocket incut. Large pockets take three fingers, small ones two.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function pocketGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const N = 28;
  const W = 0.066 * (0.94 + 0.1 * k);
  const H = 0.056 * (1.04 - 0.08 * k);
  // Hole: centre, half-width (finger count) and half-height.
  const hy = 0.012 + 0.006 * k;
  const a = 0.023 + 0.006 * k;
  const b = 0.012;
  const Z = 0.028;
  const floorZ = 0.008;
  const undercut = 0.009;
  // Each ring: (θ) => [x, y, z] in unscaled metres, plus its colour shade.
  type Ring = { at: (c: number, s: number, j: number) => [number, number, number]; shade: number; jitter: number };
  // Low-frequency lumps in the outline, so it's hand-shaped, not lathe-turned.
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.035 * Math.sin(2 * th + p1) + 0.025 * Math.sin(3 * th + p2);
  });
  const outline = (c: number, s: number, j: number): [number, number] => {
    // Rounded teardrop: squarish superellipse, fuller toward the bottom.
    const e = 0.8;
    return [W * sgnpow(c, e) * (1 - 0.06 * s) * wobble[j], H * sgnpow(s, e) * (s < 0 ? 1.06 : 0.96) * wobble[j]];
  };
  const hole = (c: number, s: number, m: number): [number, number] => [a * c * m, hy + b * s * m];
  // The hood above the hole stands proud of the bottom lip.
  const rimZ = (s: number) => Z * (1 + 0.1 * s);
  const rings: Ring[] = [];
  const RIM = 1.45;
  for (const t of [0, 0.18, 0.4, 0.62, 0.82]) {
    rings.push({
      at: (c, s, j) => {
        const [ox, oy] = outline(c, s, j);
        const [rx, ry] = hole(c, s, RIM);
        // A skirt that meets the wall steeply, then a dome up to the rim.
        const z = rimZ(s) * (t === 0 ? 0 : Math.sin((Math.PI / 2) * t) ** 1.4);
        return [ox + (rx - ox) * t, oy + (ry - oy) * t, z];
      },
      shade: 1,
      jitter: t === 0 ? 0 : 0.02,
    });
  }
  rings.push({ at: (c, s) => [...hole(c, s, RIM), rimZ(s)], shade: 1, jitter: 0.01 });
  // Rolled rim: crest, then the lip curling over into the hole.
  rings.push({ at: (c, s) => [...hole(c, s, 1.25), rimZ(s) + 0.002], shade: 1, jitter: 0 });
  rings.push({ at: (c, s) => [...hole(c, s, 1.0), rimZ(s) - 0.003], shade: 0.8, jitter: 0 });
  // Walls: the top of the cavity runs up and out behind the lip.
  for (const f of [0.35, 0.7, 1]) {
    rings.push({
      at: (c, s) => {
        const [x, y] = hole(c, s, 1 + 0.12 * f);
        return [x, y + undercut * f * Math.max(0, s), rimZ(s) - (rimZ(s) - floorZ) * f];
      },
      shade: 0.5 - 0.22 * f,
      jitter: 0,
    });
  }
  rings.push({
    at: (c, s) => {
      const [x, y] = hole(c, s, 0.55);
      return [x, y + 0.5 * undercut * Math.max(0, s), floorZ - 0.0015];
    },
    shade: 0.26,
    jitter: 0,
  });

  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  rings.forEach((ring, i) => {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const [x, y, z] = ring.at(Math.cos(th), Math.sin(th), j);
      const jz = ring.jitter ? r.range(1 - ring.jitter, 1 + ring.jitter) : 1;
      pos.push(x, y, z * jz);
      shade.push(ring.shade);
    }
    if (i === 0) return;
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      const C = i * N + ((j + 1) % N);
      const D = i * N + j;
      index.push(A, B, C, A, C, D);
    }
  });
  // Pocket floor: a fan to the centre of the hole.
  const last = (rings.length - 1) * N;
  const centre = pos.length / 3;
  pos.push(0, hy + 0.4 * undercut, floorZ - 0.0025);
  shade.push(0.24);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), centre);
  // Base against the wall, so the mesh is closed.
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);

  return {
    ...indexedToFlat(pos, shade, index, S),
    // Chalk rings the hole: its bottom lip and floor take the fingers, the
    // hood a little; the rest of the body only where it faces up.
    grip: ((n, c) => {
      const d = Math.hypot(c.x / S / a, (c.y / S - hy) / b);
      return d < 1.4 ? 0.45 + 0.55 * smooth(-0.2, 0.6, n.y) : d < 2 ? 0.3 * smooth(0.2, 0.8, n.y) : 0.2 * TOP_GRIP(n, c);
    }) as GripFn,
  };
}

/**
 * A bucket jug: a wide crescent bolted on its back, built in rings from its
 * outline up a round belly to a thick rolled lip. Behind the lip a scoop
 * drops down and in, with closed ends like a real bucket (not a trough cut
 * through the hold), so the fingers curl over the lip into a cup. The mouth
 * tilts up and out: the lip at the front stands proud while the back of the
 * scoop sits low against the wall, so from level you see the lip and a dark
 * slot behind it, and from above the whole bucket. The ends droop a little
 * (a frown, like most moulded jugs) and one end is fuller than the other.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function jugGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const N = 36;
  const W = 0.08 * (0.94 + 0.1 * k);
  const H = 0.046;
  // Mouth: centre (height, out of the wall), half-width, and half-depth from lip to back.
  const hy = 0.018 + 0.003 * k;
  const zc = 0.036 * (1.04 - 0.08 * k);
  const a = W * (0.58 + 0.08 * k);
  const R = 0.013 + 0.004 * k;
  // The mouth lies in a plane tilted up and back: `dir` runs from the lip to the
  // back of the scoop, `up` is the plane's normal (up and a little out). [y, z] pairs.
  const dir = [0.3, -0.954];
  const up = [0.954, 0.3];
  // How far the scoop drops below the mouth.
  const D = 0.022 + 0.006 * k;
  const bend = r.range(0.004, 0.016);
  const lean = r.range(-0.12, 0.12);
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.03 * Math.sin(2 * th + p1) + 0.02 * Math.sin(3 * th + p2);
  });
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, 0.7) * wobble[j],
    H * sgnpow(s, 0.85) * (s < 0 ? 1.08 : 0.94) * wobble[j],
  ];
  // A point on the mouth's outline (s = -1 the lip, +1 the back), grown by `d`
  // metres all round in its plane and raised `lift` off it.
  const mouth = (c: number, s: number, d: number, lift = 0): [number, number, number] => [
    (a + d) * c,
    hy + (R + d) * s * dir[0] + lift * up[0],
    zc + (R + d) * s * dir[1] + lift * up[1],
  ];
  type Ring = { at: (c: number, s: number, j: number) => [number, number, number]; shade: number; jitter: number };
  const rings: Ring[] = [];
  const RIM = 0.011;
  for (const t of [0, 0.14, 0.32, 0.52, 0.72, 0.88]) {
    rings.push({
      at: (c, s, j) => {
        const [ox, oy] = outline(c, s, j);
        const [rx, ry, rz] = mouth(c, s, RIM);
        // A steep skirt off the wall, then a round belly up to the lip.
        const z = rz * (t === 0 ? 0 : Math.sin((Math.PI / 2) * t) ** 1.1);
        return [ox + (rx - ox) * t, oy + (ry - oy) * t, z];
      },
      shade: t === 0 ? 0.86 : 1,
      jitter: t === 0 ? 0 : 0.015,
    });
  }
  rings.push({ at: (c, s) => mouth(c, s, RIM), shade: 1, jitter: 0.008 });
  // Rolled lip: crest, then curling over into the scoop.
  rings.push({ at: (c, s) => mouth(c, s, 0.005, 0.003), shade: 1, jitter: 0 });
  rings.push({ at: (c, s) => mouth(c, s, 0, -0.002), shade: 0.78, jitter: 0 });
  // The scoop: down and in from the mouth to a narrower floor, so the lip is undercut.
  const floor = (c: number, s: number) => {
    const [x, y, z] = mouth(c, s, 0, -D);
    return [0.85 * x, hy - D * up[0] + (y - hy + D * up[0]) * 0.55, zc - D * up[1] + (z - zc + D * up[1]) * 0.55];
  };
  for (const f of [0.35, 0.7, 1]) {
    rings.push({
      at: (c, s) => {
        const [mx, my, mz] = mouth(c, s, 0, -0.002);
        const [fx, fy, fz] = floor(c, s);
        // Bow the walls out a touch so the cup is round-bottomed, not a funnel.
        const belly = 1 + 0.1 * Math.sin(Math.PI * f);
        return [(mx + (fx - mx) * f) * belly, my + (fy - my) * f, mz + (fz - mz) * f];
      },
      shade: 0.55 - 0.25 * f,
      jitter: 0,
    });
  }

  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  // Droop toward the ends, and one end a little fuller.
  const droop = (x: number) => -bend * (x / W) ** 2;
  const fuller = (x: number) => 1 + lean * (x / W);
  rings.forEach((ring, i) => {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const [x, y, z] = ring.at(Math.cos(th), Math.sin(th), j);
      const jz = ring.jitter ? r.range(1 - ring.jitter, 1 + ring.jitter) : 1;
      pos.push(x, y + droop(x), z * fuller(x) * jz);
      shade.push(ring.shade);
    }
    if (i === 0) return;
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      const C = i * N + ((j + 1) % N);
      const D = i * N + j;
      index.push(A, B, C, A, C, D);
    }
  });
  const last = (rings.length - 1) * N;
  const centre = pos.length / 3;
  pos.push(0, hy - (D + 0.002) * up[0], zc - (D + 0.002) * up[1]);
  shade.push(0.28);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), centre);
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);

  // The bolt goes through the floor of the scoop, square to it, like a real bucket's.
  const floorAt = new THREE.Vector3(0, hy - (D + 0.002) * up[0], (zc - (D + 0.002) * up[1]) * fuller(0)).multiplyScalar(S);
  return {
    ...indexedToFlat(pos, shade, index, S),
    bolt: { at: floorAt.addScaledVector(new THREE.Vector3(0, up[0], up[1]), 0.0006), tilt: Math.atan2(up[0], up[1]) },
    // Fingers wrap the lip and sit in the scoop: chalk there, and on whatever faces up.
    grip: ((n, c) => {
      const x = c.x / S;
      // Where the face sits in the mouth's plane, in lip widths (1 = the outside
      // of the lip), and how far above (+) or down in the scoop (-) it is.
      const y = c.y / S - droop(x) - hy;
      const z = c.z / S / fuller(x) - zc;
      const d = Math.hypot(x / (a + RIM), (y * dir[0] + z * dir[1]) / (R + RIM));
      const w = y * up[0] + z * up[1];
      if (w < -D - 0.004 || w > 0.008) return 0.2 * TOP_GRIP(n, c);
      return d < 0.8 ? 0.5 + 0.5 * smooth(-0.3, 0.5, n.y) : d < 1.15 ? 0.6 * smooth(-0.2, 0.6, n.y + 0.4 * n.z) : 0.2 * TOP_GRIP(n, c);
    }) as GripFn,
  };
}

/**
 * A sloper: a broad bolt-on dome built in rings from its outline in to a crest
 * that sits low, below centre. From the crest the top rolls back to the wall
 * in a long, flat ramp where the palm goes (some variants dish it slightly, a
 * friction spot), while the bottom drops off in a steep, short shoulder. The
 * rim flares out thin where it meets the wall, like a cast shell, and the
 * outline is a hand-shaped lozenge, sometimes narrower at the top like a pear.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function sloperGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const N = 32;
  const W = 0.1 * (0.9 + 0.2 * k);
  const H = 0.078;
  const Z = 0.05 * (1.04 - 0.08 * k);
  // Crest: low, and a little off to one side.
  const cx = W * r.range(-0.12, 0.12);
  const cy = -H * (0.25 + 0.15 * k);
  const e = 0.72 + 0.18 * k;
  const pear = r.range(0, 0.2);
  const dish = r.range(0, 0.1);
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.04 * Math.sin(2 * th + p1) + 0.025 * Math.sin(3 * th + p2);
  });
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, e) * (1 - pear * Math.max(0, s)) * wobble[j],
    H * sgnpow(s, e) * wobble[j],
  ];
  // Rings: [t (outline → crest), lift (fraction of Z)]. A thin flared skirt,
  // a shoulder, then a broad, nearly flat top.
  const rings: [number, number][] = [
    [0, 0],
    [0.05, 0.14],
    [0.13, 0.38],
    [0.25, 0.63],
    [0.4, 0.83],
    [0.57, 0.94],
    [0.75, 0.985],
    [0.9, 1],
  ];
  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  rings.forEach(([t, lift], i) => {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const [ox, oy] = outline(c, s, j);
      // The bottom shoulder rises fast; the top rolls over slowly.
      const l = lift ** (s < 0 ? 1 - 0.4 * -s : 1 + 0.35 * s);
      // A faint dish across the upper ramp, where the palm sits.
      const palm = dish * Math.max(0, s) * Math.sin(Math.PI * t) ** 2;
      const jz = t > 0 && t < 0.9 ? r.range(0.985, 1.015) : 1;
      pos.push(ox + (cx - ox) * t, oy + (cy - oy) * t, Z * (l - palm) * jz);
      // The skirt sits in the shadow of the dome.
      shade.push(t === 0 ? 0.86 : 1);
    }
    if (i === 0) return;
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      const C = i * N + ((j + 1) % N);
      const D = i * N + j;
      index.push(A, B, C, A, C, D);
    }
  });
  const last = (rings.length - 1) * N;
  const crest = pos.length / 3;
  pos.push(cx, cy, Z);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), crest);
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);
  return {
    ...indexedToFlat(pos, shade, index, S),
    // Palmed, so the whole upper dome gets chalky, the steep underside barely.
    grip: ((n, c) => smooth(-0.35, 0.5, n.y + 0.5 * n.z) * (c.y / S > cy - 0.01 ? 1 : 0.4)) as GripFn,
  };
}

/**
 * A rib pinch: a tall fin bolted on end, built in rings from its outline in
 * to a blunt spine that runs most of its length. The flanks are steep so a
 * thumb and fingers can squeeze them; the spine leans a little to one side
 * and stands proudest near the top, and both ends roll over to the wall. Real
 * pinches are sculpted for the hand, so the finger flank carries a few soft
 * horizontal ribs where the fingertips sit and the thumb flank a shallow
 * dimple for the thumb pad. The outline is a lozenge, fuller at the bottom.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function pinchGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const N = 40;
  const W = 0.031 * (0.9 + 0.2 * k);
  const H = 0.081;
  const oy0 = 0.003;
  const Z = 0.048 * (1.04 - 0.08 * k);
  // Spine: how far it leans across the hold over its length, and how much it bows.
  const lean = r.range(-0.18, 0.18) * W;
  const bow = r.range(-0.12, 0.12) * W;
  const spineX = (yn: number) => lean * yn + bow * (1 - yn * yn);
  // Which flank the fingers take (the other gets the thumb); this variant's ribs.
  const fingers = r.chance(0.5) ? -1 : 1;
  const ribs = 2.5 + 1.5 * k;
  const ribPhase = r.range(0, 6.3);
  const ribDepth = r.range(0.1, 0.15);
  const thumbY = r.range(-0.25, 0.1);
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.03 * Math.sin(2 * th + p1) + 0.02 * Math.sin(3 * th + p2);
  });
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, 0.8) * (1 - 0.12 * s) * wobble[j],
    oy0 + H * sgnpow(s, 0.9) * wobble[j],
  ];
  // Height of the spine along the hold: proudest near the top, rolling off at the ends.
  const spineZ = (yn: number) => Z * (0.9 + 0.1 * yn) * (1 - 0.18 * yn * yn);
  // Rings: [t (outline → spine), lift (fraction of the spine's height)]. A steep
  // skirt, then flat, wedge-like flanks up to a crest a few millimetres wide.
  const rings: [number, number][] = [
    [0, 0],
    [0.05, 0.22],
    [0.2, 0.41],
    [0.4, 0.61],
    [0.6, 0.79],
    [0.8, 0.92],
    [0.93, 0.98],
    [1, 1],
  ];
  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  rings.forEach(([t, lift], i) => {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const [ox, oy] = outline(c, s, j);
      // The spine stops short of the ends, so they roll over instead of ending in a cliff.
      const ty = oy0 + (oy - oy0) * 0.55;
      const yn = (ty - oy0) / H;
      const tx = spineX(yn) + 0.06 * ox;
      const x = ox + (tx - ox) * t;
      const y = oy + (ty - oy) * t;
      const yr = Math.max(-1, Math.min(1, (y - oy0) / H));
      // Mid-flank only: the skirt and the crest stay clean.
      const flank = Math.sin(Math.PI * Math.min(1, t / 0.8)) * (t < 0.8 ? 1 : 0);
      const side = Math.sign(c);
      let dent = 0;
      if (side === fingers) dent = ribDepth * (0.5 + 0.5 * Math.cos(2 * Math.PI * ribs * yr + ribPhase)) * (1 - yr * yr);
      else dent = 0.16 * Math.exp(-(((yr - thumbY) / 0.28) ** 2));
      dent *= flank;
      const jz = t > 0 && t < 1 ? r.range(0.985, 1.015) : 1;
      pos.push(x, y, spineZ(yr) * lift * (1 - dent) * jz);
      // The skirt sits in shadow, and the ribs' troughs and the thumb dimple read a touch darker.
      shade.push(t === 0 ? 0.86 : 1 - 1.4 * dent);
    }
    if (i === 0) return;
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      const C = i * N + ((j + 1) % N);
      const D = i * N + j;
      index.push(A, B, C, A, C, D);
    }
  });
  const last = (rings.length - 1) * N;
  const crest = pos.length / 3;
  pos.push(spineX(0), oy0, spineZ(0));
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), crest);
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);
  return {
    ...indexedToFlat(pos, shade, index, S),
    // Thumb on one side, fingers on the other: chalk goes on both flanks, a little on the crest.
    grip: ((n) => smooth(0.3, 0.8, Math.abs(n.x)) * 0.9 + smooth(0.3, 0.8, n.y) * 0.3) as GripFn,
  };
}

/**
 * A screw-on foot chip: a D-shaped nub, flat across the top and rounded below,
 * built in rings from the outline in to a countersunk screw hole. The top edge
 * stands proud and is slightly incut (a little shelf the toe of a shoe sits on)
 * while the face ramps down toward the wall underneath, like the poured chips
 * gyms screw between the bolt holes. Returns the screw head's spot too.
 */
function footChipGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const N = 24;
  const W = 0.028 * (0.92 + 0.16 * k);
  const H = 0.021 * (1.04 - 0.08 * k);
  const Z = 0.017;
  // Screw hole: centre and countersink radius.
  const hy = -0.002;
  const rh = 0.0042;
  const incut = 0.003 + 0.002 * k;
  const p1 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => 1 + 0.04 * Math.sin(2 * ((j / N) * Math.PI * 2) + p1));
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, 0.75) * wobble[j],
    H * (s > 0 ? sgnpow(s, 0.45) : sgnpow(s, 0.9)) * wobble[j],
  ];
  // Tall at the top edge, ramping down to the bottom.
  const tall = (s: number) => Z * (0.62 + 0.38 * s);
  type Ring = [t: number, lift: number, shade: number];
  // Skirt rises steeply, then a flattish crown out to the countersink's rim.
  const rings: Ring[] = [
    [0, 0, 1],
    [0.06, 0.62, 1],
    [0.2, 0.92, 1],
    [0.45, 1, 1],
    [0.75, 0.98, 1],
    [1, 0.95, 0.92],
  ];
  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  const ringZ = (lift: number, s: number) => tall(s) * lift;
  const quad = (i: number) => {
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      index.push(A, B, i * N + ((j + 1) % N), A, i * N + ((j + 1) % N), i * N + j);
    }
  };
  rings.forEach(([t, lift, sh], i) => {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const [ox, oy] = outline(c, s, j);
      const x = ox + (1.7 * rh * c - ox) * t;
      let y = oy + (hy + 1.7 * rh * s - oy) * t;
      // The top lip leans out over its own base: a small incut shelf.
      if (t > 0 && t < 0.3) y += incut * Math.max(0, s) ** 3;
      // Hand-poured, so the skirt is a little uneven; the crown stays smooth.
      const jz = t > 0 && t < 0.3 ? r.range(0.95, 1.05) : 1;
      // The tilt fades out toward the middle, so the screw seats level.
      pos.push(x, y, ringZ(lift, s * (1 - t)) * jz);
      shade.push(sh);
    }
    if (i) quad(i);
  });
  // Countersink: a shallow shadowed cone down to a nearly flush screw head.
  const crown = rings[rings.length - 1][1];
  const sink = 0.0016;
  for (const [m, d, sh] of [
    [1, 0.75, 0.55],
    [0.85, 1, 0.4],
  ] as const) {
    const i = pos.length / 3 / N;
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const s = Math.sin(th);
      pos.push(rh * m * Math.cos(th), hy + rh * m * s, ringZ(crown, 0) - sink * d);
      shade.push(sh);
    }
    quad(i);
  }
  const last = pos.length / 3 - N;
  const centre = pos.length / 3;
  const screwZ = ringZ(crown, 0) - sink;
  pos.push(0, hy, screwZ);
  shade.push(0.3);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), centre);
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);
  return {
    ...indexedToFlat(pos, shade, index, S),
    screw: new THREE.Vector3(0, hy * S, screwZ * S),
    screwSize: S,
  };
}

/**
 * A jib: a small chipped stone screwed to the wall. An icosphere squashed into
 * a low pebble, then knocked flat by a handful of random cuts so it has the
 * broad, sharp-edged facets of knapped rock rather than an even tessellation.
 * A screw goes through the middle of its top facet.
 */
function jibGeometry(S: number, k: number, r: ReturnType<typeof rng>) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const scale: [number, number, number] = [0.019 * (0.85 + 0.3 * k), 0.015 * (1.1 - 0.2 * k), 0.013];
  // Cutting planes, mostly facing out of the wall and around the sides.
  const cuts = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + r.range(-0.4, 0.4);
    const tilt = i === 0 ? 0.1 : r.range(0.45, 1.1);
    const n = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.sin(tilt) * Math.sin(a), Math.cos(tilt)).normalize();
    return { n, d: r.range(0.62, 0.82) };
  });
  // Shared vertices move together, so faces stay closed.
  const moved = new Map<string, THREE.Vector3>();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const id = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    let q = moved.get(id);
    if (!q) {
      q = p.clone().multiplyScalar(r.range(0.94, 1.06));
      for (const { n, d } of cuts) {
        const over = q.dot(n) - d;
        if (over > 0) q.addScaledVector(n, -over);
      }
      q.z = Math.max(0, q.z + 0.15);
      moved.set(id, q);
    }
    pos.setXYZ(i, q.x * scale[0] * S, q.y * scale[1] * S, q.z * scale[2] * S);
  }
  const top = cuts[0];
  return { geometry: g, screw: new THREE.Vector3(0, 0, (top.d / top.n.z + 0.15) * scale[2] * S * 0.995), screwSize: S * 0.8 };
}

function indexedToFlat(pos: number[], shade: number[], index: number[], S: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v) => v * S), 3));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  const shadeOf = flat.attributes.shade.array as Float32Array;
  flat.deleteAttribute('shade');
  return { geometry: flat, shade: (i: number) => shadeOf[i] };
}

const SHAPES: Record<HoldType, Shape> = {
  // Built by jugGeometry; only `bolt` is read here.
  jug: { scale: [0.08, 0.05, 0.06], detail: 0, jitter: 0, bolt: true },
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
  // Built by sloperGeometry; only `bolt` is read here.
  sloper: { scale: [0.1, 0.078, 0.05], detail: 0, jitter: 0, bolt: true },
  // Built by pinchGeometry; only `bolt` is read here.
  pinch: { scale: [0.031, 0.081, 0.048], detail: 0, jitter: 0, bolt: true },
  // Built by pocketGeometry; only `bolt` is read here.
  pocket: { scale: [0.066, 0.056, 0.028], detail: 0, jitter: 0, bolt: false },
  // Built by footChipGeometry and jibGeometry; only `grip` is read here.
  // Rubber and chalk land on the top: shoes stand on it from above.
  foot: {
    scale: [0.028, 0.022, 0.016],
    detail: 0,
    jitter: 0,
    bolt: false,
    grip: (n) => smooth(0.0, 0.7, n.y + 0.3 * n.z) * 0.8,
  },
  jib: {
    scale: [0.019, 0.015, 0.013],
    detail: 0,
    jitter: 0,
    bolt: false,
    grip: (n) => smooth(0.0, 0.7, n.y + 0.3 * n.z) * 0.8,
  },
  // Never drawn as a hold: volumes have their own mesh (see Volumes.tsx).
  volume: {
    scale: [0.05, 0.05, 0.03],
    detail: 0,
    jitter: 0,
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
  /** How far the bolt leans from straight out of the wall toward +y (radians); 0 when unset. */
  boltTilt?: number;
  /** A small countersunk wood screw (foot chips, jibs): its head's centre and size scale. */
  screw?: { at: THREE.Vector3; size: number };
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
  if (type === 'pocket' || type === 'sloper' || type === 'pinch' || type === 'jug') {
    const build = { pocket: pocketGeometry, sloper: sloperGeometry, pinch: pinchGeometry, jug: jugGeometry }[type];
    const p = build(SIZE[size], k, r);
    const data = finish(p.geometry, r, spec.bolt, (_x, _y, _z, i) => p.shade(i), p.grip);
    if (type === 'jug') {
      const { at, tilt } = (p as ReturnType<typeof jugGeometry>).bolt;
      data.bolt = at;
      data.boltTilt = tilt;
    }
    cache.set(key, data);
    return data;
  }
  if (type === 'foot' || type === 'jib') {
    const p = type === 'foot' ? footChipGeometry(SIZE[size], k, r) : jibGeometry(SIZE[size], k, r);
    const shade = 'shade' in p ? p.shade : () => 1;
    const data = finish(p.geometry, r, false, (_x, _y, _z, i) => shade(i), spec.grip!);
    data.screw = { at: p.screw, size: p.screwSize };
    cache.set(key, data);
    return data;
  }
  const profile = PROFILES[type];
  if (profile) {
    const S = SIZE[size];
    // Shade tests are written in profile units, so undo the size scale.
    const data = finish(
      profileGeometry(profile, S, k, r),
      r,
      spec.bolt,
      (x, y, z) => profile.shade?.(x / S, y / S, z / S) ?? 1,
      profile.grip ?? spec.grip ?? TOP_GRIP,
    );
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
  // Grip tests see centres in unit-shape space, like `shape` and `shade`.
  const grip = spec.grip ?? TOP_GRIP;
  const unit = new THREE.Vector3();
  const data = finish(g, r, spec.bolt, (_x, _y, _z, i) => shadeOf[i], (n, c) =>
    grip(n, unit.set(c.x / (spec.scale[0] * s), c.y / (spec.scale[1] * s), c.z / (spec.scale[2] * s))),
  );
  cache.set(key, data);
  return data;
}

/** Per-face colour grain (+ shading, e.g. inside a scoop), chalk zones and the bolt washer's spot. */
function finish(
  g: THREE.BufferGeometry,
  r: ReturnType<typeof rng>,
  hasBolt: boolean,
  shade: (x: number, y: number, z: number, i: number) => number,
  gripOf: GripFn,
): HoldMeshData {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grip = new Float32Array(pos.count);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centre = new THREE.Vector3();
  for (let f = 0; f + 2 < pos.count; f += 3) {
    const grain = r.range(0.9, 1.05);
    let s = 1;
    for (let j = 0; j < 3; j++) s = Math.min(s, shade(pos.getX(f + j), pos.getY(f + j), pos.getZ(f + j), f + j));
    for (let j = 0; j < 3; j++) colors.set([grain * s, grain * s, grain * s], (f + j) * 3);
    // Flat faces, so one chalk value per face; patchy, like real chalk.
    a.fromBufferAttribute(pos, f);
    b.fromBufferAttribute(pos, f + 1);
    c.fromBufferAttribute(pos, f + 2);
    centre.copy(a).add(b).add(c).divideScalar(3);
    n.subVectors(c, b).cross(a.sub(b));
    if (n.lengthSq() < 1e-14) continue;
    n.normalize();
    // Faces flush against the wall never see a hand.
    const onWall = centre.z < 0.002 ? 0 : 1;
    const gv = Math.max(0, Math.min(1, gripOf(n, centre))) * onWall * r.range(0.65, 1);
    grip.fill(gv, f, f + 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('grip', new THREE.BufferAttribute(grip, 1));
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
