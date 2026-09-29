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

export const HOLD_COLOR: Record<HoldType, string> = {
  jug: '#d6c59c',
  crimp: '#7b8a98',
  sloper: '#8e9f88',
  pinch: '#b88872',
  pocket: '#9a89a0',
  foot: '#4b4a47',
};

export const HOLD_NAME: Record<HoldType, string> = {
  jug: 'Jug',
  crimp: 'Crimp',
  sloper: 'Sloper',
  pinch: 'Pinch',
  pocket: 'Pocket',
  foot: 'Foot chip',
};

export const HOLD_HINT: Record<HoldType, string> = {
  jug: 'Deep and positive. Forgiving from most angles.',
  crimp: 'Thin edge. Needs a straight pull.',
  sloper: 'Rounded. Fine on slab, awful when steep.',
  pinch: 'Squeeze it. Works as a sidepull.',
  pocket: 'Finger hole. Solid if pulled in line.',
  foot: 'Feet only. Hands can’t use it.',
};
