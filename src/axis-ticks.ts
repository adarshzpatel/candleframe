import type { ChartGeometry } from './geometry.ts';
import type { Candle } from './types.ts';

/** One axis mark: its value, its pixel position on the axis and its label. */
export interface AxisTick {
  value: number;
  position: number;
  label: string;
  /** Larger units rank higher (a new day outranks an hour). Time ticks only. */
  rank: number;
}

/** A step of 1, 2, 2.5 or 5 times a power of ten, giving about `count` intervals over `span`. */
export function niceStep(span: number, count: number): number {
  const raw = Math.abs(span) / Math.max(1, count);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Round values between `min` and `max`, mapped to pixels by `toPixel`. */
export function valueTicks(
  min: number,
  max: number,
  pixels: number,
  toPixel: (value: number) => number,
  format: (value: number) => string,
  spacing = 48,
): AxisTick[] {
  const step = niceStep(max - min, Math.max(1, Math.floor(pixels / spacing)));
  const ticks: AxisTick[] = [];
  // Snap to the step's decimal places so 0.1 + 0.2 never labels as 0.30000000000000004.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    const rounded = Number(value.toFixed(decimals));
    ticks.push({ value: rounded, position: toPixel(rounded), label: format(rounded), rank: 0 });
    if (ticks.length > 200) break;
  }
  return ticks;
}

/** Price-axis ticks. Log axes spanning more than 3x use 1, 2 and 5 times powers of ten. */
export function priceTicks(g: ChartGeometry, format: (price: number) => string, spacing = 48): AxisTick[] {
  // A narrow log range is nearly linear: round values, placed by the log mapping.
  if (!g.log || g.maxPrice / g.minPrice < 3)
    return valueTicks(g.minPrice, g.maxPrice, g.plotHeight, g.y, format, spacing);
  const ticks: AxisTick[] = [];
  let last = Infinity;
  for (let power = Math.floor(Math.log10(g.minPrice)); 10 ** power <= g.maxPrice; power++)
    for (const multiple of [1, 2, 5]) {
      const value = Number((multiple * 10 ** power).toPrecision(12));
      if (value < g.minPrice || value > g.maxPrice) continue;
      const position = g.y(value);
      // Skip marks that would crowd the previous one; prices ascend, so y descends.
      if (last - position < spacing * 0.6) continue;
      ticks.push({ value, position, label: format(value), rank: multiple === 1 ? 1 : 0 });
      last = position;
    }
  return ticks;
}

const SECOND = 1000,
  MINUTE = 60 * SECOND,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR;
/** Rank of the largest calendar unit a tick starts. */
export const TICK_RANK = { second: 0, minute: 1, hour: 2, day: 3, month: 4, year: 5 } as const;

type Step =
  | { kind: 'clock'; ms: number }
  | { kind: 'day'; days: number }
  | { kind: 'month'; months: number }
  | { kind: 'year'; years: number };
const STEPS: readonly Step[] = [
  ...[1, 5, 10, 15, 30].map(s => ({ kind: 'clock' as const, ms: s * SECOND })),
  ...[1, 2, 5, 10, 15, 30].map(m => ({ kind: 'clock' as const, ms: m * MINUTE })),
  ...[1, 2, 3, 4, 6, 12].map(h => ({ kind: 'clock' as const, ms: h * HOUR })),
  ...[1, 2, 5, 10, 15].map(days => ({ kind: 'day' as const, days })),
  ...[1, 3, 6].map(months => ({ kind: 'month' as const, months })),
  ...[1, 2, 5, 10, 25, 50].map(years => ({ kind: 'year' as const, years })),
];
const stepMs = (step: Step) =>
  step.kind === 'clock'
    ? step.ms
    : step.kind === 'day'
      ? step.days * DAY
      : step.kind === 'month'
        ? step.months * 30.44 * DAY
        : step.years * 365.25 * DAY;

/** Offset of a time zone from UTC at a given instant, cached per hour. */
export function zoneOffsets(timeZone: string): (timeMs: number) => number {
  if (timeZone === 'UTC') return () => 0;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const cache = new Map<number, number>();
  return timeMs => {
    const hour = Math.floor(timeMs / HOUR);
    let offset = cache.get(hour);
    if (offset === undefined) {
      const at = hour * HOUR;
      const parts = Object.fromEntries(format.formatToParts(at).map(p => [p.type, Number(p.value)]));
      offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at;
      if (cache.size > 5000) cache.clear();
      cache.set(hour, offset);
    }
    return offset;
  };
}

export interface TimeTickOptions {
  candles: readonly Candle[];
  intervalMs: number;
  offset: (timeMs: number) => number;
  /** Labels a tick; `rank` says which unit it starts (see TICK_RANK). */
  label: (timeMs: number, rank: number) => string;
  /** Minimum distance between labels, in pixels. */
  spacing: number;
}

/**
 * Time-axis ticks on calendar boundaries in the label time zone. Walks the bar slots
 * in view, so session gaps never get a tick of their own; a tick lands on the first
 * bar of each bucket. Crowded ticks give way to higher-ranked ones.
 */
export function timeTicks(g: ChartGeometry, options: TimeTickOptions): AxisTick[] {
  const { candles, intervalMs, offset, label, spacing } = options;
  if (!(g.barSpacing > 0) || !Number.isFinite(g.barSpacing)) return [];
  const pxPerMs = g.barSpacing / intervalMs;
  const step = STEPS.find(s => stepMs(s) >= intervalMs && stepMs(s) * pxPerMs >= spacing) ?? STEPS.at(-1)!;
  const scale = g.timeScale;
  const first = Math.floor(scale.logical(g.fromMs)) - 1,
    last = Math.ceil(scale.logical(g.toMs)) + 1;
  if (last - first > 20_000) return [];
  // On a gapped scale slot i is loaded bar i; elsewhere the scale gives the slot's time.
  const slotTime = (slot: number) =>
    !scale.linear && slot >= 0 && slot < candles.length ? candles[slot].timeMs : scale.time(slot);
  const bucket = (local: Date): number => {
    const y = local.getUTCFullYear(),
      m = local.getUTCMonth(),
      d = local.getUTCDate();
    switch (step.kind) {
      case 'clock':
        return Math.floor(local.getTime() / step.ms);
      case 'day':
        // Day-of-month buckets restart each month, like 1, 5, 10, 15 ...
        return (y * 12 + m) * 32 + Math.floor((d - 1) / step.days);
      case 'month':
        return y * 12 + Math.floor(m / step.months) * step.months;
      case 'year':
        return Math.floor(y / step.years);
    }
  };
  const rankOf = (local: Date, previous: Date | null): number => {
    if (!previous) return 0;
    if (local.getUTCFullYear() !== previous.getUTCFullYear()) return TICK_RANK.year;
    if (local.getUTCMonth() !== previous.getUTCMonth()) return TICK_RANK.month;
    if (local.getUTCDate() !== previous.getUTCDate()) return TICK_RANK.day;
    if (local.getUTCHours() !== previous.getUTCHours()) return TICK_RANK.hour;
    if (local.getUTCMinutes() !== previous.getUTCMinutes()) return TICK_RANK.minute;
    return TICK_RANK.second;
  };
  const candidates: AxisTick[] = [];
  let previous: Date | null = null,
    previousBucket = NaN;
  for (let slot = first; slot <= last; slot++) {
    const time = slotTime(slot);
    const local = new Date(time + offset(time));
    const key = bucket(local);
    // The first slot only seeds the comparison; a tick needs a boundary inside the view.
    if (previous && key !== previousBucket) {
      const position = g.x(time);
      if (position >= g.left - 1 && position <= g.left + g.plotWidth + 1) {
        const rank = Math.max(rankOf(local, previous), step.kind === 'clock' ? 0 : TICK_RANK.day);
        candidates.push({ value: time, position, label: label(time, rank), rank });
      }
    }
    previous = local;
    previousBucket = key;
  }
  // Keep higher-ranked ticks first, then fill in lower ones where they fit.
  const kept: AxisTick[] = [];
  for (const tick of [...candidates].sort((a, b) => b.rank - a.rank || a.position - b.position))
    if (kept.every(other => Math.abs(other.position - tick.position) >= spacing)) kept.push(tick);
  return kept.sort((a, b) => a.position - b.position);
}
