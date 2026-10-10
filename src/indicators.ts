import { ChartError } from './errors.ts';
import type { Candle, IndicatorPane, IndicatorPlugin } from './types.ts';

type RGBA = readonly [number, number, number, number];
/** An indicator with a single series and an always-present `calculate`. */
export type SeriesIndicator = IndicatorPlugin & { calculate: NonNullable<IndicatorPlugin['calculate']> };

export interface IndicatorInputSpec {
  label: string;
  default: number;
  min: number;
  max: number;
  /** Default true. */
  integer?: boolean;
}

/** A registered indicator kind. Documents store `{ kind, inputs }` and the runtime calls `create`. */
export interface IndicatorDefinition {
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly pane: IndicatorPane;
  readonly inputs: Readonly<Record<string, IndicatorInputSpec>>;
  create(inputs: Readonly<Record<string, number>>, id: string): IndicatorPlugin;
}

const BLUE: RGBA = [0.66, 0.74, 1, 0.95];
const AMBER: RGBA = [0.98, 0.72, 0.3, 0.95];
const VIOLET: RGBA = [0.75, 0.6, 1, 0.95];
const TEAL: RGBA = [0.35, 0.8, 0.78, 0.9];
const GREY: RGBA = [0.6, 0.64, 0.7, 0.55];
const MINT: RGBA = [0.45, 0.86, 0.68, 0.95];

/** Exponential moving average seeded with the SMA of the first `period` values. NaN inputs reset it. */
function emaSeries(source: readonly number[], period: number, from = 0, previous: readonly number[] = []) {
  const alpha = 2 / (period + 1);
  const values = previous.slice(0, from);
  for (let i = from; i < source.length; i++) {
    const prior = values[i - 1];
    if (Number.isFinite(prior)) values[i] = alpha * source[i] + (1 - alpha) * prior;
    else {
      // Seed once `period` finite values are available.
      let sum = 0,
        count = 0;
      for (let j = i; j >= 0 && count < period && Number.isFinite(source[j]); j--, count++) sum += source[j];
      values[i] = count === period ? sum / period : Number.NaN;
    }
  }
  return values;
}

/** Recomputes the affected suffix; last-bar updates never accumulate twice. */
export function sma(period = 20): SeriesIndicator {
  if (!Number.isInteger(period) || period < 1) throw new ChartError('INVALID_PERIOD');
  return {
    id: `sma-${period}`,
    name: `SMA ${period}`,
    kind: 'sma',
    inputs: { period },
    themeColor: 'indicator',
    color: BLUE,
    calculate(candles, previous, changedIndex) {
      const start = previous.length ? Math.max(0, Math.min(changedIndex, previous.length)) : 0;
      const values = previous.slice(0, start);
      let sum = 0;
      for (let i = Math.max(0, start - period + 1); i < start; i++) sum += candles[i].close;
      for (let i = start; i < candles.length; i++) {
        sum += candles[i].close;
        values[i] = i >= period - 1 ? sum / period : Number.NaN;
        if (i >= period - 1) sum -= candles[i - period + 1].close;
      }
      return values;
    },
  };
}

export function ema(period = 20): SeriesIndicator {
  if (!Number.isInteger(period) || period < 1) throw new ChartError('INVALID_PERIOD');
  return {
    id: `ema-${period}`,
    name: `EMA ${period}`,
    kind: 'ema',
    inputs: { period },
    themeColor: 'indicator2',
    color: AMBER,
    calculate(candles, previous, changedIndex) {
      const start = previous.length ? Math.max(0, Math.min(changedIndex, previous.length)) : 0;
      return emaSeries(
        candles.map(c => c.close),
        period,
        start,
        previous,
      );
    },
  };
}

/** Bollinger Bands: middle SMA with upper and lower bands `deviations` standard deviations away. */
export function bollinger(period = 20, deviations = 2): IndicatorPlugin {
  if (!Number.isInteger(period) || period < 2) throw new ChartError('INVALID_PERIOD');
  if (!(deviations > 0 && deviations <= 10))
    throw new ChartError('INVALID_INPUT', 'deviations must be 0 to 10');
  const series = (candles: readonly Candle[], previous: readonly (readonly number[])[], from: number) => {
    const [mid, upper, lower] = previous.map(values => values.slice(0, from));
    for (let i = from; i < candles.length; i++) {
      if (i < period - 1) {
        mid[i] = upper[i] = lower[i] = Number.NaN;
        continue;
      }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      const mean = sum / period;
      let squares = 0;
      for (let j = i - period + 1; j <= i; j++) squares += (candles[j].close - mean) ** 2;
      const deviation = Math.sqrt(squares / period) * deviations;
      mid[i] = mean;
      upper[i] = mean + deviation;
      lower[i] = mean - deviation;
    }
    return [mid, upper, lower];
  };
  return {
    id: `bb-${period}-${deviations}`,
    name: `BB ${period} ${deviations}`,
    kind: 'bb',
    inputs: { period, deviations },
    color: TEAL,
    outputs: [
      { id: 'basis', name: 'Basis', color: TEAL, themeColor: 'indicator3' },
      { id: 'upper', name: 'Upper', color: [TEAL[0], TEAL[1], TEAL[2], 0.6], themeColor: 'indicator3' },
      { id: 'lower', name: 'Lower', color: [TEAL[0], TEAL[1], TEAL[2], 0.6], themeColor: 'indicator3' },
    ],
    calculateOutputs(candles, previous, changedIndex) {
      const start = previous[0]?.length ? Math.max(0, Math.min(changedIndex, previous[0].length)) : 0;
      return series(candles, [previous[0] ?? [], previous[1] ?? [], previous[2] ?? []], start);
    },
  };
}

/** Relative Strength Index with Wilder smoothing, in its own 0 to 100 pane. */
export function rsi(period = 14): SeriesIndicator {
  if (!Number.isInteger(period) || period < 1) throw new ChartError('INVALID_PERIOD');
  return {
    id: `rsi-${period}`,
    name: `RSI ${period}`,
    kind: 'rsi',
    inputs: { period },
    pane: 'separate',
    range: { min: 0, max: 100 },
    levels: [30, 70],
    themeColor: 'indicator4',
    color: VIOLET,
    // Wilder averages depend on every earlier bar, so the series is recomputed. It is O(n).
    calculate(candles) {
      const values: number[] = new Array(candles.length).fill(Number.NaN);
      let gain = 0,
        loss = 0;
      for (let i = 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        const up = Math.max(0, change),
          down = Math.max(0, -change);
        if (i <= period) {
          gain += up / period;
          loss += down / period;
          if (i < period) continue;
        } else {
          gain = (gain * (period - 1) + up) / period;
          loss = (loss * (period - 1) + down) / period;
        }
        values[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
      }
      return values;
    },
  };
}

/** MACD line, signal line and histogram, in their own pane. */
export function macd(fast = 12, slow = 26, signal = 9): IndicatorPlugin {
  if (![fast, slow, signal].every(n => Number.isInteger(n) && n >= 1) || fast >= slow)
    throw new ChartError('INVALID_INPUT', 'MACD needs integer periods with fast below slow');
  const all = (candles: readonly Candle[]) => {
    const closes = candles.map(c => c.close);
    const fastLine = emaSeries(closes, fast),
      slowLine = emaSeries(closes, slow);
    const line = closes.map((_, i) => fastLine[i] - slowLine[i]);
    const signalLine = emaSeries(line, signal);
    return [line, signalLine, line.map((v, i) => v - signalLine[i])];
  };
  return {
    id: `macd-${fast}-${slow}-${signal}`,
    name: `MACD ${fast} ${slow} ${signal}`,
    kind: 'macd',
    inputs: { fast, slow, signal },
    pane: 'separate',
    levels: [0],
    color: BLUE,
    outputs: [
      { id: 'macd', name: 'MACD', color: BLUE, themeColor: 'indicator' },
      { id: 'signal', name: 'Signal', color: AMBER, themeColor: 'indicator2' },
      { id: 'histogram', name: 'Histogram', color: GREY, style: 'histogram' },
    ],
    calculateOutputs: candles => all(candles),
  };
}

/**
 * Cumulative volume delta as candles: each bar opens at the running total and closes after
 * adding its taker buy minus sell volume. Wicks come from `deltaRange` when the feed has
 * it. Bars without `buyVolume` add nothing; a series without any is blank.
 */
export function cvd(): IndicatorPlugin {
  return {
    id: 'cvd',
    name: 'CVD',
    kind: 'cvd',
    inputs: {},
    pane: 'separate',
    display: 'candles',
    color: MINT,
    outputs: [
      { id: 'open', name: 'Open', color: MINT },
      { id: 'high', name: 'High', color: MINT },
      { id: 'low', name: 'Low', color: MINT },
      { id: 'close', name: 'Close', color: MINT },
    ],
    calculateOutputs(candles, previous, changedIndex) {
      const done = previous[3]?.length ?? 0;
      const start = done ? Math.max(0, Math.min(changedIndex, done)) : 0;
      const [open, high, low, close] = [0, 1, 2, 3].map(k => (previous[k] ?? []).slice(0, start));
      let sum = start > 0 && Number.isFinite(close[start - 1]) ? close[start - 1] : 0;
      let seen = start > 0 && Number.isFinite(close[start - 1]);
      for (let i = start; i < candles.length; i++) {
        const { buyVolume, volume, deltaRange } = candles[i];
        if (buyVolume === undefined || !Number.isFinite(buyVolume)) {
          open[i] = high[i] = low[i] = close[i] = seen ? sum : Number.NaN;
          continue;
        }
        seen = true;
        const delta = 2 * buyVolume - volume;
        open[i] = sum;
        close[i] = sum + delta;
        high[i] = Math.max(open[i], close[i], sum + (deltaRange?.[1] ?? -Infinity));
        low[i] = Math.min(open[i], close[i], sum + (deltaRange?.[0] ?? Infinity));
        sum += delta;
      }
      return [open, high, low, close];
    },
  };
}

function checkProfile(rowHeight: number, width: number) {
  if (!(rowHeight >= 2 && rowHeight <= 40))
    throw new ChartError('INVALID_INPUT', 'row height must be 2 to 40');
  if (!(width >= 0.05 && width <= 0.5)) throw new ChartError('INVALID_INPUT', 'width must be 5 to 50%');
}

/** Visible-range volume profile with point of control and value area, against the price axis. */
export function volumeProfile(rowHeight = 5, width = 0.2, valueArea = 0.7): IndicatorPlugin {
  checkProfile(rowHeight, width);
  if (!(valueArea >= 0.1 && valueArea <= 1))
    throw new ChartError('INVALID_INPUT', 'value area must be 10 to 100%');
  return {
    id: 'vp',
    name: 'Volume profile',
    kind: 'vp',
    inputs: { rowHeight, width: Math.round(width * 100), valueArea: Math.round(valueArea * 100) },
    pane: 'profile',
    color: TEAL,
    profile: { mode: 'volume', rowHeight, width, valueArea },
  };
}

/** Buy minus sell volume at each price for the visible bars, drawn from a center line. */
export function priceDelta(rowHeight = 5, width = 0.1): IndicatorPlugin {
  checkProfile(rowHeight, width);
  return {
    id: 'price-delta',
    name: 'Price delta',
    kind: 'price-delta',
    inputs: { rowHeight, width: Math.round(width * 100) },
    pane: 'profile',
    color: MINT,
    profile: { mode: 'delta', rowHeight, width },
  };
}

const period = (fallback: number, min = 1, max = 500): IndicatorInputSpec => ({
  label: 'Period',
  default: fallback,
  min,
  max,
});

/** Built-in kinds. Hosts add more with the `indicatorDefinitions` option. */
export const builtInIndicators: readonly IndicatorDefinition[] = [
  {
    kind: 'sma',
    name: 'Simple moving average',
    description: 'Average close over the period.',
    pane: 'price',
    inputs: { period: period(20) },
    create: (inputs, id) => ({ ...sma(inputs.period), id }),
  },
  {
    kind: 'ema',
    name: 'Exponential moving average',
    description: 'Moving average that weights recent closes more.',
    pane: 'price',
    inputs: { period: period(20) },
    create: (inputs, id) => ({ ...ema(inputs.period), id }),
  },
  {
    kind: 'bb',
    name: 'Bollinger Bands',
    description: 'SMA with bands at a multiple of the standard deviation.',
    pane: 'price',
    inputs: {
      period: period(20, 2),
      deviations: { label: 'Deviations', default: 2, min: 0.5, max: 5, integer: false },
    },
    create: (inputs, id) => ({ ...bollinger(inputs.period, inputs.deviations), id }),
  },
  {
    kind: 'rsi',
    name: 'Relative strength index',
    description: 'Momentum from 0 to 100; 70 and 30 mark overbought and oversold.',
    pane: 'separate',
    inputs: { period: period(14, 2) },
    create: (inputs, id) => ({ ...rsi(inputs.period), id }),
  },
  {
    kind: 'macd',
    name: 'MACD',
    description: 'Difference of two EMAs, its signal line and their histogram.',
    pane: 'separate',
    inputs: {
      fast: { label: 'Fast', default: 12, min: 1, max: 200 },
      slow: { label: 'Slow', default: 26, min: 2, max: 400 },
      signal: { label: 'Signal', default: 9, min: 1, max: 200 },
    },
    create: (inputs, id) => ({ ...macd(inputs.fast, inputs.slow, inputs.signal), id }),
  },
  {
    kind: 'cvd',
    name: 'Cumulative volume delta',
    description: 'Running total of taker buy minus sell volume. Needs buy volume from the feed.',
    pane: 'separate',
    inputs: {},
    create: (_, id) => ({ ...cvd(), id }),
  },
  {
    kind: 'vp',
    name: 'Volume profile',
    description: 'Buy and sell volume at each price for the visible bars, with POC and value area.',
    pane: 'profile',
    inputs: {
      rowHeight: { label: 'Row px', default: 5, min: 2, max: 40 },
      width: { label: 'Width %', default: 20, min: 5, max: 50 },
      valueArea: { label: 'Value area %', default: 70, min: 10, max: 100 },
    },
    create: (inputs, id) => ({
      ...volumeProfile(inputs.rowHeight, inputs.width / 100, inputs.valueArea / 100),
      id,
    }),
  },
  {
    kind: 'price-delta',
    name: 'Price delta',
    description: 'Buy minus sell volume at each price for the visible bars.',
    pane: 'profile',
    inputs: {
      rowHeight: { label: 'Row px', default: 5, min: 2, max: 40 },
      width: { label: 'Width %', default: 10, min: 5, max: 50 },
    },
    create: (inputs, id) => ({ ...priceDelta(inputs.rowHeight, inputs.width / 100), id }),
  },
];

export class IndicatorRegistry {
  private definitions = new Map<string, IndicatorDefinition>();

  constructor(extra: readonly IndicatorDefinition[] = []) {
    for (const definition of [...builtInIndicators, ...extra]) {
      if (
        !definition ||
        typeof definition.kind !== 'string' ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(definition.kind) ||
        typeof definition.create !== 'function' ||
        !['price', 'separate', 'profile'].includes(definition.pane)
      )
        throw new ChartError('INVALID_INDICATOR_DEFINITION', undefined, {
          details: { kind: definition?.kind },
        });
      if (this.definitions.has(definition.kind))
        throw new ChartError('DUPLICATE_INDICATOR_DEFINITION', undefined, {
          details: { kind: definition.kind },
        });
      this.definitions.set(definition.kind, definition);
    }
  }

  get(kind: string): IndicatorDefinition | undefined {
    return this.definitions.get(kind);
  }

  list(): readonly IndicatorDefinition[] {
    return [...this.definitions.values()];
  }

  /** Fills defaults and validates ranges. Throws `INVALID_INDICATOR_INPUT` with the input path. */
  inputs(kind: string, given: unknown = {}): Record<string, number> {
    const definition = this.definitions.get(kind);
    if (!definition)
      throw new ChartError('UNKNOWN_INDICATOR', undefined, { path: 'kind', details: { kind } });
    if (!given || typeof given !== 'object' || Array.isArray(given))
      throw new ChartError('INVALID_INDICATOR_INPUT', 'inputs must be an object', { path: 'inputs' });
    const values = given as Record<string, unknown>;
    for (const key of Object.keys(values))
      if (!Object.hasOwn(definition.inputs, key))
        throw new ChartError('INVALID_INDICATOR_INPUT', `unknown input ${key}`, {
          path: `inputs.${key}`,
          details: { allowed: Object.keys(definition.inputs) },
        });
    const result: Record<string, number> = {};
    for (const [key, spec] of Object.entries(definition.inputs)) {
      const value = values[key] ?? spec.default;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < spec.min ||
        value > spec.max ||
        (spec.integer !== false && !Number.isInteger(value))
      )
        throw new ChartError(
          'INVALID_INDICATOR_INPUT',
          `${key} must be ${spec.integer !== false ? 'an integer ' : ''}from ${spec.min} to ${spec.max}`,
          {
            path: `inputs.${key}`,
            details: { value, min: spec.min, max: spec.max, integer: spec.integer !== false },
          },
        );
      result[key] = value;
    }
    return result;
  }

  create(kind: string, inputs: unknown, id: string): IndicatorPlugin {
    const definition = this.definitions.get(kind);
    if (!definition)
      throw new ChartError('UNKNOWN_INDICATOR', undefined, { path: 'kind', details: { kind } });
    const plugin = definition.create(this.inputs(kind, inputs), id);
    return { ...plugin, id, kind, inputs: this.inputs(kind, inputs) };
  }
}
