// Practice walls are fully described by their URL, so a reload (or a shared
// link) rebuilds the same wall: ?practice=style.angle.grade.twist.seed
import { ALL_STYLES, ANGLE_RANGE, dateOf, dayNumber, generateDay, type WallStyle } from '../gen/day';
import type { Day, Twist } from '../solver/types';

export interface PracticeConfig {
  style: WallStyle;
  angle: number;
  grade: number;
  twist: Twist | null;
  seed: number;
}

const TWISTS: (Twist | 'none')[] = ['none', 'no-jugs', 'traverse', 'no-smear'];

export function practiceParam(c: PracticeConfig): string {
  return [c.style, c.angle, c.grade, c.twist ?? 'none', c.seed].join('.');
}

export function parsePractice(param: string | null): PracticeConfig | null {
  if (!param) return null;
  const [style, angle, grade, twist, seed] = param.split('.');
  if (!ALL_STYLES.includes(style as WallStyle) || !TWISTS.includes(twist as Twist)) return null;
  const [lo, hi] = ANGLE_RANGE[style as WallStyle];
  const a = Math.round(Number(angle));
  const g = Math.round(Number(grade));
  const s = Math.round(Number(seed));
  if (![a, g, s].every(Number.isFinite)) return null;
  return {
    style: style as WallStyle,
    angle: Math.max(lo, Math.min(hi, a)),
    grade: Math.max(0, Math.min(10, g)),
    twist: twist === 'none' ? null : (twist as Twist),
    seed: Math.abs(s),
  };
}

export function practiceDay(c: PracticeConfig): Day {
  const d = generateDay(c.seed, 0, {
    style: c.style,
    angle: c.angle,
    grade: c.grade,
    twist: c.twist,
    tray: 'practice',
  });
  return { ...d, number: 0, date: dateOf(dayNumber(new Date())), par: 0, reference: undefined };
}

export const randomSeed = () => Math.floor(Math.random() * 1e6);
