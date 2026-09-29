import type { HoldType } from '../solver/types';

/** Muted, neutral scene palette. UI colors mirror these in styles.css. */
export const PALETTE = {
  sky: '#d8d4cc',
  floor: '#bab5ab',
  ply: '#cdbfa6',
  plyDark: '#a8987f',
  bolt: '#6d655a',
  pad: '#5f646b',
  padTop: '#6d737a',
  tape: '#f1eee6',
  ghostOk: '#6f9a7a',
  ghostBad: '#bf5b4f',
  select: '#f4f1ea',
  climber: '#d9d1c4',
  climberDark: '#8a8174',
};

/** Gym-plastic colours: bright enough to read like real holds, a touch softened for the scene. */
export const HOLD_COLOR: Record<HoldType, string> = {
  jug: '#e2b33c',
  edge: '#3f7cc0',
  crimp: '#d4553f',
  sloper: '#4fa878',
  pinch: '#8f5cc0',
  pocket: '#e07aa6',
  foot: '#2f3034',
  jib: '#8a8e95',
};

export const HOLD_NAME: Record<HoldType, string> = {
  jug: 'Jug',
  crimp: 'Crimp',
  sloper: 'Sloper',
  pinch: 'Pinch',
  pocket: 'Pocket',
  edge: 'Edge',
  foot: 'Foot chip',
  jib: 'Jib',
};

export const HOLD_HINT: Record<HoldType, string> = {
  jug: 'Deep and positive. Forgiving from most angles.',
  crimp: 'Thin edge. Needs a straight pull.',
  sloper: 'Rounded. Fine on slab, awful when steep.',
  pinch: 'Squeeze it. Pull along its length; weak across it.',
  pocket: 'Finger hole. Solid if pulled in line.',
  edge: 'Flat ledge. Honest, fairly forgiving.',
  foot: 'Feet only. Hands can’t use it.',
  jib: 'Tiny foot nub. Better than nothing.',
};
