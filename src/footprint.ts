import { ChartError } from './errors.ts';
import type { Candle, ChartDocument, FootprintMode, FootprintOptions } from './types.ts';

export const FOOTPRINT_MODES: readonly FootprintMode[] = ['bidAsk', 'delta', 'volume'];
export const FOOTPRINT_DEFAULTS: Readonly<FootprintOptions> = Object.freeze({
  mode: 'bidAsk',
  imbalance: true,
  poc: true,
  summary: true,
});
/** Narrower bars draw as candles: cells would be unreadable. */
export const FOOTPRINT_MIN_SPACING = 28;
/** True when bars that carry levels draw as footprints at this zoom. */
export function footprintShown(document: Pick<ChartDocument, 'chartType'>, barSpacing: number): boolean {
  return document.chartType === 'footprint' && barSpacing >= FOOTPRINT_MIN_SPACING;
}
/** One side must trade this many times the diagonal opposite side to count as an imbalance. */
export const IMBALANCE_RATIO = 3;

/** Defaults merged with `value`; throws on unknown keys or wrong types. */
export function footprintOptions(
  value: unknown,
  base: Readonly<FootprintOptions> = FOOTPRINT_DEFAULTS,
  path = 'footprint',
): FootprintOptions {
  if (value === undefined) return { ...base };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ChartError('INVALID_FOOTPRINT', 'footprint must be an object', { path });
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(key in FOOTPRINT_DEFAULTS))
      throw new ChartError('INVALID_FOOTPRINT', `unknown option ${key}`, { path: `${path}.${key}` });
    const valid =
      key === 'mode'
        ? FOOTPRINT_MODES.includes(input[key] as FootprintMode)
        : typeof input[key] === 'boolean';
    if (!valid)
      throw new ChartError(
        'INVALID_FOOTPRINT',
        key === 'mode' ? `mode must be one of ${FOOTPRINT_MODES.join(', ')}` : `${key} must be a boolean`,
        { path: `${path}.${key}` },
      );
  }
  return { ...base, ...(input as Partial<FootprintOptions>) };
}

export interface FootprintRow {
  /** Low edge of the row. */
  price: number;
  buy: number;
  sell: number;
  /** Buy volume beats the sell volume one row below by `IMBALANCE_RATIO`. */
  buyImbalance: boolean;
  /** Sell volume beats the buy volume one row above by `IMBALANCE_RATIO`. */
  sellImbalance: boolean;
}
export interface FootprintBar {
  /** Contiguous rows, ascending; rows inside the bar with no trades are zero. */
  rows: FootprintRow[];
  /** Index of the heaviest row, or -1 for an empty bar. */
  poc: number;
  buy: number;
  sell: number;
  maxVolume: number;
  maxDelta: number;
  /** Largest single side in any row, for bid × ask shading. */
  maxSide: number;
}

/**
 * The feed's bucket width: the smallest gap between neighbouring levels in the bars,
 * snapped to the tick size. Falls back to the tick size for single-level bars.
 */
export function footprintBucket(
  candles: readonly Candle[],
  start: number,
  end: number,
  tickSize: number,
): number {
  let gap = Infinity;
  for (let i = Math.max(0, start); i < Math.min(end, candles.length); i++) {
    const levels = candles[i].footprint;
    if (!levels) continue;
    for (let j = 1; j < levels.length; j++) {
      const d = levels[j][0] - levels[j - 1][0];
      if (d > 0 && d < gap) gap = d;
    }
  }
  if (!Number.isFinite(gap)) return tickSize;
  return Math.max(tickSize, Math.round(gap / tickSize) * tickSize);
}

/**
 * Groups a bar's levels into rows `bucket * group` wide. Rows sit on multiples of the
 * row size, so neighbouring bars line up and panning keeps them still.
 */
export function footprintBar(
  levels: Candle['footprint'],
  bucket: number,
  group = 1,
  ratio = IMBALANCE_RATIO,
): FootprintBar {
  const bar: FootprintBar = { rows: [], poc: -1, buy: 0, sell: 0, maxVolume: 0, maxDelta: 0, maxSide: 0 };
  if (!levels?.length || !(bucket > 0)) return bar;
  const size = Math.max(1, Math.round(group));
  const rowOf = (price: number) => Math.floor(Math.round(price / bucket) / size);
  const first = rowOf(levels[0][0]),
    last = rowOf(levels[levels.length - 1][0]);
  for (let r = first; r <= last; r++)
    bar.rows.push({ price: r * size * bucket, buy: 0, sell: 0, buyImbalance: false, sellImbalance: false });
  for (const [price, buy, sell] of levels) {
    const row = bar.rows[rowOf(price) - first];
    if (!row) continue;
    row.buy += buy;
    row.sell += sell;
    bar.buy += buy;
    bar.sell += sell;
  }
  bar.rows.forEach((row, i) => {
    const volume = row.buy + row.sell;
    if (volume > bar.maxVolume) {
      bar.maxVolume = volume;
      bar.poc = i;
    }
    bar.maxDelta = Math.max(bar.maxDelta, Math.abs(row.buy - row.sell));
    bar.maxSide = Math.max(bar.maxSide, row.buy, row.sell);
    // Diagonal comparison: buyers lift the offer one row above where sellers hit the bid.
    const below = bar.rows[i - 1],
      above = bar.rows[i + 1];
    if (below && below.sell > 0 && row.buy >= ratio * below.sell) row.buyImbalance = true;
    if (above && above.buy > 0 && row.sell >= ratio * above.buy) row.sellImbalance = true;
  });
  return bar;
}

/**
 * Formats every cell in a bar with the same decimals, chosen so its largest value keeps
 * `digits` significant digits. Values under one drop the leading zero to fit narrow cells.
 */
export function cellFormat(max: number, digits = 3): (value: number, signed?: boolean) => string {
  if (max >= 10000) {
    const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: digits });
    return (value, signed) => (signed && value > 0 ? '+' : '') + compact.format(value);
  }
  const decimals = max > 0 ? Math.min(3, Math.max(0, digits - 1 - Math.floor(Math.log10(max)))) : 0;
  return (value, signed) => {
    if (!value) return '0';
    const text = Math.abs(value)
      .toFixed(decimals)
      .replace(/^0(?=\.)/, '');
    return (value < 0 ? '-' : signed ? '+' : '') + text;
  };
}
