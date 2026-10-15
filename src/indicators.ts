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
  /** An on/off switch stored as 0 or 1; `min` 0 and `max` 1. */
  toggle?: boolean;
  /** Named choices stored as their index; `min` 0 and `max` the last index. */
  options?: readonly string[];
}

/** A registered indicator kind. Documents store `{ kind, inputs }` and the runtime calls `create`. */
export interface IndicatorDefinition {
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly pane: IndicatorPane;
  readonly inputs: Readonly<Record<string, IndicatorInputSpec>>;
  /** Left out of the add list; documents that use it still load. */
  readonly hidden?: boolean;
  create(inputs: Readonly<Record<string, number>>, id: string): IndicatorPlugin;
}

const BLUE: RGBA = [0.66, 0.74, 1, 0.95];
const AMBER: RGBA = [0.98, 0.72, 0.3, 0.95];
const VIOLET: RGBA = [0.75, 0.6, 1, 0.95];
const TEAL: RGBA = [0.35, 0.8, 0.78, 0.9];
const GREY: RGBA = [0.6, 0.64, 0.7, 0.55];
const MINT: RGBA = [0.45, 0.86, 0.68, 0.95];
const RED: RGBA = [0.96, 0.42, 0.45, 0.95];

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

/** Wilder average true range; NaN until `period` true ranges exist. */
function atrSeries(candles: readonly Candle[], period: number) {
  const values: number[] = new Array(candles.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i],
      prior = candles[i - 1].close;
    const range = Math.max(high - low, Math.abs(high - prior), Math.abs(low - prior));
    if (i <= period) {
      sum += range / period;
      if (i === period) values[i] = sum;
    } else values[i] = sum = (sum * (period - 1) + range) / period;
  }
  return values;
}

export type Regime = 'compression' | 'rotation' | 'long' | 'short';
const REGIMES: readonly Regime[] = ['compression', 'rotation', 'long', 'short'];

/**
 * Classifies each bar. Readings, with `quick` = half of `period`:
 * - volatility ratio: EMA of true range over `quick` bars divided by Wilder ATR over
 *   `slowPeriod`
 * - quick and steady efficiency: net close change divided by the sum of bar-to-bar close
 *   changes, over `quick` and over `period` bars, 0 to 1
 * - breakout: a close half a quick ATR beyond the high or low of the prior `period` bars,
 *   on a bar at least as wide as the quick ATR, with quick efficiency at half of `entry`
 *
 * In order: a breakout starts expansion. A volatility ratio at or below `squeeze` is
 * compression (held until it clears `squeeze` by 15%). Expansion holds while steady
 * efficiency stays at `hold` in its direction and price stays on its side of the range
 * midpoint. Quick efficiency at `entry` starts expansion, long or short by the net change.
 * Everything else is rotation. Every regime lasts at least two bars. Bars before the
 * readings exist are null.
 */
export function classifyRegimes(
  candles: readonly Candle[],
  period = 20,
  slowPeriod = 100,
  entry = 0.65,
  hold = 0.35,
  squeeze = 0.8,
): (Regime | null)[] {
  const quick = Math.max(2, Math.round(period / 2));
  const ranges = candles.map((bar, i) =>
    i === 0
      ? Number.NaN
      : Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - candles[i - 1].close),
          Math.abs(bar.low - candles[i - 1].close),
        ),
  );
  const fast = emaSeries(ranges, quick),
    slow = atrSeries(candles, slowPeriod);
  const moves = candles.map((bar, i) => (i === 0 ? 0 : Math.abs(bar.close - candles[i - 1].close)));
  const efficiency = (i: number, n: number, path: number) =>
    path > 0 ? Math.abs(candles[i].close - candles[i - n].close) / path : 0;
  const result: (Regime | null)[] = new Array(candles.length).fill(null);
  let quickPath = 0,
    steadyPath = 0,
    current: Regime | null = null,
    held = 0;
  for (let i = 1; i < candles.length; i++) {
    quickPath += moves[i] - (i > quick ? moves[i - quick] : 0);
    steadyPath += moves[i] - (i > period ? moves[i - period] : 0);
    if (i < period || !Number.isFinite(fast[i - 1]) || !Number.isFinite(slow[i])) continue;
    let high = -Infinity,
      low = Infinity;
    for (let j = i - period; j < i; j++) {
      high = Math.max(high, candles[j].high);
      low = Math.min(low, candles[j].low);
    }
    const close = candles[i].close,
      atr = fast[i - 1];
    const quickNet = close - candles[i - quick].close,
      steadyNet = close - candles[i - period].close;
    const quickEfficiency = efficiency(i, quick, quickPath),
      steadyEfficiency = efficiency(i, period, steadyPath);
    const volatility = slow[i] > 0 ? fast[i] / slow[i] : 1;
    const thrust = ranges[i] >= atr && quickEfficiency >= entry / 2;
    let next: Regime;
    if (thrust && close > high + atr / 2) next = 'long';
    else if (thrust && close < low - atr / 2) next = 'short';
    else if (volatility <= (current === 'compression' ? squeeze * 1.15 : squeeze)) next = 'compression';
    else if (
      (current === 'long' && steadyEfficiency >= hold && steadyNet > 0 && close > (high + low) / 2) ||
      (current === 'short' && steadyEfficiency >= hold && steadyNet < 0 && close < (high + low) / 2)
    )
      next = current;
    else if (quickEfficiency >= entry) next = quickNet >= 0 ? 'long' : 'short';
    else next = 'rotation';
    if (current === null || (next !== current && held >= 2)) {
      current = next;
      held = 0;
    }
    held++;
    result[i] = current;
  }
  return result;
}

function checkRegime(
  period: number,
  slowPeriod: number,
  entryPercent: number,
  holdPercent: number,
  squeezePercent: number,
) {
  if (!(Number.isInteger(period) && period >= 2 && period <= 500))
    throw new ChartError('INVALID_INPUT', 'period must be 2 to 500 bars');
  if (!(Number.isInteger(slowPeriod) && slowPeriod > period && slowPeriod <= 2000))
    throw new ChartError('INVALID_INPUT', 'slow period must be above period and at most 2000');
  if (![entryPercent, holdPercent].every(p => p >= 1 && p <= 100))
    throw new ChartError('INVALID_INPUT', 'efficiency thresholds must be 1 to 100%');
  if (!(squeezePercent >= 10 && squeezePercent <= 100))
    throw new ChartError('INVALID_INPUT', 'squeeze threshold must be 10 to 100%');
}

/**
 * Market regime strip in its own pane: one full-height column per bar, colored by
 * compression, rotation, long expansion or short expansion. See `classifyRegimes`.
 */
export function regime(
  period = 20,
  slowPeriod = 100,
  entryPercent = 65,
  holdPercent = 35,
  squeezePercent = 80,
): IndicatorPlugin {
  checkRegime(period, slowPeriod, entryPercent, holdPercent, squeezePercent);
  return {
    id: `regime-${period}-${slowPeriod}`,
    name: `Regime ${period} ${slowPeriod}`,
    kind: 'regime',
    inputs: { period, slowPeriod, entry: entryPercent, hold: holdPercent, squeeze: squeezePercent },
    pane: 'separate',
    range: { min: 0, max: 1 },
    color: GREY,
    outputs: [
      { id: 'compression', name: 'Compression', color: AMBER, style: 'column' },
      { id: 'rotation', name: 'Rotation', color: GREY, style: 'column' },
      { id: 'long', name: 'Expansion long', color: MINT, style: 'column' },
      { id: 'short', name: 'Expansion short', color: RED, style: 'column' },
    ],
    // ATR and the rolling path depend on every earlier bar, so the series is recomputed. It is O(n).
    calculateOutputs(candles) {
      const regimes = classifyRegimes(
        candles,
        period,
        slowPeriod,
        entryPercent / 100,
        holdPercent / 100,
        squeezePercent / 100,
      );
      return REGIMES.map(kind => regimes.map(r => (r === kind ? 1 : Number.NaN)));
    },
  };
}

const REGIME_COLORS: Readonly<Record<Regime, RGBA>> = {
  compression: AMBER,
  rotation: GREY,
  long: MINT,
  short: RED,
};
const REGIME_NAMES: Readonly<Record<Regime, string>> = {
  compression: 'Compression',
  rotation: 'Rotation',
  long: 'Expansion long',
  short: 'Expansion short',
};

/**
 * Market regime as an envelope on the candles: an EMA of the close with edges `multiplier`
 * ATRs away. Edges and fill take the regime's color. Each regime has its own upper and
 * lower outputs, finite on its bars and on the bar before, so the edge lines join across
 * changes. See `classifyRegimes`.
 */
export function regimeBand(
  period = 20,
  slowPeriod = 100,
  entryPercent = 65,
  holdPercent = 35,
  squeezePercent = 80,
  multiplier = 2,
): IndicatorPlugin {
  checkRegime(period, slowPeriod, entryPercent, holdPercent, squeezePercent);
  if (!(multiplier > 0 && multiplier <= 10))
    throw new ChartError('INVALID_INPUT', 'ATR multiplier must be 0 to 10');
  return {
    id: `regime-band-${period}-${slowPeriod}`,
    name: `Regime band ${period} ${slowPeriod}`,
    kind: 'regime-band',
    inputs: {
      period,
      slowPeriod,
      entry: entryPercent,
      hold: holdPercent,
      squeeze: squeezePercent,
      multiplier,
    },
    color: GREY,
    outputs: [
      { id: 'basis', name: 'Basis', color: [GREY[0], GREY[1], GREY[2], 0.45] },
      ...REGIMES.flatMap(kind => [
        { id: `${kind}-upper`, name: `${REGIME_NAMES[kind]} upper`, color: REGIME_COLORS[kind] },
        { id: `${kind}-lower`, name: `${REGIME_NAMES[kind]} lower`, color: REGIME_COLORS[kind] },
      ]),
    ],
    fills: REGIMES.map((_, k) => ({ upper: 1 + 2 * k, lower: 2 + 2 * k, opacity: 0.1 })),
    calculateOutputs(candles) {
      const regimes = classifyRegimes(
        candles,
        period,
        slowPeriod,
        entryPercent / 100,
        holdPercent / 100,
        squeezePercent / 100,
      );
      const basis = emaSeries(
        candles.map(c => c.close),
        period,
      );
      const atr = atrSeries(candles, period);
      const edges = REGIMES.flatMap(kind => {
        const upper: number[] = new Array(candles.length).fill(Number.NaN),
          lower = upper.slice();
        for (let i = 0; i < candles.length; i++) {
          if (regimes[i] !== kind && regimes[i + 1] !== kind) continue;
          if (!Number.isFinite(basis[i]) || !Number.isFinite(atr[i])) continue;
          upper[i] = basis[i] + multiplier * atr[i];
          lower[i] = basis[i] - multiplier * atr[i];
        }
        return [upper, lower];
      });
      return [basis, ...edges];
    },
  };
}

export type TrendState = 'bull' | 'bear' | 'neutral';
const TREND_STATES: readonly TrendState[] = ['bull', 'bear', 'neutral'];
const TREND_COLORS: Readonly<Record<TrendState, RGBA>> = { bull: MINT, bear: AMBER, neutral: GREY };
const TREND_NAMES: Readonly<Record<TrendState, string>> = { bull: 'Bull', bear: 'Bear', neutral: 'Neutral' };

/**
 * Ribbon state per bar from the gap between the fast and slow EMAs, in ATRs (14-bar
 * Wilder). A trend starts once the gap clears `enter` (bull above, bear below) and holds
 * until the gap shrinks to `neutral`. Within `neutral` it is neutral. A state lasts at
 * least `minBars` bars. Null until both EMAs and the ATR exist.
 */
export function classifyTrend(
  candles: readonly Candle[],
  fastPeriod = 8,
  slowPeriod = 21,
  neutral = 0.1,
  enter = neutral,
  minBars = 1,
): (TrendState | null)[] {
  const closes = candles.map(c => c.close);
  const fast = emaSeries(closes, fastPeriod),
    slow = emaSeries(closes, slowPeriod),
    atr = atrSeries(candles, 14);
  let current: TrendState | null = null,
    held = 0;
  return candles.map((_, i) => {
    if (![fast[i], slow[i], atr[i]].every(Number.isFinite)) return null;
    const gap = atr[i] > 0 ? (fast[i] - slow[i]) / atr[i] : 0;
    let next: TrendState;
    if (gap > enter || (current === 'bull' && gap > neutral)) next = 'bull';
    else if (gap < -enter || (current === 'bear' && gap < -neutral)) next = 'bear';
    else next = Math.abs(gap) <= neutral ? 'neutral' : (current ?? 'neutral');
    if (current === null || (next !== current && held >= minBars)) {
      current = next;
      held = 0;
    }
    held++;
    return current;
  });
}

/** Copies `values` where `keep` holds, and on the bar before, so line segments join across changes. */
function segment(values: readonly number[], keep: (i: number) => boolean) {
  return values.map((value, i) => (keep(i) || keep(i + 1) ? value : Number.NaN));
}

/** Tideline candles: trend-colored bars, with counter-trend bars muted. */
const TIDE_CANDLES: readonly RGBA[] = [
  [0.33, 0.62, 0.42, 1], // up bar in a bull trend
  [0.6, 0.63, 0.66, 1], // down bar in a bull trend
  [0.74, 0.4, 0.17, 1], // down bar in a bear trend
  [0.76, 0.5, 0.58, 1], // up bar in a bear trend
];
const PIVOT_DOT: RGBA = [0.98, 0.64, 0.22, 0.9];
const BULL_DOT: RGBA = [0.38, 0.8, 0.42, 1];
const BEAR_DOT: RGBA = [0.94, 0.36, 0.3, 1];

/**
 * Swing highs and lows: a bar whose high is above the `size` bars before it and not below
 * the `size` bars after it, and the mirror for lows. Each is known `size` bars late.
 */
function pivots(candles: readonly Candle[], size: number) {
  const highs: boolean[] = new Array(candles.length).fill(false),
    lows = highs.slice();
  if (size < 1) return { highs, lows };
  for (let i = size; i < candles.length - size; i++) {
    let high = true,
      low = true;
    for (let j = 1; j <= size && (high || low); j++) {
      if (!(candles[i].high > candles[i - j].high && candles[i].high >= candles[i + j].high)) high = false;
      if (!(candles[i].low < candles[i - j].low && candles[i].low <= candles[i + j].low)) low = false;
    }
    highs[i] = high;
    lows[i] = low;
  }
  return { highs, lows };
}

/** Bars a stop entry waits to trigger, and the most bars a trade projection runs. */
const TIDE_ENTRY_BARS = 2,
  TIDE_TRADE_BARS = 30;

/**
 * Tideline: a fast/slow EMA ribbon shaded bull, bear or neutral (see `classifyTrend`, with
 * `enterPercent` and `neutralPercent` of ATR as the entry and exit gaps), and a long EMA
 * that is green while the close is above it and orange while below.
 *
 * Optional extras: candles colored by the ribbon (counter-trend bars muted, neutral bars
 * left alone), orange dots off swing highs and lows `pivotBars` wide, and pullback dots.
 *
 * A bull pullback is the first bar of a bull ribbon to touch the fast EMA, closing above
 * the slow EMA, with the close and the slow EMA above the trend EMA and the slow EMA up at
 * least 0.2 ATR over 5 bars. With `regime`, the bar must also be in long expansion (see
 * `classifyRegimes`). Bear pullbacks mirror it. A trend entry gap below the neutral gap
 * counts as the neutral gap.
 *
 * With `targets`, each pullback while no trade is open projects a stop entry at the signal
 * bar's high, a stop 0.5 ATR beyond its low or the slow EMA, whichever is further, and a
 * target `targetR` times the risk past the entry, drawn from the bar before the signal so
 * it shows on a live one. The projection is dropped if the entry
 * does not trigger within 2 bars, and ends on the bar that hits the stop or target (the
 * stop when one bar hits both) or after 30 bars.
 */
export function tideline(
  fastPeriod = 8,
  slowPeriod = 21,
  trendPeriod = 200,
  neutralPercent = 10,
  options: {
    candles?: boolean;
    pivotBars?: number;
    pullbacks?: boolean;
    enterPercent?: number;
    holdBars?: number;
    regime?: boolean;
    targets?: boolean;
    targetR?: number;
  } = {},
): IndicatorPlugin {
  if (![fastPeriod, slowPeriod, trendPeriod].every(p => Number.isInteger(p) && p >= 1 && p <= 1000))
    throw new ChartError('INVALID_PERIOD');
  if (fastPeriod >= slowPeriod)
    throw new ChartError('INVALID_INPUT', 'fast period must be below slow period');
  if (!(neutralPercent >= 0 && neutralPercent <= 100))
    throw new ChartError('INVALID_INPUT', 'neutral gap must be 0 to 100% of ATR');
  const colorCandles = options.candles ?? true,
    pivotBars = options.pivotBars ?? 2,
    pullbacks = options.pullbacks ?? true,
    enterPercent = options.enterPercent ?? 30,
    holdBars = options.holdBars ?? 3,
    regimeFilter = options.regime ?? true,
    targets = options.targets ?? true,
    targetR = options.targetR ?? 2;
  if (!(Number.isInteger(pivotBars) && pivotBars >= 0 && pivotBars <= 20))
    throw new ChartError('INVALID_INPUT', 'pivot bars must be 0 to 20');
  if (!(enterPercent >= 0 && enterPercent <= 200))
    throw new ChartError('INVALID_INPUT', 'trend entry gap must be 0 to 200% of ATR');
  if (!(Number.isInteger(holdBars) && holdBars >= 1 && holdBars <= 20))
    throw new ChartError('INVALID_INPUT', 'hold bars must be 1 to 20');
  if (!(targetR >= 0.5 && targetR <= 10)) throw new ChartError('INVALID_INPUT', 'target must be 0.5 to 10 R');
  const edge = (color: RGBA): RGBA => [color[0], color[1], color[2], 0.3];
  return {
    id: `tideline-${fastPeriod}-${slowPeriod}-${trendPeriod}`,
    name: `Tideline ${fastPeriod} ${slowPeriod} ${trendPeriod}`,
    kind: 'tideline',
    inputs: {
      fast: fastPeriod,
      slow: slowPeriod,
      trend: trendPeriod,
      neutral: neutralPercent,
      enter: enterPercent,
      hold: holdBars,
      candles: +colorCandles,
      pivots: pivotBars,
      pullbacks: +pullbacks,
      regime: +regimeFilter,
      targets: +targets,
      targetR,
    },
    color: MINT,
    outputs: [
      ...TREND_STATES.flatMap(state => [
        { id: `${state}-fast`, name: `${TREND_NAMES[state]} fast`, color: edge(TREND_COLORS[state]) },
        { id: `${state}-slow`, name: `${TREND_NAMES[state]} slow`, color: edge(TREND_COLORS[state]) },
      ]),
      { id: 'trend-above', name: 'Trend (close above)', color: MINT },
      { id: 'trend-below', name: 'Trend (close below)', color: AMBER },
      { id: 'candles', name: 'Candle color', color: GREY, style: 'candles', palette: TIDE_CANDLES },
      { id: 'pivot-high', name: 'Swing high', color: PIVOT_DOT, style: 'dot', radius: 2.5 },
      { id: 'pivot-low', name: 'Swing low', color: PIVOT_DOT, style: 'dot', radius: 2.5 },
      { id: 'pullback-bull', name: 'Bull pullback', color: BULL_DOT, style: 'dot', radius: 4 },
      { id: 'pullback-bear', name: 'Bear pullback', color: BEAR_DOT, style: 'dot', radius: 4 },
      { id: 'entry', name: 'Entry', color: [GREY[0], GREY[1], GREY[2], 0.5] },
      { id: 'stop', name: 'Stop', color: [RED[0], RED[1], RED[2], 0.45] },
      { id: 'target', name: 'Target', color: [MINT[0], MINT[1], MINT[2], 0.45] },
    ],
    fills: [
      // The upper index sets the fill color, so each pair fills in its state's color whichever EMA is on top.
      ...TREND_STATES.map((_, k) => ({ upper: 2 * k, lower: 2 * k + 1, opacity: 0.28 })),
      { upper: 15, lower: 13, opacity: 0.06 },
      { upper: 14, lower: 13, opacity: 0.06 },
    ],
    // EMA seeds, the ATR and late-confirmed pivots depend on other bars, so the series is recomputed. It is O(n).
    calculateOutputs(candles) {
      const n = candles.length;
      const closes = candles.map(c => c.close);
      const fast = emaSeries(closes, fastPeriod),
        slow = emaSeries(closes, slowPeriod),
        trend = emaSeries(closes, trendPeriod),
        atr = atrSeries(candles, 14);
      const states = classifyTrend(
        candles,
        fastPeriod,
        slowPeriod,
        neutralPercent / 100,
        Math.max(enterPercent, neutralPercent) / 100,
        holdBars,
      );
      const regimes = regimeFilter && pullbacks ? classifyRegimes(candles) : null;
      const ribbon = TREND_STATES.flatMap(state => {
        const keep = (i: number) => states[i] === state;
        return [segment(fast, keep), segment(slow, keep)];
      });
      const above = (i: number) => i < n && candles[i].close >= trend[i];
      const below = (i: number) => i < n && candles[i].close < trend[i];
      const empty = () => new Array<number>(n).fill(Number.NaN);
      const tones = empty();
      if (colorCandles)
        for (let i = 0; i < n; i++) {
          const up = candles[i].close >= candles[i].open;
          if (states[i] === 'bull') tones[i] = up ? 0 : 1;
          else if (states[i] === 'bear') tones[i] = up ? 3 : 2;
        }
      const [pivotHigh, pivotLow] = [empty(), empty()];
      const { highs, lows } = pivots(candles, pivotBars);
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(atr[i])) continue;
        // Off the wick, so the dot never sits on the bar.
        if (highs[i]) pivotHigh[i] = candles[i].high + atr[i] * 0.35;
        if (lows[i]) pivotLow[i] = candles[i].low - atr[i] * 0.35;
      }
      const [bullPullback, bearPullback] = [empty(), empty()];
      const [entryLine, stopLine, targetLine] = [empty(), empty(), empty()];
      // A projection draws from the bar before the signal, so a signal on the live bar shows, to the bar it ends on.
      // The next one starts at least a bar later, so lines never join.
      let free = 0;
      const project = (i: number, side: 1 | -1) => {
        const bar = candles[i];
        const entry = side > 0 ? bar.high : bar.low;
        const stop =
          side > 0 ? Math.min(bar.low, slow[i]) - atr[i] * 0.5 : Math.max(bar.high, slow[i]) + atr[i] * 0.5;
        const target = entry + side * targetR * Math.abs(entry - stop);
        let last = Math.min(n - 1, i + TIDE_TRADE_BARS),
          live = false;
        for (let k = i + 1; k <= last; k++) {
          const { high, low } = candles[k];
          if (!live) {
            if (side > 0 ? high >= entry : low <= entry) live = true;
            else if (k - i >= TIDE_ENTRY_BARS) return;
            else continue;
          }
          if ((side > 0 ? low <= stop : high >= stop) || (side > 0 ? high >= target : low <= target)) {
            last = k;
            break;
          }
        }
        for (let k = i - 1; k <= last; k++) {
          entryLine[k] = entry;
          stopLine[k] = stop;
          targetLine[k] = target;
        }
        free = last + 3;
      };
      if (pullbacks)
        for (let i = 5; i < n; i++) {
          const bar = candles[i],
            prior = candles[i - 1];
          if (![fast[i - 1], slow[i - 5], trend[i], atr[i]].every(Number.isFinite) || !(atr[i] > 0)) continue;
          const slope = (slow[i] - slow[i - 5]) / atr[i];
          if (
            states[i] === 'bull' &&
            bar.low <= fast[i] &&
            bar.close > slow[i] &&
            prior.low > fast[i - 1] &&
            bar.close > trend[i] &&
            slow[i] > trend[i] &&
            slope >= 0.2 &&
            (!regimes || regimes[i] === 'long')
          ) {
            bullPullback[i] = fast[i];
            if (targets && i >= free) project(i, 1);
          }
          if (
            states[i] === 'bear' &&
            bar.high >= fast[i] &&
            bar.close < slow[i] &&
            prior.high < fast[i - 1] &&
            bar.close < trend[i] &&
            slow[i] < trend[i] &&
            slope <= -0.2 &&
            (!regimes || regimes[i] === 'short')
          ) {
            bearPullback[i] = fast[i];
            if (targets && i >= free) project(i, -1);
          }
        }
      return [
        ...ribbon,
        segment(trend, above),
        segment(trend, below),
        tones,
        pivotHigh,
        pivotLow,
        bullPullback,
        bearPullback,
        entryLine,
        stopLine,
        targetLine,
      ];
    },
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

/** Range choices in the order the settings list them. */
const PROFILE_RANGES = ['session', 'today', 'visible'] as const;

/** How many past days the sessions switch draws. */
export const PROFILE_SESSIONS = 10;

/**
 * Volume profile with point of control and value area against the price axis, and a delta
 * column beside it. `sessions` also draws a fixed-range profile over each of the last ten
 * days. `today` and `session` replace both with that one profile, over its own bars.
 */
export function volumeProfile(
  rowHeight = 5,
  width = 0.2,
  valueArea = 0.7,
  options: { delta?: boolean; range?: 'visible' | 'today' | 'session'; sessions?: boolean } = {},
): IndicatorPlugin {
  checkProfile(rowHeight, width);
  if (!(valueArea >= 0.1 && valueArea <= 1))
    throw new ChartError('INVALID_INPUT', 'value area must be 10 to 100%');
  const delta = options.delta ?? true,
    range = options.range ?? 'visible',
    sessions = !!options.sessions;
  return {
    id: 'vp',
    name:
      range === 'today'
        ? "Today's volume profile"
        : range === 'session'
          ? 'Session volume profile'
          : 'Volume profile',
    kind: 'vp',
    inputs: {
      rowHeight,
      width: Math.round(width * 100),
      valueArea: Math.round(valueArea * 100),
      delta: +delta,
      range: PROFILE_RANGES.indexOf(range),
      sessions: +sessions,
    },
    pane: 'profile',
    color: TEAL,
    profile: {
      volume: true,
      delta,
      rowHeight,
      width,
      valueArea,
      range,
      sessions: sessions ? PROFILE_SESSIONS : 0,
    },
  };
}

/** Buy minus sell volume at each price for the visible bars. Superseded by `volumeProfile`. */
export function priceDelta(rowHeight = 5, width = 0.1): IndicatorPlugin {
  checkProfile(rowHeight, width);
  return {
    id: 'price-delta',
    name: 'Price delta',
    kind: 'price-delta',
    inputs: { rowHeight, width: Math.round(width * 100) },
    pane: 'profile',
    color: MINT,
    profile: { volume: false, delta: true, rowHeight, width },
  };
}

/**
 * Bubbles for large aggressive prints, read from the candles' `largeTrades`: green for
 * buyers, red for sellers, area proportional to size. Feeds without `largeTrades` show none.
 */
export function bigTrades(minSize = 20, maxRadius = 22): IndicatorPlugin {
  if (!(minSize >= 1 && minSize <= 1_000_000))
    throw new ChartError('INVALID_INPUT', 'minimum size must be 1 or more');
  if (!(maxRadius >= 6 && maxRadius <= 60))
    throw new ChartError('INVALID_INPUT', 'bubble size must be 6 to 60 px');
  return {
    id: 'big-trades',
    name: 'Big trades',
    kind: 'big-trades',
    inputs: { minSize, maxRadius },
    pane: 'profile',
    color: MINT,
    bubbles: { minSize, maxRadius },
  };
}

/**
 * Marks aggression (one side's market orders moved price) and absorption (they did not,
 * because resting orders took them) on bars with unusually high volume and a lopsided
 * delta. Reads `buyVolume`, and `footprint` to place absorption at its price.
 */
export function absorptionAggression(
  lookback = 20,
  volumeMultiple = 1.5,
  minDeltaPercent = 20,
  absorptionDeltaPercent = 10,
  zoneBars = 120,
): IndicatorPlugin {
  if (!(Number.isInteger(lookback) && lookback >= 5 && lookback <= 500))
    throw new ChartError('INVALID_INPUT', 'lookback must be 5 to 500 bars');
  if (!(volumeMultiple >= 1 && volumeMultiple <= 10))
    throw new ChartError('INVALID_INPUT', 'volume multiple must be 1 to 10');
  if (![minDeltaPercent, absorptionDeltaPercent].every(p => p >= 1 && p <= 100))
    throw new ChartError('INVALID_INPUT', 'delta thresholds must be 1 to 100%');
  if (!(Number.isInteger(zoneBars) && zoneBars >= 0 && zoneBars <= 2000))
    throw new ChartError('INVALID_INPUT', 'zone bars must be 0 to 2000');
  return {
    id: 'flow-signals',
    name: 'Absorption & aggression',
    kind: 'flow-signals',
    inputs: {
      lookback,
      volumeMultiple,
      minDelta: minDeltaPercent,
      absorptionDelta: absorptionDeltaPercent,
      zoneBars,
    },
    pane: 'profile',
    color: MINT,
    flowSignals: {
      lookback,
      volumeMultiple,
      minDelta: minDeltaPercent / 100,
      absorptionDelta: absorptionDeltaPercent / 100,
      zoneBars,
    },
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
    kind: 'regime',
    name: 'Market regime',
    description: 'Colors each bar as compression, rotation, or expansion long or short.',
    pane: 'separate',
    inputs: {
      period: period(20, 2),
      slowPeriod: { label: 'Slow period', default: 100, min: 3, max: 2000 },
      entry: { label: 'Entry efficiency %', default: 65, min: 1, max: 100 },
      hold: { label: 'Hold efficiency %', default: 35, min: 1, max: 100 },
      squeeze: { label: 'Squeeze vol %', default: 80, min: 10, max: 100 },
    },
    create: (inputs, id) => ({
      ...regime(inputs.period, inputs.slowPeriod, inputs.entry, inputs.hold, inputs.squeeze),
      id,
    }),
  },
  {
    kind: 'regime-band',
    name: 'Market regime band',
    description: 'ATR envelope on the candles, colored by compression, rotation or expansion.',
    pane: 'price',
    inputs: {
      period: period(20, 2),
      slowPeriod: { label: 'Slow period', default: 100, min: 3, max: 2000 },
      entry: { label: 'Entry efficiency %', default: 65, min: 1, max: 100 },
      hold: { label: 'Hold efficiency %', default: 35, min: 1, max: 100 },
      squeeze: { label: 'Squeeze vol %', default: 80, min: 10, max: 100 },
      multiplier: { label: 'ATR ×', default: 2, min: 0.5, max: 10, integer: false },
    },
    create: (inputs, id) => ({
      ...regimeBand(
        inputs.period,
        inputs.slowPeriod,
        inputs.entry,
        inputs.hold,
        inputs.squeeze,
        inputs.multiplier,
      ),
      id,
    }),
  },
  {
    kind: 'tideline',
    name: 'Tideline',
    description:
      'EMA ribbon shaded by trend, a long EMA colored by which side price is on, trend-colored candles, swing dots, and filtered pullback dots with a projected stop and target.',
    pane: 'price',
    inputs: {
      fast: { label: 'Fast', default: 8, min: 1, max: 999 },
      slow: { label: 'Slow', default: 21, min: 2, max: 1000 },
      trend: { label: 'Trend', default: 200, min: 1, max: 1000 },
      neutral: { label: 'Neutral gap % ATR', default: 10, min: 0, max: 100 },
      enter: { label: 'Trend entry gap % ATR', default: 30, min: 0, max: 200 },
      hold: { label: 'Trend hold bars', default: 3, min: 1, max: 20 },
      candles: { label: 'Color candles', default: 1, min: 0, max: 1, toggle: true },
      pivots: { label: 'Swing dot bars (0 off)', default: 2, min: 0, max: 20 },
      pullbacks: { label: 'Pullback dots', default: 1, min: 0, max: 1, toggle: true },
      regime: { label: 'Only in expansion', default: 1, min: 0, max: 1, toggle: true },
      targets: { label: 'Stop and target', default: 1, min: 0, max: 1, toggle: true },
      targetR: { label: 'Target R', default: 2, min: 0.5, max: 10, integer: false },
    },
    create: (inputs, id) => ({
      ...tideline(inputs.fast, inputs.slow, inputs.trend, inputs.neutral, {
        candles: !!inputs.candles,
        pivotBars: inputs.pivots,
        pullbacks: !!inputs.pullbacks,
        enterPercent: inputs.enter,
        holdBars: inputs.hold,
        regime: !!inputs.regime,
        targets: !!inputs.targets,
        targetR: inputs.targetR,
      }),
      id,
    }),
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
    description:
      'Volume and delta at each price for the visible bars, today or the current session, with POC, value area and past sessions.',
    pane: 'profile',
    inputs: {
      range: { label: 'Range', default: 2, min: 0, max: 2, options: ['Current session', 'Today', 'Visible'] },
      rowHeight: { label: 'Row px', default: 5, min: 2, max: 40 },
      width: { label: 'Width %', default: 20, min: 5, max: 50 },
      valueArea: { label: 'Value area %', default: 70, min: 10, max: 100 },
      delta: { label: 'Delta', default: 1, min: 0, max: 1, toggle: true },
      sessions: { label: `Last ${PROFILE_SESSIONS} sessions`, default: 0, min: 0, max: 1, toggle: true },
    },
    create: (inputs, id) => ({
      ...volumeProfile(inputs.rowHeight, inputs.width / 100, inputs.valueArea / 100, {
        delta: !!inputs.delta,
        range: PROFILE_RANGES[inputs.range],
        sessions: !!inputs.sessions,
      }),
      id,
    }),
  },
  {
    kind: 'price-delta',
    name: 'Price delta',
    description: 'Buy minus sell volume at each price for the visible bars.',
    pane: 'profile',
    hidden: true,
    inputs: {
      rowHeight: { label: 'Row px', default: 5, min: 2, max: 40 },
      width: { label: 'Width %', default: 10, min: 5, max: 50 },
    },
    create: (inputs, id) => ({ ...priceDelta(inputs.rowHeight, inputs.width / 100), id }),
  },
  {
    kind: 'big-trades',
    name: 'Big trades',
    description: 'Bubbles for large aggressive prints, sized by volume.',
    pane: 'profile',
    inputs: {
      minSize: { label: 'Min size', default: 20, min: 1, max: 1_000_000 },
      maxRadius: { label: 'Bubble px', default: 22, min: 6, max: 60 },
    },
    create: (inputs, id) => ({ ...bigTrades(inputs.minSize, inputs.maxRadius), id }),
  },
  {
    kind: 'flow-signals',
    name: 'Absorption & aggression',
    description: 'High-volume bars where lopsided delta moved price, or failed to.',
    pane: 'profile',
    inputs: {
      lookback: { label: 'Lookback', default: 20, min: 5, max: 500 },
      volumeMultiple: { label: 'Volume ×', default: 1.5, min: 1, max: 10, integer: false },
      minDelta: { label: 'Aggression delta %', default: 20, min: 1, max: 100 },
      absorptionDelta: { label: 'Absorption delta %', default: 10, min: 1, max: 100 },
      zoneBars: { label: 'Zone bars', default: 120, min: 0, max: 2000 },
    },
    create: (inputs, id) => ({
      ...absorptionAggression(
        inputs.lookback,
        inputs.volumeMultiple,
        inputs.minDelta,
        inputs.absorptionDelta,
        inputs.zoneBars,
      ),
      id,
    }),
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
