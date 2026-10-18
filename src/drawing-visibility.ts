import { ChartError } from './errors.ts';
import type {
  Drawing,
  DrawingVisibility,
  DrawingVisibilityRange,
  DrawingVisibilityUnit,
} from './drawing-types.ts';

/** One row of the Visibility settings: the interval family and the counts it accepts. */
export interface DrawingVisibilityUnitInfo {
  unit: DrawingVisibilityUnit;
  label: string;
  min: number;
  max: number;
}

/** In settings order. Tick and range counts follow the interval syntax, up to six digits. */
export const DRAWING_VISIBILITY_UNITS: readonly DrawingVisibilityUnitInfo[] = Object.freeze([
  { unit: 'ticks', label: 'Ticks', min: 1, max: 999_999 },
  { unit: 'seconds', label: 'Seconds', min: 1, max: 59 },
  { unit: 'minutes', label: 'Minutes', min: 1, max: 59 },
  { unit: 'hours', label: 'Hours', min: 1, max: 24 },
  { unit: 'days', label: 'Days', min: 1, max: 366 },
  { unit: 'weeks', label: 'Weeks', min: 1, max: 52 },
  { unit: 'months', label: 'Months', min: 1, max: 12 },
  { unit: 'ranges', label: 'Ranges', min: 1, max: 999_999 },
]);
const info = (unit: DrawingVisibilityUnit) => DRAWING_VISIBILITY_UNITS.find(u => u.unit === unit)!;

/** The range a family has when nothing is stored: on, every count. */
export function defaultVisibilityRange(unit: DrawingVisibilityUnit): DrawingVisibilityRange {
  const { min, max } = info(unit);
  return { enabled: true, from: min, to: max };
}
/** The stored range for a family, or its default. */
export function visibilityRange(
  visibility: DrawingVisibility | undefined,
  unit: DrawingVisibilityUnit,
): DrawingVisibilityRange {
  return { ...(visibility?.[unit] ?? defaultVisibilityRange(unit)) };
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Checks a visibility record and keeps only families that differ from their default, so
 * drawings shown everywhere serialize without the field. Missing fields of a family take
 * its default; `from` and `to` must be whole counts inside its bounds, in order.
 */
export function normalizedVisibility(value: unknown): DrawingVisibility | undefined {
  if (value === undefined || value === null) return undefined;
  if (!object(value)) throw new ChartError('INVALID_DRAWING_VISIBILITY');
  const result: DrawingVisibility = {};
  for (const [unit, given] of Object.entries(value)) {
    const bounds = DRAWING_VISIBILITY_UNITS.find(u => u.unit === unit);
    if (!bounds || !object(given) || Object.keys(given).some(key => !['enabled', 'from', 'to'].includes(key)))
      throw new ChartError('INVALID_DRAWING_VISIBILITY', unit, { path: `visibility.${unit}` });
    const range = { ...defaultVisibilityRange(bounds.unit), ...given };
    const count = (n: unknown) =>
      Number.isInteger(n) && (n as number) >= bounds.min && (n as number) <= bounds.max;
    if (typeof range.enabled !== 'boolean' || !count(range.from) || !count(range.to) || range.from > range.to)
      throw new ChartError('INVALID_DRAWING_VISIBILITY', unit, {
        path: `visibility.${unit}`,
        details: { min: bounds.min, max: bounds.max },
      });
    if (!range.enabled || range.from !== bounds.min || range.to !== bounds.max)
      result[bounds.unit] = { enabled: range.enabled, from: range.from, to: range.to };
  }
  return Object.keys(result).length ? result : undefined;
}

const ROLL_UP: Partial<Record<DrawingVisibilityUnit, [DrawingVisibilityUnit, number]>> = {
  seconds: ['minutes', 60],
  minutes: ['hours', 60],
  hours: ['days', 24],
  days: ['weeks', 7],
};
const UNITS: Record<string, DrawingVisibilityUnit> = {
  t: 'ticks',
  s: 'seconds',
  m: 'minutes',
  h: 'hours',
  d: 'days',
  w: 'weeks',
  M: 'months',
  r: 'ranges',
  mr: 'ranges',
};

/**
 * The family and count an interval falls under, or `null` for an unknown interval.
 * Counts above a family's maximum roll up when they divide evenly (`120m` is 2 hours,
 * `48h` is 2 days) and otherwise count as the maximum (`90m` is 59 minutes).
 * Momentum bars count as ranges.
 */
export function intervalVisibility(interval: string): { unit: DrawingVisibilityUnit; count: number } | null {
  const match = /^([1-9]\d{0,5})(mr|[tsmhdwMr])$/.exec(interval);
  if (!match) return null;
  let unit = UNITS[match[2]],
    count = Number(match[1]);
  for (
    let next = ROLL_UP[unit];
    next && count > info(unit).max && count % next[1] === 0;
    next = ROLL_UP[unit]
  ) {
    count /= next[1];
    unit = next[0];
  }
  return { unit, count: Math.min(count, info(unit).max) };
}

/** True when the drawing's interval rules show it on `interval`. Unknown intervals show it. */
export function visibleOnInterval(
  drawing: Pick<Drawing, 'visibility'>,
  interval: string | undefined,
): boolean {
  if (!drawing.visibility || interval === undefined) return true;
  const at = intervalVisibility(interval);
  const range = at && drawing.visibility[at.unit];
  return !range || (range.enabled && at.count >= range.from && at.count <= range.to);
}

/** Visible by its own flag and on the interval: what the scene paints and hit-tests. */
export function drawingShown(drawing: Pick<Drawing, 'visible' | 'visibility'>, interval: string | undefined) {
  return drawing.visible && visibleOnInterval(drawing, interval);
}
