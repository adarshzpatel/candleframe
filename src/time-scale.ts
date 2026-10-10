import type { Candle } from './types.ts';

/**
 * Maps time to a logical bar position. Continuous feeds are linear in time.
 * Feeds with session gaps place each loaded bar one unit apart, so nights,
 * weekends and holidays take no horizontal space.
 */
export interface TimeScale {
  /** Bar position; the first loaded bar starts at 0. Times inside a gap map to the next bar. */
  logical(timeMs: number): number;
  /** Inverse of `logical`. Outside loaded data, extrapolates by the interval. */
  time(logical: number): number;
  /** Number of bar slots between two times. */
  bars(fromMs: number, toMs: number): number;
  /** True when positions are linear in time (no collapsed gaps). */
  readonly linear: boolean;
}

export function createTimeScale(candles: readonly Candle[], intervalMs: number, gaps = false): TimeScale {
  const origin = candles[0]?.timeMs ?? 0;
  if (!gaps || candles.length < 2) {
    return {
      logical: timeMs => (timeMs - origin) / intervalMs,
      time: logical => origin + logical * intervalMs,
      bars: (fromMs, toMs) => (toMs - fromMs) / intervalMs,
      linear: true,
    };
  }
  const last = candles.length - 1;
  const lastMs = candles[last].timeMs;
  const logical = (timeMs: number): number => {
    if (timeMs <= origin) return (timeMs - origin) / intervalMs;
    if (timeMs >= lastMs) return last + (timeMs - lastMs) / intervalMs;
    let lo = 0,
      hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (candles[mid].timeMs <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    return lo + Math.min(1, (timeMs - candles[lo].timeMs) / intervalMs);
  };
  const time = (position: number): number => {
    if (position <= 0) return origin + position * intervalMs;
    if (position >= last) return lastMs + (position - last) * intervalMs;
    const index = Math.floor(position);
    return candles[index].timeMs + (position - index) * intervalMs;
  };
  return { logical, time, bars: (fromMs, toMs) => logical(toMs) - logical(fromMs), linear: false };
}
