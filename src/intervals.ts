import { ChartError } from './errors.ts';

export type IntervalUnit = 's' | 'm' | 'h' | 'd' | 'w';
/** A fixed-length candle interval such as `1m`, `4h`, `1d` or `1w`. Calendar months are not supported. */
export type Interval = `${number}${IntervalUnit}`;

const UNIT_MS: Readonly<Record<IntervalUnit, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
/** 1970-01-05, the first Monday. Weekly candles open on Monday 00:00 UTC, as most exchanges do. */
const WEEK_ORIGIN_MS = 4 * UNIT_MS.d;

/** Returns the interval length, or throws `UNSUPPORTED_INTERVAL`. */
export function intervalToMs(interval: unknown): number {
  const match = typeof interval === 'string' ? /^([1-9]\d{0,3})([smhdw])$/.exec(interval) : null;
  if (!match)
    throw new ChartError('UNSUPPORTED_INTERVAL', 'use a count and unit such as 1m, 4h, 1d or 1w', {
      path: 'interval',
      details: { interval },
    });
  return Number(match[1]) * UNIT_MS[match[2] as IntervalUnit];
}

export function isInterval(value: unknown): value is Interval {
  try {
    intervalToMs(value);
    return true;
  } catch {
    return false;
  }
}

/** Candle boundaries are multiples of the interval from this origin. */
export function intervalOrigin(intervalMs: number): number {
  return intervalMs % UNIT_MS.w === 0 ? WEEK_ORIGIN_MS : 0;
}

/** Floors a timestamp to the start of its candle. */
export function alignTime(timeMs: number, intervalMs: number): number {
  const origin = intervalOrigin(intervalMs);
  return Math.floor((timeMs - origin) / intervalMs) * intervalMs + origin;
}

export function isAligned(timeMs: number, intervalMs: number): boolean {
  return (timeMs - intervalOrigin(intervalMs)) % intervalMs === 0;
}
