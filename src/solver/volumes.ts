// Volumes: big bolt-on shapes. All geometry here is in wall-plane cm, in the
// volume's local frame (x across, y up the wall, z out of the wall) rotated
// by `rot` about the wall normal.
//
// The solver sees a volume as one extra contact per face: an up-facing face is
// a foothold and a sloper-ish handhold, side faces are sidepulls, a down face
// is an undercling. Holds bolted onto a face take that face's angle.
import { angleAt, lipPanel, lipV } from './model';
import type { Hold, Volume, VolumeShape, Wall } from './types';

interface Dims {
  /** Pyramid: half base width. Wedge: half length along the ridge. */
  a: number;
  /** Wedge only: half width across the ridge. */
  b: number;
  /** How far it sticks out of the wall. */
  h: number;
}

const DIMS: Record<VolumeShape, Record<'s' | 'l', Dims>> = {
  pyramid: { s: { a: 24, b: 24, h: 18 }, l: { a: 36, b: 36, h: 28 } },
  wedge: { s: { a: 32, b: 17, h: 16 }, l: { a: 48, b: 24, h: 24 } },
};

export const volumeDims = (v: Pick<Volume, 'shape' | 'size'>) => DIMS[v.shape][v.size];

/** Radius of a circle that contains the footprint (for spacing and bounds checks). */
export function volumeRadius(v: Pick<Volume, 'shape' | 'size'>) {
  const d = volumeDims(v);
  return v.shape === 'pyramid' ? d.a * Math.SQRT2 : Math.hypot(d.a, d.b);
}

const toLocal = (vol: Volume, u: number, v: number) => {
  const du = u - vol.u;
  const dv = v - vol.v;
  const c = Math.cos(-vol.rot);
  const s = Math.sin(-vol.rot);
  return { x: du * c - dv * s, y: du * s + dv * c };
};

const toWall = (vol: Volume, x: number, y: number) => {
  const c = Math.cos(vol.rot);
  const s = Math.sin(vol.rot);
  return { u: vol.u + x * c - y * s, v: vol.v + x * s + y * c };
};

const rotateDir = (vol: Volume, x: number, y: number) => {
  const c = Math.cos(vol.rot);
  const s = Math.sin(vol.rot);
  return { u: x * c - y * s, v: x * s + y * c };
};

export interface Surface {
  /** cm out of the wall. */
  height: number;
  /** Unit face normal in wall space: u across, v up the wall, z out. */
  normal: { u: number; v: number; z: number };
}

/** The volume surface at (u, v), if any volume covers that point. Highest wins. */
export function surfaceAt(volumes: Volume[] | undefined, u: number, v: number): Surface | null {
  let best: Surface | null = null;
  for (const vol of volumes ?? []) {
    const d = volumeDims(vol);
    const { x, y } = toLocal(vol, u, v);
    let height: number;
    let gx = 0;
    let gy = 0;
    if (vol.shape === 'pyramid') {
      const m = Math.max(Math.abs(x), Math.abs(y));
      if (m >= d.a) continue;
      height = d.h * (1 - m / d.a);
      if (Math.abs(x) > Math.abs(y)) gx = (-Math.sign(x) * d.h) / d.a;
      else gy = (-Math.sign(y) * d.h) / d.a;
    } else {
      if (Math.abs(x) >= d.a || Math.abs(y) >= d.b) continue;
      height = d.h * (1 - Math.abs(y) / d.b);
      gy = (-Math.sign(y) * d.h) / d.b;
    }
    if (best && best.height >= height) continue;
    // Surface z = f(x, y) → normal ∝ (-df/dx, -df/dy, 1).
    const len = Math.hypot(gx, gy, 1);
    const dir = rotateDir(vol, -gx / len, -gy / len);
    best = { height, normal: { u: dir.u, v: dir.v, z: 1 / len } };
  }
  return best;
}

/** Effective wall angle (deg, + overhang) of a face with this normal, on a panel at `wallAngle`. */
export function faceAngle(wallAngle: number, n: Surface['normal']) {
  // A face tilted to point up (n.v > 0) is less steep than the wall it's on.
  return wallAngle - (Math.atan2(n.v, n.z) * 180) / Math.PI;
}

interface Face {
  x: number;
  y: number;
}

function faces(vol: Volume): Face[] {
  const d = volumeDims(vol);
  if (vol.shape === 'pyramid') {
    const c = (2 * d.a) / 3;
    return [
      { x: 0, y: c },
      { x: 0, y: -c },
      { x: c, y: 0 },
      { x: -c, y: 0 },
    ];
  }
  return [
    { x: 0, y: d.b / 2 },
    { x: 0, y: -d.b / 2 },
  ];
}

/** Which of `faces(vol)` the wall point (u, v) is on, or -1 if it's off the volume. */
function faceIndex(vol: Volume, u: number, v: number): number {
  const d = volumeDims(vol);
  const { x, y } = toLocal(vol, u, v);
  if (vol.shape === 'pyramid') {
    if (Math.max(Math.abs(x), Math.abs(y)) >= d.a) return -1;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 2 : 3) : y > 0 ? 0 : 1;
  }
  if (Math.abs(x) >= d.a || Math.abs(y) >= d.b) return -1;
  return y > 0 ? 0 : 1;
}

/**
 * One contact per face, as solver holds. A face with a hold bolted onto it is mostly
 * taken up by that hold: climbers use the hold, so the bare face is worth much less.
 */
export function volumeContacts(volumes: Volume[] | undefined, wall: Wall, placed: Hold[] = []): Hold[] {
  const out: Hold[] = [];
  for (const vol of volumes ?? []) {
    const taken = new Set(placed.map((h) => faceIndex(vol, h.u, h.v)));
    faces(vol).forEach((f, i) => {
      const p = toWall(vol, f.x, f.y);
      const s = surfaceAt([vol], p.u, p.v);
      if (!s) return;
      const n = s.normal;
      const inPlane = Math.hypot(n.u, n.v);
      const angle = faceAngle(angleAt(wall, p.v), n);
      // Pull away from where the face points: an up-facing face is pulled down, like a ledge.
      const rot = Math.atan2(n.u / (inPlane || 1), n.v / (inPlane || 1));
      // A bare face is smooth fibreglass: palmed or smeared, never as good as a hold bolted
      // onto it (climbers use the holds on a volume, and the volume when there's nothing else).
      // How much the face stands proud of the wall decides how positive it is.
      const grip = 0.22 + 0.25 * inPlane;
      // Feet like a face that points up in the real world; one facing the floor is useless.
      const worldUp = Math.max(0, -Math.sin((angle * Math.PI) / 180));
      const foot = angle > 55 ? 0 : 0.2 + 0.4 * worldUp + (angle < 10 ? 0.1 : 0);
      const bare = taken.has(i) ? 0.55 : 1;
      out.push({
        id: `${vol.id}:f${i}`,
        type: 'volume',
        size: vol.size === 'l' ? 'l' : 'm',
        u: p.u,
        v: p.v,
        rot,
        grip: grip * bare,
        foot: foot * bare,
        angle,
      });
    });
  }
  return out;
}

/** Holds bolted onto a volume take that face's angle. Holds on bare wall are unchanged. */
export function onVolumes(holds: Hold[], volumes: Volume[] | undefined, wall: Wall): Hold[] {
  if (!volumes?.length) return holds;
  return holds.map((h) => {
    const s = surfaceAt(volumes, h.u, h.v);
    return s ? { ...h, angle: faceAngle(angleAt(wall, h.v), s.normal) } : h;
  });
}

/**
 * The single list every stance index points into: start, finish, placed holds,
 * then each volume's face contacts. Solver, climber, beta and crux text all use this.
 */
export function contactList(start: Hold[], finish: Hold, placed: Hold[], volumes: Volume[] | undefined, wall: Wall) {
  return [...start, finish, ...onVolumes(placed, volumes, wall), ...volumeContacts(volumes, wall, placed), ...areteContacts(wall), ...lipContacts(wall)];
}

/**
 * An arête (outside corner) is itself a hold: contacts every 40 cm up the edge,
 * pulled from almost any direction (laybacks, slaps, pinches). Sharper = better.
 */
export function areteContacts(wall: Wall): Hold[] {
  const fold = wall.fold;
  if (!fold || fold.angle >= 0) return [];
  const sharp = Math.sin((Math.min(100, -fold.angle) * Math.PI) / 180);
  const top = wall.panels.reduce((h, p) => h + p.length, 0);
  const out: Hold[] = [];
  for (let v = 60, i = 0; v < top - 25; v += 40, i++)
    out.push({
      id: `arete:${i}`,
      type: 'volume',
      size: 'm',
      u: fold.u,
      v,
      rot: 0,
      grip: 0.13 + 0.12 * sharp,
      // Edging the corner is a poor foothold: about a smear.
      foot: 0.18 + 0.08 * sharp,
      tol: 1.4,
    });
  return out;
}

/**
 * A rollover (or overlap, or ledge) lip is itself a hold: a rounded edge every 40 cm along the break
 * it rolls over at. Pulled down from below (a big sloping rail you can match and shuffle
 * along), and a heel goes over it to rock up onto the slab: the classic mantle top-out.
 */
export function lipContacts(wall: Wall): Hold[] {
  if (!wall.lip || wall.panels.length < 2) return [];
  const p = wall.panels;
  const v = lipV(wall);
  const i = lipPanel(wall);
  // Sharper roll (steeper below, slabbier above) wraps the hand further over.
  const roll = Math.min(1, Math.max(0, (p[i - 1].angle - p[i].angle - 25) / 30));
  const out: Hold[] = [];
  for (let u = 40, i = 0; u <= wall.width - 40; u += 40, i++)
    out.push({
      id: `lip:${i}`,
      type: 'volume',
      size: 'm',
      u,
      // Just under the edge, so it's pulled (and hooked) on the overhang's angle.
      v: v - 3,
      rot: 0,
      grip: 0.5 + 0.12 * roll,
      foot: 0.45,
      tol: 0.9,
    });
  return out;
}
