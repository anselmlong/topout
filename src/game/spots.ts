// The taped start and finish spots. Their positions come with the day; the hold
// bolted on each one is the setter's choice.
import type { Day, Hold } from '../solver/types';

/** What the setter put on a spot. */
export type SpotHold = Pick<Hold, 'type' | 'size' | 'rot'>;

/** Keyed by spot id (`start-0`, `start-1`, `finish`). A missing key is an empty spot. */
export type Spots = Record<string, SpotHold>;

/** The day's spots, start first then finish: the order the solver's contact list uses. */
export const spotsOf = (day: Day): Hold[] => [...day.start, day.finish];

export const isSpotId = (day: Day, id: string) => spotsOf(day).some((h) => h.id === id);

/** The jugs a day was generated (and curated) with. Older saves and share links mean these. */
export function defaultSpots(day: Day): Spots {
  return Object.fromEntries(spotsOf(day).map((h) => [h.id, { type: h.type, size: h.size, rot: h.rot }]));
}

export const spotsFilled = (day: Day, spots: Spots) => spotsOf(day).every((h) => spots[h.id]);

/**
 * The day as climbed with these spot holds. `undefined` means the day's own jugs.
 * Every spot must be filled; the caller checks `spotsFilled` first.
 */
export function withSpots(day: Day, spots: Spots | undefined): Day {
  if (!spots) return day;
  const fill = (h: Hold) => ({ ...h, ...spots[h.id] });
  return { ...day, start: day.start.map(fill), finish: fill(day.finish) };
}
