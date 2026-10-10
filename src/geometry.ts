import type { Anchor, RuntimeState } from './types.ts';
import type { ViewRanges } from './scale-motion.ts';
import { themeTokenDefaults } from './theme-tokens.ts';
import type { ThemeChart } from './theme-tokens.ts';
import { createTimeScale } from './time-scale.ts';
import type { TimeScale } from './time-scale.ts';

export interface ChartGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  volumeTop: number;
  volumeHeight: number;
  minPrice: number;
  maxPrice: number;
  fromMs: number;
  toMs: number;
  /** Pixels per bar slot. */
  barSpacing: number;
  timeScale: TimeScale;
  x(timeMs: number): number;
  y(price: number): number;
  anchor(x: number, y: number): Anchor;
}

export function createGeometry(
  state: RuntimeState,
  width: number,
  height: number,
  appearance: ThemeChart = themeTokenDefaults.chart,
): ChartGeometry {
  const { fromMs, toMs } = state.document.viewport;
  const scale = state.document.priceScale;
  if (scale.mode === 'manual')
    return geometryForRanges(
      { fromMs, toMs, minPrice: scale.minPrice, maxPrice: scale.maxPrice },
      width,
      height,
      appearance,
      stateTimeScale(state),
    );
  const timeScale = stateTimeScale(state);
  const visible = state.candles.filter(
    bar => bar.timeMs + state.feed.intervalMs >= fromMs && bar.timeMs <= toMs,
  );
  const range = visible.length ? visible : state.candles.slice(-1);
  let low = Infinity,
    high = -Infinity;
  for (const bar of range) {
    low = Math.min(low, bar.low);
    high = Math.max(high, bar.high);
  }
  if (!Number.isFinite(low)) {
    low = 68000;
    high = 69000;
  }
  const padding = Math.max(state.feed.instrument.tickSize * 10, (high - low) * 0.15, high * 0.0002);
  const minPrice = Math.max(state.feed.instrument.tickSize, low - padding);
  const maxPrice = high + padding;
  return geometryForRanges({ fromMs, toMs, minPrice, maxPrice }, width, height, appearance, timeScale);
}

/** Uses the same displayed ranges for candles, axes, overlays and hit testing. */
export function geometryForRanges(
  { fromMs, toMs, minPrice, maxPrice }: ViewRanges,
  width: number,
  height: number,
  appearance: ThemeChart = themeTokenDefaults.chart,
  timeScale: TimeScale = createTimeScale([], 1),
): ChartGeometry {
  const left = appearance.plotLeft,
    top = appearance.plotTop;
  const plotWidth = Math.max(1, width - left - appearance.priceAxisWidth);
  const volumeHeight = Math.min(
    appearance.volumeHeight,
    Math.max(0, height - top - appearance.volumeGap - appearance.timeAxisHeight - appearance.axisGap - 1),
  );
  const plotHeight = Math.max(
    1,
    height - top - appearance.volumeGap - volumeHeight - appearance.timeAxisHeight - appearance.axisGap,
  );
  const fromLogical = timeScale.logical(fromMs),
    toLogical = timeScale.logical(toMs);
  return {
    width,
    height,
    left,
    top,
    plotWidth,
    plotHeight,
    volumeTop: top + plotHeight + appearance.volumeGap,
    volumeHeight,
    minPrice,
    maxPrice,
    fromMs,
    toMs,
    barSpacing: plotWidth / Math.max(1e-9, toLogical - fromLogical),
    timeScale,
    // Continuous scales keep the direct time formula so pixel/time round trips stay exact.
    x: timeScale.linear
      ? timeMs => left + ((timeMs - fromMs) / (toMs - fromMs)) * plotWidth
      : timeMs => left + ((timeScale.logical(timeMs) - fromLogical) / (toLogical - fromLogical)) * plotWidth,
    y: price => top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight,
    anchor: (x, y) => ({
      timeMs: timeScale.linear
        ? fromMs + ((x - left) / plotWidth) * (toMs - fromMs)
        : timeScale.time(fromLogical + ((x - left) / plotWidth) * (toLogical - fromLogical)),
      price: maxPrice - ((y - top) / plotHeight) * (maxPrice - minPrice),
    }),
  };
}

const scales = new WeakMap<readonly unknown[], { key: string; scale: TimeScale }>();
/** One time scale per candle array, so geometry, rendering and hit tests agree. */
export function stateTimeScale(state: Pick<RuntimeState, 'candles' | 'feed'>): TimeScale {
  const key = `${state.feed.intervalMs}:${!!state.feed.gaps}`;
  const cached = scales.get(state.candles);
  if (cached?.key === key) return cached.scale;
  const scale = createTimeScale(state.candles, state.feed.intervalMs, state.feed.gaps);
  scales.set(state.candles, { key, scale });
  return scale;
}
