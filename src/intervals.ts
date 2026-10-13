import { ChartError } from './errors.ts';

export type TimeIntervalUnit = 's' | 'm' | 'h' | 'd' | 'w';
/**
 * `t`: a bar every N trades. `r`: a bar spanning at most N price increments (tick sizes).
 * `mr`: momentum range, a bar that closes N increments from its open, where the next opens.
 */
export type TradeIntervalUnit = 't' | 'r' | 'mr';
export type IntervalUnit = TimeIntervalUnit | TradeIntervalUnit;
/**
 * A candle interval: fixed-length time such as `1m`, `4h`, `1d` or `1w` (calendar months
 * are not supported), `500t` for 500-trade bars or `10r` for 10-tick range bars.
 */
export type Interval = `${number}${IntervalUnit}`;

/**
 * Nominal slot width of tick and range bars. Their bars start at irregular times, so
 * feeds must declare `gaps` and give every bar a whole-millisecond time at least this
 * far after the previous one.
 */
export const TRADE_BAR_SLOT_MS = 1;

const UNIT_MS: Readonly<Record<TimeIntervalUnit, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
/** 1970-01-05, the first Monday. Weekly candles open on Monday 00:00 UTC, as most exchanges do. */
const WEEK_ORIGIN_MS = 4 * UNIT_MS.d;

export type IntervalSpec =
  | { kind: 'time'; ms: number }
  | { kind: 'tick'; count: number }
  | { kind: 'range'; ticks: number }
  | { kind: 'momentum'; ticks: number };

/** Parses an interval, or throws `UNSUPPORTED_INTERVAL`. */
export function parseInterval(interval: unknown): IntervalSpec {
  const match =
    typeof interval === 'string'
      ? (/^([1-9]\d{0,3})([smhdw])$/.exec(interval) ?? /^([1-9]\d{0,5})(t|r|mr)$/.exec(interval))
      : null;
  if (!match)
    throw new ChartError(
      'UNSUPPORTED_INTERVAL',
      'use a count and unit such as 1m, 4h, 1d, 500t, 10r or 10mr',
      {
        path: 'interval',
        details: { interval },
      },
    );
  const count = Number(match[1]);
  if (match[2] === 't') return { kind: 'tick', count };
  if (match[2] === 'r') return { kind: 'range', ticks: count };
  if (match[2] === 'mr') return { kind: 'momentum', ticks: count };
  return { kind: 'time', ms: count * UNIT_MS[match[2] as TimeIntervalUnit] };
}

/**
 * Returns the interval length, or throws `UNSUPPORTED_INTERVAL`. Tick and range bars
 * have no fixed length and return the nominal `TRADE_BAR_SLOT_MS`.
 */
export function intervalToMs(interval: unknown): number {
  const spec = parseInterval(interval);
  return spec.kind === 'time' ? spec.ms : TRADE_BAR_SLOT_MS;
}

/** True for fixed-length time intervals; false for tick and range bars. */
export function isTimeInterval(interval: unknown): boolean {
  try {
    return parseInterval(interval).kind === 'time';
  } catch {
    return false;
  }
}

/** Picker label: `1m` stays as is; `500t` reads "500 ticks" and `10r` "10 range". */
export function intervalLabel(interval: Interval): string {
  const spec = parseInterval(interval);
  if (spec.kind === 'tick') return `${spec.count} ticks`;
  if (spec.kind === 'range') return `${spec.ticks} range`;
  if (spec.kind === 'momentum') return `${spec.ticks} momentum`;
  return interval;
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
