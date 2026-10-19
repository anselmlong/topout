// Procedural low-poly hold meshes. Local frame: base on z = 0 (the wall),
// +z out of the wall, +y is the incut side (hold "up" at rot = 0). Metres.
//
// Edges, crimps and ledge jugs are side profiles lofted across their width;
// other jugs, horns, slopers, pinches, pockets, foot chips and jibs are built
// in rings around their outline. Jugs come in families (see JUG_FAMILIES).
// Each is jittered per variant so no two look quite alike, and each variant
// draws its incut (solver/model.ts incutOf): how far the lip wraps over, which is
// how hard the hold grips, so a player can read it. Per-face colour grain is baked in as vertex colours
// (multiplied with the material colour). A per-vertex `grip` attribute marks
// the surfaces hands and shoes actually use, so chalk builds up there and
// nowhere else (see the hold material in Scene.tsx).
import * as THREE from 'three';
import { hash, rng } from '../gen/rng';
import { depthOf, fingersOf, footDepthOf, footWidthOf, meanFootWidth, incutOf, jugDepthOf, jugWidthOf, meanDepth, meanJugDepth, meanFootDepth, meanPinchDepth, meanPitch, meanRadius, meanSloperWidth, PINCH_LENGTH, pinchDepthOf, pinchLengthOf, pitchOf, radiusOf, sloperWidthOf, spanOf, thumbOf, widthOf } from '../solver/model';
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
  /**
   * Side view: [out of wall, up] pairs in metres, from where the belly leaves
   * the wall at the bottom, out to the lip, back along the shelf and up into
   * the wall at the top. Smoothed through a spline, so a handful of points do.
   */
  pts: [number, number][];
  width: number;
  /** How blunt the ends are: higher keeps the full profile further out before it rounds off into the wall. */
  blunt: number;
  /** How much of the profile's height the very tip keeps (0 = it closes to a point). */
  tipHeight: number;
  /** Ends droop down by this much (m), giving the crescent of a real jug or rail. */
  bend?: number;
  /**
   * Hand-sculpted lip: how far (as a fraction) the reach out of the wall and
   * the top edge wander along the width, in two or three soft lumps. Real
   * edges are shaped by hand, so the lip is never a ruler-straight rail.
   */
  lumps?: number;
  /** Per-variant range for `bend`: below 0 the ends curl up into a smile instead of drooping. */
  bendRange?: [number, number];
  /** Where on the profile (0..1) the bolt goes through the face. */
  boltAt: number;
  /** Per-vertex roughness out of the wall (fraction); defaults to 0.05. */
  jitter?: number;
  grip?: GripFn;
}

/** Real-hold shapes, drawn as a side profile and lofted across the width. */
const PROFILES: Partial<Record<HoldType | 'ledge', Profile>> = {
  // A flat-topped ledge jug: a long bar standing well out of the wall with a
  // flat shelf deep enough for the whole first knuckle, a little lip at the
  // front to catch the fingertips, and a back wall the knuckles rest against.
  ledge: {
    pts: [
      [0, -0.03],
      [0.02, -0.025],
      [0.037, -0.014],
      [0.048, 0.0],
      [0.052, 0.012],
      [0.049, 0.019],
      [0.043, 0.018],
      [0.033, 0.0135],
      [0.021, 0.013],
      [0.01, 0.016],
      [0.004, 0.025],
      [0, 0.033],
    ],
    width: 0.16,
    blunt: 3.4,
    tipHeight: 0.45,
    bend: 0.008,
    lumps: 0.08,
    bendRange: [-0.4, 1.2],
    boltAt: 0.28,
    jitter: 0.015,
    // Fingers lie along the shelf and curl over the lip.
    grip: (n, c) => (c.z > 0.008 ? smooth(0.1, 0.7, n.y + 0.3 * Math.max(0, n.z)) : 0.2 * smooth(0.3, 0.8, n.y)),
  },
  // A flat ledge: a wedge-shaped body that slopes up out of the wall to a
  // rounded nose, a lip with a slight incut, and a shelf a couple of finger
  // pads deep that dips before it climbs back into the wall.
  edge: {
    pts: [
      [0, -0.034],
      [0.013, -0.027],
      [0.026, -0.016],
      [0.035, -0.004],
      [0.039, 0.006],
      [0.036, 0.013],
      [0.029, 0.015],
      [0.02, 0.012],
      [0.011, 0.012],
      [0.004, 0.016],
      [0, 0.021],
    ],
    width: 0.15,
    blunt: 2.6,
    tipHeight: 0.3,
    bend: 0.012,
    lumps: 0.13,
    bendRange: [-0.6, 1.6],
    boltAt: 0.3,
  },
  // A thin rail: barely a finger pad deep, a sharper nose, a shallow incut.
  crimp: {
    pts: [
      [0, -0.021],
      [0.009, -0.016],
      [0.016, -0.008],
      [0.021, 0.0],
      [0.022, 0.006],
      [0.019, 0.01],
      [0.014, 0.0105],
      [0.008, 0.009],
      [0.003, 0.011],
      [0, 0.014],
    ],
    width: 0.12,
    blunt: 2.2,
    tipHeight: 0.35,
    bend: 0.008,
    lumps: 0.16,
    bendRange: [-0.8, 1.8],
    boltAt: 0.28,
  },
};

/**
 * A profile's top side reshaped for its incut (0 flat .. 1 deep; the drawn profiles
 * are about 0.5). Past the nose, a deeper one's lip rises and leans back over the
 * shelf while the shelf behind it sinks, a hook the fingers curl into. A flatter one's
 * top straightens out into a rounded slope from the wall down to the nose, a hold that
 * rolls off outward.
 */
function incutProfile(pts: [number, number][], incut: number): [number, number][] {
  const d = incut - 0.5;
  const outMax = Math.max(...pts.map(([x]) => x));
  const nose = pts.findIndex(([x]) => x === outMax);
  const ys = pts.map(([, y]) => y);
  const h = Math.max(...ys) - Math.min(...ys);
  const [, back] = pts[pts.length - 1];
  const [, tip] = pts[nose];
  return pts.map(([x, y], i) => {
    if (i <= nose) return [x, y];
    const xn = x / outMax;
    if (d < 0) {
      const slope = back + (tip - back) * xn ** 1.6;
      return [x, y + (slope - y) * Math.min(1, -d / 0.4) * smooth(0.05, 0.3, xn)];
    }
    const lip = smooth(0.55, 0.85, xn);
    const shelf = smooth(0.12, 0.35, xn) * (1 - lip);
    return [x - d * 0.3 * outMax * lip, y + h * d * (0.36 * lip - 0.18 * shelf)];
  });
}

/**
 * A profile's front corner rebuilt at a radius (profile units, about metres), where the shelf turns
 * down into the face: a sharp lip is a crisp square nose the pads press over, a rounded one a
 * fat bullnose the shelf rolls off into (model.ts radiusOf). The corner is where the face's nose
 * meets the lip's top; the points inside the arc go and the arc takes their place.
 */
function radiusProfile(pts: [number, number][], rho: number): [number, number][] {
  const outMax = Math.max(...pts.map(([x]) => x));
  const nose = pts.findIndex(([x]) => x === outMax);
  const top = Math.max(...pts.slice(nose + 1).filter(([x]) => x > 0.6 * outMax).map(([, y]) => y));
  const below = Math.min(...pts.slice(0, nose + 1).filter(([x]) => x > 0.6 * outMax).map(([, y]) => y));
  // Never wider than the lip is thick, nor than the shelf is deep.
  const r = Math.min(rho, 0.8 * (top - below), 0.45 * outMax);
  const arc: [number, number][] = [];
  for (let i = 0; i <= 5; i++) {
    const t = (Math.PI / 2) * (i / 5);
    arc.push([outMax - r + r * Math.cos(t), top - r + r * Math.sin(t)]);
  }
  return [
    ...pts.slice(0, nose + 1).filter(([x, y], i) => i < nose && !(x > outMax - r && y > top - r)),
    ...arc,
    ...pts.slice(nose + 1).filter(([x]) => x < outMax - r - 0.002),
  ];
}

/**
 * An edge or crimp: the side profile swept across the hold's width as one
 * closed shell. Toward each end the profile shrinks out of the wall and down
 * in height along a superellipse, so the hold finishes in a rounded nose that
 * melts into the wall instead of a cut-off end. Columns bunch up toward the
 * ends where the shape turns fastest. Returns the bolt square to the face.
 */
function profileGeometry(pr: Profile, scale: number, k: number, r: ReturnType<typeof rng>, incut = 0.5, depth: number | null = null, length: number | null = null, radius: number | null = null, thumb = false) {
  // Enough rows down the profile that a sharp nose stays sharp.
  const M = radius !== null ? 26 : 14;
  // More columns where a thumb catch has to read as its own knob.
  const NU = thumb ? 28 : 18;
  // How far out of the wall: a crimp's or edge's shelf depth against its size's mean (model.ts
  // depthOf), so a shallow one reads as a thin strip and a deep one as a shelf; else a little play.
  const out = depth ?? 0.92 + 0.16 * k;
  // A crimp's or edge's lip radius (model.ts radiusOf, life-size mm, about a profile unit per metre),
  // drawn a little past life size so a bullnose reads from the floor.
  const pts = radius !== null ? radiusProfile(pr.pts, (1.3 * radius) / 1000) : pr.pts;
  const spline = new THREE.SplineCurve(incutProfile(pts, incut).map(([a, b]) => new THREE.Vector2(a * scale * out, b * scale)));
  const prof = spline.getSpacedPoints(M - 1);
  // Pin the ends to the wall exactly.
  prof[0].x = 0;
  prof[M - 1].x = 0;
  // How long the lip runs: a crimp's or edge's own length (model.ts widthOf, life-size cm, drawn
  // 20% large like everything), so a two-finger crimp reads as a stub; else a little play.
  const width = length !== null ? length * 0.012 : pr.width * scale * (0.9 + 0.2 * k);
  const yMin = Math.min(...prof.map((p) => p.y));
  const yMax = Math.max(...prof.map((p) => p.y));
  const outMax = Math.max(...prof.map((p) => p.x));
  const mid = (yMin + yMax) / 2;
  // Lumps along the lip: two soft waves with this variant's phases, plus a
  // lean so one end is a little fuller than the other.
  const ph = [r.range(0, 6.3), r.range(0, 6.3), r.range(0, 6.3)];
  const lean = r.range(-0.6, 0.6);
  const wave = (u: number) => 0.6 * Math.sin(Math.PI * (1.4 + 0.5 * k) * u + ph[0]) + 0.4 * Math.sin(Math.PI * 2.7 * u + ph[1]) + lean * u;
  const crest = (u: number) => Math.sin(Math.PI * (1.8 + 0.4 * k) * u + ph[2]);
  const lumps = pr.lumps ?? 0;
  const bend = (pr.bend ?? 0) * (pr.bendRange ? r.range(...pr.bendRange) : 1);
  // A crimp's thumb catch (model.ts thumbOf): a knob swelling out of the belly under one end of
  // the lip, hanging below it and nearly as far out as the nose, its underside a shelf the thumb
  // presses up on. Clear of the bolt at mid-width; which end is this build's.
  const thumbU = k < 0.5 ? 0.5 : -0.5;
  const knob = (u: number, hy: number) => (thumb ? Math.exp(-(((u - thumbU) / 0.24) ** 4)) * smooth(0.55, 0.15, hy) : 0);

  const at = (u: number, p: THREE.Vector2, j = 1): [number, number, number] => {
    const t = Math.abs(u);
    // Superellipse end: full profile through the middle, rounding off to nothing at the tip.
    const cap = Math.max(0, 1 - t ** pr.blunt) ** 0.5;
    const ho = p.x / (outMax || 1);
    const hy = (p.y - yMin) / (yMax - yMin || 1);
    // Lumps push the lip out and in along its length, and the top edge
    // (not the base on the wall) rises and dips with them.
    const lump = 1 + lumps * wave(u) * ho;
    const rise = lumps * 0.3 * (yMax - yMin) * crest(u) * smooth(0.35, 1, hy) * ho;
    const h = pr.tipHeight + (1 - pr.tipHeight) * cap;
    const x = Math.max(0, p.x * cap * lump * j);
    // The knob only adds: it drops the belly's bottom and swells it out, the rest carries on.
    const kn = p.y < mid ? knob(u, hy) * cap : 0;
    const z = Math.max(x, 0.85 * outMax * kn * Math.sin((Math.PI / 2) * Math.min(1, hy / 0.3)));
    return [(u * width) / 2, mid + (p.y - mid) * h - bend * scale * t * t + rise * cap - 0.45 * (yMax - yMin) * Math.sqrt(kn) * kn * (1 - hy), z];
  };

  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < NU; i++) {
    const u = Math.sin((Math.PI / 2) * (-1 + (2 * i) / (NU - 1)));
    for (let m = 0; m < M; m++) {
      const p = prof[m];
      const inner = m > 0 && m < M - 1 && Math.abs(u) < 0.999;
      const jit = pr.jitter ?? 0.05;
      pos.push(...at(u, p, inner ? r.range(1 - jit, 1 + jit) : 1));
      // The incut shelf behind the lip sits in its own shadow, darker the deeper it is.
      const shelf = p.y > mid && p.x < outMax * 0.75 ? 1.02 - 0.42 * incut : 1;
      shade.push(shelf);
    }
    if (i === 0) continue;
    for (let m = 0; m + 1 < M; m++) {
      const A = (i - 1) * M + m;
      const B = A + 1;
      const C = i * M + m + 1;
      const D = i * M + m;
      index.push(A, D, C, A, C, B);
    }
  }
  const flat = indexedToFlat(pos, shade, index, 1);

  // Bolt: through the belly at mid-width, square to it.
  const f = pr.boltAt * (M - 1);
  const p = prof[Math.floor(f)].clone().lerp(prof[Math.ceil(f)], f % 1);
  const tan = spline.getTangent(pr.boltAt);
  const [, by, bz] = at(0, p);
  // Profile runs bottom → top, so the outward normal is the tangent turned clockwise (out = +x in profile space).
  const n = new THREE.Vector2(tan.y, -tan.x).normalize();
  return {
    ...flat,
    bolt: { at: new THREE.Vector3(0, by + n.y * 0.0006, bz + n.x * 0.0006), tilt: Math.atan2(n.y, n.x) },
    // Where the thumb goes (local x, and the height under which the knob's underside is), for chalk.
    thumb: thumb ? { x: (thumbU * width) / 2, halfWidth: 0.2 * width, below: mid } : null,
  };
}

/**
 * A finger pocket: a domed teardrop body with a crisp oval hole above
 * centre. Built as rings around the hole rather than a dented ball, so the
 * rim is a sharp rolled edge, the hole has real walls and a floor, and the
 * top of the hole is hooded: the cavity runs up behind the lip, which is what
 * makes a good pocket incut. The hole is as wide as the fingers it takes
 * (model.ts fingersOf): a mono is a round dimple, a four-finger slot a long letterbox. It goes
 * as deep as the fingers do (model.ts depthOf, `depth` against its size's mean): a shallow dish
 * shows its pale floor just under the rim, a deep one stands a little prouder and its hole
 * drops into shadow. Its rim is rolled to its radius (model.ts radiusOf, `rim` against its size's
 * mean): a sharp one is a square-cut hole, the dome running right up to the edge and dropping
 * straight in; a rounded one is a wide bullnose curling down into the hole.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function pocketGeometry(S: number, k: number, r: ReturnType<typeof rng>, incut = 0.5, fingers = 2, depth = 1, rim = 1) {
  const N = 28;
  // The body widens to frame a long slot.
  const W = (0.056 + 0.0065 * fingers) * (0.94 + 0.1 * k);
  const H = 0.056 * (1.04 - 0.08 * k);
  // Hole: centre, half-width (a finger's width each) and half-height.
  const hy = 0.012 + 0.006 * k;
  const a = 0.006 + 0.0085 * fingers;
  const b = Math.min(0.012, 0.85 * a);
  // The hole's depth below the rim; a deep one lifts the body so the floor stays off the wall.
  const holeD = 0.02 * Math.max(0.4, Math.min(1.8, depth));
  const Z = 0.028 + 0.6 * Math.max(0, holeD - 0.02);
  const floorZ = Math.max(0.003, Z - holeD);
  // How dark the hole gets: a shallow floor catches the light, a deep one is in shadow.
  const dark = Math.max(0.3, Math.min(1.6, 1 + 1.4 * (depth - 1)));
  // How far the cavity runs up behind the lip: a deep hood wraps over the fingers.
  const undercut = 0.002 + 0.015 * incut;
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
  // The hood above the hole stands proud of the bottom lip, more so on a deep one.
  const rimZ = (s: number) => Z * (1 + (0.02 + 0.16 * incut) * s);
  const rings: Ring[] = [];
  // How far the rolled rim spreads round the hole and how far it curls down into it.
  const roll = Math.max(0.25, Math.min(2, rim));
  const RIM = 1 + 0.45 * roll;
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
  rings.push({ at: (c, s) => [...hole(c, s, 1 + 0.25 * roll), rimZ(s) + 0.002 * roll], shade: 1, jitter: 0 });
  rings.push({ at: (c, s) => [...hole(c, s, 1 + 0.07 * roll), rimZ(s) - 0.0012 * roll], shade: 0.9, jitter: 0 });
  rings.push({ at: (c, s) => [...hole(c, s, 1.0), rimZ(s) - 0.003 * roll], shade: 0.8, jitter: 0 });
  // Walls: the top of the cavity runs up and out behind the lip.
  for (const f of [0.35, 0.7, 1]) {
    rings.push({
      at: (c, s) => {
        // A shallow dish's walls close in toward its floor; a deep hole's run straight down.
        const [x, y] = hole(c, s, 1 + f * (0.12 - 0.6 * Math.max(0, 1 - depth)));
        return [x, y + undercut * f * Math.max(0, s), rimZ(s) - (rimZ(s) - floorZ) * f];
      },
      shade: Math.max(0.1, 1 - (0.5 + 0.22 * f) * dark),
      jitter: 0,
    });
  }
  rings.push({
    at: (c, s) => {
      const [x, y] = hole(c, s, 0.55);
      return [x, y + 0.5 * undercut * Math.max(0, s), floorZ - 0.0015];
    },
    shade: Math.max(0.1, 1 - 0.74 * dark),
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
  shade.push(Math.max(0.09, 1 - 0.76 * dark));
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
    // Down a deep hole the chalk sits in shadow; a shallow one shows it on its floor.
    grip: ((n, c) => {
      const d = Math.hypot(c.x / S / a, (c.y / S - hy) / b);
      const inside = c.z / S < Z * 0.82 && d < 1.2 ? Math.max(0.3, Math.min(1, 1.7 - dark)) : 1;
      return d < 1.4 ? (0.45 + 0.55 * smooth(-0.2, 0.6, n.y)) * inside : d < 2 ? 0.3 * smooth(0.2, 0.8, n.y) : 0.2 * TOP_GRIP(n, c);
    }) as GripFn,
  };
}

/** The shape of a ringed jug: its outline, its mouth and how deep the scoop behind the lip goes. */
interface JugForm {
  /** Half-width and half-height of the outline on the wall. */
  W: number;
  H: number;
  /** How square the ends are (superellipse exponent; lower is blockier). */
  ends: number;
  /** How much the ends droop (fraction of a bucket's droop). */
  droop: number;
  /** Mouth: centre height, how far out of the wall, half-width (fraction of W) and lip-to-back half-depth. */
  hy: number;
  zc: number;
  mouth: number;
  R: number;
  /** How far the mouth's plane tips up from facing straight out (radians). */
  tilt: number;
  /** How far the scoop drops below the mouth. */
  D: number;
  /** Belly profile exponent: under 1 bulges out early and rolls over to the lip, over 1 rises steep to it. */
  fill: number;
}

/** A deep bucket: a wide crescent with a thick lip over a scoop four fingers can bury in. */
const BUCKET: JugForm = { W: 0.08, H: 0.046, ends: 0.7, droop: 1, hy: 0.018, zc: 0.036, mouth: 0.58, R: 0.013, tilt: 0.305, D: 0.022, fill: 1.1 };
/**
 * A pinchable jug: narrow and tall, with blocky ends and steep flanks, so the
 * thumb wraps the side while the fingers take a deep but narrow scoop.
 */
const PINCH_JUG: JugForm = { W: 0.054, H: 0.056, ends: 0.42, droop: 0.25, hy: 0.022, zc: 0.042, mouth: 0.5, R: 0.012, tilt: 0.305, D: 0.022, fill: 0.85 };
/**
 * A slopey jug: a fat round dome with a small, shallow mouth high on its top,
 * a thumb-deep lip over a big rolled belly you half palm and half grab.
 */
const SLOPEY_JUG: JugForm = { W: 0.084, H: 0.056, ends: 0.78, droop: 0.7, hy: 0.03, zc: 0.044, mouth: 0.4, R: 0.008, tilt: 0.52, D: 0.011, fill: 0.6 };

/**
 * A bucket jug: a wide crescent bolted on its back, built in rings from its
 * outline up a round belly to a thick rolled lip. Behind the lip a scoop
 * drops down and in, with closed ends like a real bucket (not a trough cut
 * through the hold), so the fingers curl over the lip into a cup. The mouth
 * tilts up and out: the lip at the front stands proud while the back of the
 * scoop sits low against the wall, so from level you see the lip and a dark
 * slot behind it, and from above the whole bucket. The ends droop a little
 * (a frown, like most moulded jugs) and one end is fuller than the other.
 * `form` reshapes the same build into a pinchable or a slopey jug.
 * Local frame and units as the other holds; `S` is the size scale.
 */
function jugGeometry(S: number, k: number, r: ReturnType<typeof rng>, form: JugForm = BUCKET, wide = 1) {
  const N = 36;
  // Its width (model.ts jugWidthOf, against its family's mean): a narrow build for one hand,
  // a wide one with room to match.
  const W = form.W * wide;
  const H = form.H;
  // Mouth: centre (height, out of the wall), half-width, and half-depth from lip to back.
  const hy = form.hy + 0.003 * k;
  const zc = form.zc * (1.04 - 0.08 * k);
  const a = W * (form.mouth + 0.08 * k);
  const R = form.R + 0.004 * k;
  // The mouth lies in a plane tilted up and back by `tilt` from straight out:
  // `dir` runs from the lip to the back of the scoop, `up` is the plane's normal
  // (up and a little out). [y, z] pairs.
  const dir = [Math.sin(form.tilt), -Math.cos(form.tilt)];
  const up = [Math.cos(form.tilt), Math.sin(form.tilt)];
  // How far the scoop drops below the mouth.
  const D = form.D + 0.006 * k;
  // How the belly rises off the wall: under 1 it bulges out early and rolls over to the lip.
  const fill = form.fill;
  const bend = r.range(0.004, 0.016) * form.droop;
  const lean = r.range(-0.12, 0.12);
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.03 * Math.sin(2 * th + p1) + 0.02 * Math.sin(3 * th + p2);
  });
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, form.ends) * wobble[j],
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
        const z = rz * (t === 0 ? 0 : Math.sin((Math.PI / 2) * t) ** fill);
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
 * A horn: a stubby, tapering post that leaves the wall from a broad base,
 * stands out and curls up at its tip like a cow's horn, so the hand wraps it
 * like a handle or hooks over the tip. Built in rings square to a curved
 * spine, from a footprint flat on the wall to a rounded tip; the cross-section
 * is a little flattened top to bottom and the spine leans to one side. The
 * bolt goes through the apron below the horn. `S` is the size scale.
 */
function hornGeometry(S: number, k: number, r: ReturnType<typeof rng>, wide = 1) {
  const N = 24;
  const W = 0.05 * wide;
  const H = 0.047;
  // Spine: from the middle of the base out of the wall, curling up toward the tip.
  const y0 = 0.006;
  const L = 0.07 * (0.94 + 0.12 * k);
  const rise = 0.03 + 0.01 * k;
  const lean = r.range(-0.012, 0.012);
  const spine = (t: number) => new THREE.Vector3(lean * t * t, y0 + rise * t ** 2.2, L * Math.sin((Math.PI / 2) * t));
  const tangent = (t: number) => spine(Math.min(1, t + 0.01)).sub(spine(Math.max(0, t - 0.01))).normalize();
  // Cross-section half-sizes along the spine: a thick neck tapering to a round tip.
  const rx = (t: number) => 0.016 + 0.019 * (1 - t) ** 1.3;
  const ry = (t: number) => 0.014 + 0.016 * (1 - t) ** 1.3;
  const p1 = r.range(0, 6.3), p2 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => {
    const th = (j / N) * Math.PI * 2;
    return 1 + 0.035 * Math.sin(2 * th + p1) + 0.025 * Math.sin(3 * th + p2);
  });
  // The footprint: a rounded shield, with an apron below the horn for the bolt.
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, 0.8) * wobble[j],
    y0 + H * sgnpow(s, 0.85) * (s < 0 ? 1.15 : 0.75) * wobble[j],
  ];
  const X = new THREE.Vector3(1, 0, 0);
  const ringAt = (t: number, c: number, s: number) => {
    const T = tangent(t);
    const Y = new THREE.Vector3().crossVectors(T, X).negate().normalize();
    const Xs = new THREE.Vector3().crossVectors(Y, T).normalize();
    return spine(t).addScaledVector(Xs, rx(t) * c).addScaledVector(Y, ry(t) * s);
  };
  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  // Footprint, a low skirt, then rings up the horn.
  const ts = [0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9, 0.97];
  const rings = 2 + ts.length;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      if (i < 2) {
        // The base flares out over the wall: the footprint, then a skirt partway to the neck.
        const [ox, oy] = outline(c, s, j);
        const neck = ringAt(0.04, c, s);
        const t = i === 0 ? 0 : 0.42;
        const z = i === 0 ? 0 : 0.011 + 0.003 * Math.max(0, s);
        pos.push(ox + (neck.x - ox) * t, oy + (neck.y - oy) * t, z);
        shade.push(i === 0 ? 0.86 : 1);
        continue;
      }
      const t = ts[i - 2];
      const p = ringAt(t, c, s);
      const jz = r.range(0.985, 1.015);
      pos.push(p.x, p.y, p.z * jz);
      // The underside of the horn sits in its own shadow.
      shade.push(1 - 0.12 * Math.max(0, -s) * (1 - t));
    }
    if (i === 0) continue;
    for (let j = 0; j < N; j++) {
      const A = (i - 1) * N + j;
      const B = (i - 1) * N + ((j + 1) % N);
      const C = i * N + ((j + 1) % N);
      const D = i * N + j;
      index.push(A, B, C, A, C, D);
    }
  }
  // Rounded tip: a fan out to a point just past the last ring.
  const last = (rings - 1) * N;
  const tip = pos.length / 3;
  const end = spine(1).addScaledVector(tangent(1), 0.006);
  pos.push(end.x, end.y, end.z);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(last + j, last + ((j + 1) % N), tip);
  const base = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(base, (j + 1) % N, j);

  const flat = indexedToFlat(pos, shade, index, S);
  // The bolt goes through the apron under the horn, square to its face.
  const ray = new THREE.Raycaster(new THREE.Vector3(0, (y0 - 0.034) * S, 1), new THREE.Vector3(0, 0, -1));
  const mesh = new THREE.Mesh(flat.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const hit = ray.intersectObject(mesh)[0];
  const at = hit ? hit.point.clone() : new THREE.Vector3(0, (y0 - 0.034) * S, 0.008 * S);
  const n = hit?.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1);
  if (n.z < 0) n.negate();
  return {
    ...flat,
    bolt: { at: at.addScaledVector(n, 0.0006), tilt: Math.atan2(n.y, n.z) },
    // The hand wraps the horn: chalk all over its top and sides, most on top and over the tip.
    grip: ((nn, c) => (c.z / S > 0.018 ? 0.35 + 0.65 * smooth(-0.4, 0.6, nn.y) : 0.15 * TOP_GRIP(nn, c))) as GripFn,
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
function sloperGeometry(S: number, k: number, r: ReturnType<typeof rng>, incut = 0.15, pitch = 0, wide = 1) {
  const N = 32;
  // Its width (model.ts sloperWidthOf, here against its size's mean) is how much of the hand
  // it takes: a narrow dome for three fingers, or a wide one the palm spreads across. Drawn
  // a little under life-size spread (0.8-1.2), so it stays inside its placement radius (rules.ts).
  const W = 0.1 * wide;
  const H = 0.078;
  // Its pitch (model.ts pitchOf, here -1 flat-topped .. 1 steep against its size's mean) is
  // how far the palm ramp slopes off level: a flat-topped sloper stands proud with its crest
  // high, a rounded shelf; a steep one is a low bump whose ramp lies nearly flush to the wall.
  const Z = 0.05 * (1.04 - 0.08 * k) * (1 - 0.3 * pitch);
  // Crest: low, and a little off to one side.
  const cx = W * r.range(-0.12, 0.12);
  const cy = -H * (0.25 + 0.15 * k + 0.2 * pitch);
  const e = 0.72 + 0.18 * k;
  const pear = r.range(0, 0.2);
  // Its incut is the dish the palm sits in (a flat dome rolls off, a dished one holds).
  r.range(0, 0.1);
  const dish = 0.35 * incut;
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
function pinchGeometry(S: number, k: number, r: ReturnType<typeof rng>, incut = 0.5, span: number | null = null, depth = 1, length = 1) {
  const N = 40;
  // Half its width. Its span (model.ts spanOf, cm in life, drawn 20% large like the rest) is
  // what the thumb and fingers squeeze across, so a thin fin reads thin and a broad one broad.
  const W = span === null ? 0.031 * (0.9 + 0.2 * k) : (span * 0.006) / S;
  // Its finger flank's length (model.ts pinchLengthOf) against the longest its size comes in, so a
  // two-finger nubbin reads stubby beside a long rib.
  const H = 0.081 * length;
  const oy0 = 0.003;
  // How far it stands proud: its flank depth (model.ts pinchDepthOf) against its size's mean, so a
  // low-profile pinch reads squat and a deep one tall.
  const Z = 0.048 * (1.04 - 0.08 * k) * depth;
  // Spine: how far it leans across the hold over its length, and how much it bows.
  const lean = r.range(-0.18, 0.18) * W;
  const bow = r.range(-0.12, 0.12) * W;
  const spineX = (yn: number) => lean * yn + bow * (1 - yn * yn);
  // Which flank the fingers take (the other gets the thumb); this variant's ribs.
  const fingers = r.chance(0.5) ? -1 : 1;
  // A rib per fingertip or so, so a short pinch carries fewer.
  const ribs = (2.5 + 1.5 * k) * length;
  const ribPhase = r.range(0, 6.3);
  // Its incut is how deep the fingertip ribs are cut into the flank.
  r.range(0.1, 0.15);
  const ribDepth = 0.05 + 0.15 * incut;
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
 * Its incut (0 .. 1) is how positive that shelf is: a flat chip's top edge barely stands
 * proud and rolls over into the crown, a smeary nub; a deep one's lip juts out over a
 * shadowed shelf, a sharp step the toe stands on (solver/model.ts FOOT_INCUT).
 * Its depth (against its size's mean, model.ts footDepthOf) is how far the shelf stands out
 * from the wall, and its outline grows with it: a tiny chip is a low, narrow nub the rand barely catches, a big one a fat
 * block the front of the shoe sits on.
 * Its width (against its size's mean, model.ts footWidthOf) stretches it across the wall: a narrow
 * chip is a stubby nub one toe fits on, a wide one a little foot rail with room for both shoes.
 */
function footChipGeometry(S: number, k: number, r: ReturnType<typeof rng>, incut = 0.45, depth = 1, width = 1) {
  const N = 24;
  const W = 0.028 * (0.92 + 0.16 * k) * (0.7 + 0.3 * depth) * width;
  const H = 0.021 * (1.04 - 0.08 * k) * (0.6 + 0.4 * depth);
  const Z = 0.017 * depth;
  // Screw hole: centre and countersink radius.
  const hy = -0.002;
  const rh = 0.0042;
  const lean = 0.0005 + 0.011 * incut;
  const p1 = r.range(0, 6.3);
  const wobble = Array.from({ length: N }, (_, j) => 1 + 0.04 * Math.sin(2 * ((j / N) * Math.PI * 2) + p1));
  const outline = (c: number, s: number, j: number): [number, number] => [
    W * sgnpow(c, 0.75) * wobble[j],
    H * (s > 0 ? sgnpow(s, 0.45) : sgnpow(s, 0.9)) * wobble[j],
  ];
  // Tall at the top edge, ramping down to the bottom; a flat chip's top edge hardly stands
  // proud, so it reads as a rounded dome.
  const tall = (s: number) => Z * (0.62 + 0.38 * s * (0.35 + 0.65 * incut));
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
      if (t > 0 && t < 0.3) y += lean * Math.max(0, s) ** 3;
      // ...over its own shadow: the deeper the shelf, the darker under the lip.
      const under = t > 0 && t < 0.1 ? 1 - 0.5 * incut * Math.max(0, s) ** 3 : 1;
      // Hand-poured, so the skirt is a little uneven; the crown stays smooth.
      const jz = t > 0 && t < 0.3 ? r.range(0.95, 1.05) : 1;
      // The tilt fades out toward the middle, so the screw seats level.
      pos.push(x, y, ringZ(lift, s * (1 - t)) * jz);
      shade.push(sh * under);
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
 * A jib: a small knapped stone screwed to the wall. Three staggered rings of
 * six or seven points (the footprint, a girdle half a step round, and a small
 * crown back in line with the footprint) are joined by single triangles, so
 * the sides break into the broad, sharp-ridged facets of chipped rock rather
 * than an even tessellation. The top side stands taller and its girdle leans
 * out over the footprint: a little positive edge for the toe of a shoe, the
 * way setters turn a jib so its sharp side faces up. The crown is a flat-ish
 * facet with a countersunk screw through it. Returns the screw head's spot.
 * Its incut (0 .. 1) is how sharp that edge is: a blunt jib's girdle barely leans out, a
 * sharp one's juts over the footprint with a shadowed step under it.
 * Its depth (against its size's mean, model.ts footDepthOf) is how far it stands proud, and
 * its footprint grows with it: a low jib is a flat pebble, a tall one a knobbly stone.
 */
function jibGeometry(S: number, k: number, r: ReturnType<typeof rng>, incut = 0.45, depth = 1) {
  const N = r.chance(0.5) ? 6 : 7;
  const W = 0.019 * (0.85 + 0.3 * k) * (0.55 + 0.45 * depth);
  const H = 0.015 * (1.1 - 0.2 * k) * (0.65 + 0.35 * depth);
  const Z = 0.013 * depth;
  const rh = 0.0026;
  const spin = r.range(0, 6.3);
  // The top side stands taller, so the crown tips down toward the bottom.
  const tall = (s: number) => Z * (0.72 + 0.28 * s);
  const pos: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  const ring = (half: boolean, at: (c: number, s: number) => [number, number, number], sh: number) => {
    const first = pos.length / 3;
    for (let j = 0; j < N; j++) {
      const th = ((j + (half ? 0.5 : 0) + r.range(-0.18, 0.18)) / N) * Math.PI * 2 + spin;
      pos.push(...at(Math.cos(th), Math.sin(th)));
      shade.push(sh);
    }
    return first;
  };
  // Footprint: an uneven polygon flat on the wall.
  const base = ring(false, (c, s) => {
    const m = r.range(0.86, 1.08);
    return [W * c * m, H * s * m, 0];
  }, 1);
  // Girdle: most of the width and height; on the top side it leans out over the footprint.
  const girdle = ring(true, (c, s) => {
    const m = r.range(0.8, 0.96);
    return [W * c * m, H * s * m + (0.0004 + 0.0055 * incut) * Math.max(0, s) ** 2, tall(s) * r.range(0.58, 0.7)];
  }, 1);
  // The step under the sharp side sits in its shadow: shade the footprint's top points, which
  // only touch that band (faces take their darkest corner), so the crown stays light.
  for (let j = 0; j < N; j++) {
    const y = pos[(base + j) * 3 + 1];
    if (y > 0) shade[base + j] = 1 - 0.4 * incut * Math.min(1, y / H);
  }
  // Crown: a small top facet, slightly domed, nudged up toward the sharp side.
  const crown = ring(false, (c, s) => {
    const m = r.range(0.55, 0.64);
    return [W * c * m, H * s * m + 0.0015, tall(s * m) * r.range(0.96, 1)];
  }, 0.97);
  // Lower ring i to upper ring i+half: footprint→girdle and crown↔girdle alternate.
  const band = (lo: number, hi: number, hiAhead: boolean) => {
    for (let j = 0; j < N; j++) {
      const a = lo + j, b = lo + ((j + 1) % N);
      const m = hiAhead ? hi + j : hi + ((j + N - 1) % N);
      const n = hiAhead ? hi + ((j + 1) % N) : hi + j;
      // hiAhead: upper point j sits between lower points j and j+1.
      if (hiAhead) index.push(a, b, m, m, b, n);
      else index.push(a, b, n, a, n, m);
    }
  };
  band(base, girdle, true);
  // Crown point j sits between girdle points j-1 and j.
  for (let j = 0; j < N; j++) {
    const g0 = girdle + ((j + N - 1) % N), g1 = girdle + j;
    const c0 = crown + j, c1 = crown + ((j + 1) % N);
    index.push(g0, g1, c0, c0, g1, c1);
  }
  // Countersink: a shadowed cone in the middle of the crown, down to a nearly flush screw head.
  const crownZ = tall(0.05) * 0.99;
  const sinkRing = ring(false, (c, s) => [rh * c, 0.0015 + rh * s, crownZ - 0.0006], 0.62);
  for (let j = 0; j < N; j++) {
    const c0 = crown + j, c1 = crown + ((j + 1) % N);
    const s0 = sinkRing + j, s1 = sinkRing + ((j + 1) % N);
    index.push(c0, c1, s1, c0, s1, s0);
  }
  const centre = pos.length / 3;
  const screwZ = crownZ - 0.0012;
  pos.push(0, 0.0015, screwZ);
  shade.push(0.32);
  for (let j = 0; j < N; j++) index.push(sinkRing + j, sinkRing + ((j + 1) % N), centre);
  // Back face, flush on the wall.
  const back = pos.length / 3;
  pos.push(0, 0, 0);
  shade.push(1);
  for (let j = 0; j < N; j++) index.push(back, base + ((j + 1) % N), base + j);
  return {
    ...indexedToFlat(pos, shade, index, S),
    screw: new THREE.Vector3(0, 0.0015 * S, screwZ * S),
    screwSize: S * 0.8,
  };
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
  // Built by jugGeometry, hornGeometry or the ledge profile (see JUG_FAMILIES); unused here.
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
// A macro is built at medium scale and then stretched to its own proportions (MACRO_STRETCH).
const SIZE: Record<HoldSize, number> = { s: 0.95, m: 1.2, l: 1.5, xl: 1.2 };
/**
 * How a macro (size 'xl') stretches its type's medium build, [across, up, out of the wall]:
 * a dual-texture sloper ~50 cm wide, a ledge ~45 cm long with a shelf a hand deep, a pinch
 * block ~20 cm wide, standing off the wall by its own depth (model.ts PINCH_DEPTH xl, centred on
 * this stretch). Keep in step with rules.ts MACRO_RADIUS.
 */
const MACRO_STRETCH: Partial<Record<HoldType, [number, number, number]>> = {
  sloper: [2.05, 1.6, 1.55],
  edge: [2.5, 1.55, 1.75],
  pinch: [2.6, 1.25, 1.7],
};
/** A pinch's span as built before macroMesh stretches it across, so a pinch block is drawn at its own. */
function macroSpan(size: HoldSize, span: number | null): number | null {
  return span !== null && size === 'xl' ? span / MACRO_STRETCH.pinch![0] : span;
}
const VARIANTS = 4;
/**
 * Jug families, picked by variant: deep buckets most often, then a flat-topped
 * ledge, a horn, a pinchable jug and a slopey jug. Each also comes in two builds.
 */
const JUG_FAMILIES = ['bucket', 'ledge', 'bucket', 'horn', 'pinch', 'slopey'] as const;

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
  return size === 'xl' ? macroMesh(type, variant) : baseMesh(type, size, variant);
}

/**
 * A macro: its type's build stretched big, and dual-texture like the real thing. The faces a
 * hand or shoe uses (the build's grip zone: a sloper's upper dome, a ledge's shelf and lip, a
 * pinch block's flanks) keep the cast-in grit; the rest is cast smooth and glossy, so it
 * gives nothing to hand or shoe and steers where the body goes. A `tex` attribute carries
 * which is which to the hold material.
 */
function macroMesh(type: HoldType, variant: number): HoldMeshData {
  const key = `macro:${type}:${variant % VARIANTS}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = baseMesh(type, 'xl', variant);
  const [sx, sy, sz] = MACRO_STRETCH[type] ?? [2, 2, 1.6];
  const g = base.geometry.clone();
  g.scale(sx, sy, sz);
  const grip = g.attributes.grip as THREE.BufferAttribute;
  const tex = new Float32Array(grip.count);
  for (let i = 0; i < grip.count; i++) tex[i] = grip.getX(i) > 0.3 ? 1 : 0;
  g.setAttribute('tex', new THREE.BufferAttribute(tex, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  // The bolt rides the stretched surface; a normal under a non-uniform scale turns by the inverse.
  const t = base.boltTilt ?? 0;
  const data: HoldMeshData = {
    geometry: g,
    bolt: base.bolt ? base.bolt.clone().multiply(new THREE.Vector3(sx, sy, sz)) : null,
    boltTilt: Math.atan2(Math.sin(t) / sy, Math.cos(t) / sz),
  };
  cache.set(key, data);
  return data;
}

function baseMesh(type: HoldType, size: HoldSize, variant: number): HoldMeshData {
  if (type === 'jug') {
    // Jugs come in families, so a wall of them doesn't look cloned.
    const family = JUG_FAMILIES[variant % JUG_FAMILIES.length];
    const kj = Math.floor(variant / JUG_FAMILIES.length) % 2 ? 0.8 : 0.2;
    const key = `jug-family:${size}:${variant % (2 * JUG_FAMILIES.length)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const rj = rng(hash(3, 0x6a, family.length, size.charCodeAt(0), variant % (2 * JUG_FAMILIES.length)));
    // Its width (model.ts jugWidthOf) against its family's mean, drawn a little under the life-size
    // spread (^0.6, as a sloper's) so a wide build stays inside its placement radius (rules.ts).
    const f = variant % JUG_FAMILIES.length;
    const wide = (jugWidthOf(size, variant) / ((jugWidthOf(size, f) + jugWidthOf(size, f + JUG_FAMILIES.length)) / 2)) ** 0.6;
    const p =
      family === 'ledge'
        ? { ...profileGeometry(PROFILES.ledge!, SIZE[size], kj, rj, incutOf('jug', size, variant), null, (PROFILES.ledge!.width * SIZE[size] * wide) / 0.012), grip: PROFILES.ledge!.grip! }
        : family === 'horn'
          ? hornGeometry(SIZE[size], kj, rj, wide)
          : jugGeometry(SIZE[size], kj, rj, { bucket: BUCKET, pinch: PINCH_JUG, slopey: SLOPEY_JUG }[family], wide);
    // How far it stands off the wall (model.ts jugDepthOf) against its size's mean, drawn a little
    // past the life-size spread (^1.5) so it reads from the floor: a shallow scoop sits flatter
    // to the wall, a deep one stands out for the whole hand.
    const mean = meanJugDepth(size);
    const out = mean ? (jugDepthOf(size, variant)! / mean) ** 1.5 : 1;
    p.geometry.scale(1, 1, out);
    p.bolt.at.z *= out;
    const at = new THREE.Vector3();
    const data = finish(p.geometry, rj, false, (_x, _y, _z, i) => p.shade(i), (n, c) => p.grip(n, at.set(c.x, c.y, c.z / out)));
    data.bolt = p.bolt.at;
    data.boltTilt = p.bolt.tilt;
    cache.set(key, data);
    return data;
  }
  const v = variant % VARIANTS;
  const key = `${type}:${size}:${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = SHAPES[type];
  const r = rng(hash(type.length, type.charCodeAt(0), type.charCodeAt(1), size.charCodeAt(0), v));
  const k = v / (VARIANTS - 1);
  if (type === 'pocket' || type === 'sloper' || type === 'pinch') {
    const p =
      type === 'pocket'
        ? pocketGeometry(SIZE[size], k, r, incutOf(type, size, v), fingersOf(size, v), depthOf(type, size, v)! / meanDepth(type, size)!, radiusOf(type, size, v)! / meanRadius(type, size)!)
        : type === 'pinch'
          ? pinchGeometry(SIZE[size], k, r, incutOf(type, size, v), macroSpan(size, spanOf(size, v)), (pinchDepthOf(size, v) ?? 1) / (meanPinchDepth(size) ?? 1), (pinchLengthOf(size, v) ?? 1) / Math.max(...(PINCH_LENGTH[size] ?? [1])))
          : sloperGeometry(SIZE[size], k, r, incutOf(type, size, v), ((pitchOf(size, v) ?? 0) - (meanPitch(size) ?? 0)) / 12, size === 'xl' ? 0.9 + 0.2 * k : (sloperWidthOf(size, v)! / meanSloperWidth(size)!) ** 0.6);
    const data = finish(p.geometry, r, spec.bolt, (_x, _y, _z, i) => p.shade(i), p.grip);
    cache.set(key, data);
    return data;
  }
  if (type === 'foot' || type === 'jib') {
    const mm = footDepthOf(size, v, type);
    const depth = mm === null ? 1 : mm / meanFootDepth(size, type)!;
    const cm = footWidthOf(size, v);
    const p = type === 'foot' ? footChipGeometry(SIZE[size], k, r, incutOf(type, size, v), depth, cm === null ? 1 : cm / meanFootWidth(size)!) : jibGeometry(SIZE[size], k, r, incutOf(type, size, v), depth);
    const data = finish(p.geometry, r, false, (_x, _y, _z, i) => p.shade(i), spec.grip!);
    data.screw = { at: p.screw, size: p.screwSize };
    cache.set(key, data);
    return data;
  }
  const profile = PROFILES[type];
  if (profile) {
    const mm = depthOf(type, size, v);
    const p = profileGeometry(profile, SIZE[size], k, r, incutOf(type, size, v), mm === null ? null : mm / meanDepth(type, size)!, size === 'xl' ? null : widthOf(type, size, v), radiusOf(type, size, v), thumbOf(type, size, v));
    const top = profile.grip ?? spec.grip ?? TOP_GRIP;
    // A thumb catch's underside takes chalk from the thumb pressing up on it.
    const th = p.thumb;
    const gripOf: GripFn = th ? (n, c) => Math.max(top(n, c), Math.abs(c.x - th.x) < th.halfWidth && c.y < th.below && c.z > 0.004 ? 0.85 * smooth(0.1, 0.6, -n.y) : 0) : top;
    const data = finish(p.geometry, r, spec.bolt, (_x, _y, _z, i) => p.shade(i), gripOf);
    data.bolt = p.bolt.at;
    data.boltTilt = p.bolt.tilt;
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
  // Textured all over (macros mark their smooth faces; see macroMesh).
  g.setAttribute('tex', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1));
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
