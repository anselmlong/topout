// Core data model. Everything lives in wall-plane coordinates:
// u = cm from the wall's left edge, v = cm along the wall surface from the floor.
// 3D positions are derived (see src/scene/wallGeometry.ts).

export type HoldType = 'jug' | 'crimp' | 'sloper' | 'pinch' | 'pocket' | 'edge' | 'foot' | 'jib' | 'volume';

export type VolumeShape = 'pyramid' | 'wedge';

/** A big bolt-on shape that changes the wall's angle locally. Holds can sit on it. */
export interface Volume {
  id: string;
  shape: VolumeShape;
  size: 's' | 'l';
  u: number;
  v: number;
  /** Radians about the wall normal. */
  rot: number;
}
export type HoldSize = 's' | 'm' | 'l';

export interface Hold {
  id: string;
  type: HoldType;
  size: HoldSize;
  u: number;
  v: number;
  /** Radians, counter-clockwise. 0 = incut edge faces up (best pulled straight down). */
  rot: number;
  /** Fixed start/finish holds are not movable and don't count toward the hold total. */
  role?: 'start' | 'finish';
  /**
   * Solver-only overrides, set for a volume's face contacts and for holds bolted onto
   * a volume: hand grip, foot quality, and the effective wall angle (degrees) there.
   */
  grip?: number;
  foot?: number;
  angle?: number;
  /** Orientation tolerance override (arête contacts can be pulled almost any way). */
  tol?: number;
}

export interface Panel {
  /** Height along the wall surface where this panel ends (cm). Panels stack from v = 0. */
  length: number;
  /** Degrees from vertical. Positive = overhang, negative = slab. */
  angle: number;
}

export interface Wall {
  width: number;
  panels: Panel[];
  /**
   * A fold along the vertical line u (cm), each face turned angle/2 degrees.
   * Positive: an inside corner (dihedral, like an open book).
   * Negative: an outside corner (arête) — the edge itself is climbable.
   * Only on single-panel walls.
   */
  fold?: { u: number; angle: number };
  /**
   * The break into the top panel is a rounded top-out lip (an overhang rolling over
   * into a slab): the edge itself can be grabbed, matched and heel-hooked.
   */
  lip?: boolean;
  /** Cosmetic relief seed. */
  seed: number;
}

export type Twist = 'no-jugs' | 'traverse' | 'no-smear';

export interface TraySlot {
  type: HoldType;
  size: HoldSize;
  count: number;
  /** For type 'volume'. Volumes come in 's' and 'l' only. */
  shape?: VolumeShape;
}

export interface Day {
  number: number;
  date: string;
  wall: Wall;
  start: Hold[];
  finish: Hold;
  tray: TraySlot[];
  targetGrade: number;
  twist?: Twist;
  par: number;
  /** A curated reference route (the one par came from), revealed after the day is done. */
  reference?: Hold[];
  referenceVolumes?: Volume[];
}

/** A foot can be on a hold (index), smearing, or off the wall. */
export const SMEAR = -1;
export const OFF = -2;

export interface Point {
  u: number;
  v: number;
}

export interface Stance {
  /** Hold indices: [leftHand, rightHand, leftFoot, rightFoot]. Feet may be SMEAR or OFF. */
  limbs: [number, number, number, number];
  /** Resolved contact points, same order. OFF feet get a dangling position. */
  points: [Point, Point, Point, Point];
}

export interface Move {
  limb: 0 | 1 | 2 | 3;
  from: Stance;
  to: Stance;
  difficulty: number;
  dynamic: boolean;
}

export type SolveResult =
  | {
      ok: true;
      grade: number;
      crux: number;
      moves: Move[];
      start: Stance;
    }
  | {
      ok: false;
      reason: 'no-start' | 'unreachable' | 'too-complex';
      message: string;
      /** Deepest stance reached, so the climber can fall from somewhere sensible. */
      highPoint?: Stance;
    };

export interface SolveOptions {
  noSmear?: boolean;
  volumes?: Volume[];
}
