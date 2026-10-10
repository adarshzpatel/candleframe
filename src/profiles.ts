import type { Candle } from './types.ts';

/** One price row of a profile. `low` is inclusive, `high` exclusive. */
export interface ProfileRow {
  low: number;
  high: number;
  buy: number;
  sell: number;
}
export interface PriceProfile {
  /** Ascending by price. Rows share one height, `step`. */
  rows: ProfileRow[];
  step: number;
  /** Row with the most volume (point of control), or -1 without volume. */
  poc: number;
  /** Inclusive row range holding the value-area share of volume, or null without volume. */
  valueArea: { low: number; high: number } | null;
  maxVolume: number;
  /** Largest absolute buy minus sell in one row. */
  maxDelta: number;
  buy: number;
  sell: number;
}

const MAX_ROWS = 4000;

/** The smallest 1, 2, 2.5 or 5 times a power of ten at or above `raw`. */
export function profileStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw * (1 - 1e-9)) return m * power;
  return 10 * power;
}

/**
 * Volume at price for `candles[start..end)`. Candles with a `footprint` contribute each
 * bucket. Others spread their volume evenly from low to high, split by `buyVolume`, or
 * evenly when it is missing. Rows sit on multiples of `step`, so panning keeps them still.
 */
export function buildProfile(
  candles: readonly Candle[],
  start: number,
  end: number,
  step: number,
  valueAreaShare = 0.7,
): PriceProfile {
  let low = Infinity,
    high = -Infinity;
  for (let i = start; i < end; i++) {
    low = Math.min(low, candles[i].low);
    high = Math.max(high, candles[i].high);
  }
  const empty: PriceProfile = {
    rows: [],
    step,
    poc: -1,
    valueArea: null,
    maxVolume: 0,
    maxDelta: 0,
    buy: 0,
    sell: 0,
  };
  if (!Number.isFinite(low) || !(step > 0)) return empty;
  // Zoomed far into a wide range: coarsen rather than allocate without bound.
  while ((high - low) / step > MAX_ROWS) step = profileStep(step * 2);
  const base = Math.floor(low / step) * step;
  const count = Math.max(1, Math.floor((high - base) / step) + 1);
  const buy = new Float64Array(count),
    sell = new Float64Array(count);
  const row = (price: number) => Math.max(0, Math.min(count - 1, Math.floor((price - base) / step)));
  /** Spreads volume uniformly over [from, to); a zero-width span lands in one row. */
  const spread = (from: number, to: number, b: number, s: number) => {
    if (!(b + s > 0)) return;
    const first = row(from),
      last = row(Math.max(from, to - step * 1e-9));
    if (first === last || to <= from) {
      buy[first] += b;
      sell[first] += s;
      return;
    }
    const width = to - from;
    for (let r = first; r <= last; r++) {
      const lo = Math.max(from, base + r * step),
        hi = Math.min(to, base + (r + 1) * step);
      const share = Math.max(0, hi - lo) / width;
      buy[r] += b * share;
      sell[r] += s * share;
    }
  };
  for (let i = start; i < end; i++) {
    const bar = candles[i];
    const levels = bar.footprint;
    if (levels?.length) {
      let bucket = Infinity;
      for (let k = 1; k < levels.length; k++) bucket = Math.min(bucket, levels[k][0] - levels[k - 1][0]);
      if (!Number.isFinite(bucket) || bucket <= 0) bucket = 0;
      for (const [price, b, s] of levels)
        if (Number.isFinite(price) && b >= 0 && s >= 0) spread(price, price + bucket, b, s);
      continue;
    }
    const total = bar.volume;
    const b =
      bar.buyVolume !== undefined && Number.isFinite(bar.buyVolume)
        ? Math.max(0, Math.min(total, bar.buyVolume))
        : total / 2;
    spread(bar.low, bar.high, b, total - b);
  }
  const rows: ProfileRow[] = [];
  let poc = -1,
    maxVolume = 0,
    maxDelta = 0,
    totalBuy = 0,
    totalSell = 0;
  for (let r = 0; r < count; r++) {
    const volume = buy[r] + sell[r];
    rows.push({ low: base + r * step, high: base + (r + 1) * step, buy: buy[r], sell: sell[r] });
    if (volume > maxVolume) {
      maxVolume = volume;
      poc = r;
    }
    maxDelta = Math.max(maxDelta, Math.abs(buy[r] - sell[r]));
    totalBuy += buy[r];
    totalSell += sell[r];
  }
  if (poc < 0) return { ...empty, rows, step };
  // Grow from the point of control toward the heavier neighbour until the share is covered.
  const target = (totalBuy + totalSell) * Math.max(0, Math.min(1, valueAreaShare));
  const volumeAt = (r: number) => (r >= 0 && r < count ? buy[r] + sell[r] : -1);
  let lo = poc,
    hi = poc,
    covered = volumeAt(poc);
  while (covered < target && (lo > 0 || hi < count - 1)) {
    const below = volumeAt(lo - 1),
      above = volumeAt(hi + 1);
    if (above >= below) covered += volumeAt(++hi);
    else covered += volumeAt(--lo);
  }
  return {
    rows,
    step,
    poc,
    valueArea: { low: lo, high: hi },
    maxVolume,
    maxDelta,
    buy: totalBuy,
    sell: totalSell,
  };
}
