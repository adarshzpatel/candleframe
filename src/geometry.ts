import type { Anchor, RuntimeState } from './types.ts';
import { drawsClosesOnly } from './chart-types.ts';
import type { ViewRanges } from './scale-motion.ts';
import { themeTokenDefaults } from './theme-tokens.ts';
import type { ThemeChart } from './theme-tokens.ts';
import { createTimeScale, visibleRange } from './time-scale.ts';
import type { TimeScale } from './time-scale.ts';

export interface PaneRange {
  id: string;
  name: string;
  min: number;
  max: number;
}
/** An indicator pane stacked below the price and volume area. */
export interface PaneGeometry extends PaneRange {
  top: number;
  height: number;
  y(value: number): number;
  value(y: number): number;
}
export interface GeometryLayout {
  log?: boolean;
  panes?: readonly PaneRange[];
}

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
  /** True when the price axis is logarithmic. */
  log: boolean;
  panes: readonly PaneGeometry[];
  /** Bottom edge of the lowest pane; the time axis starts below it. */
  bottom: number;
  x(timeMs: number): number;
  y(price: number): number;
  /** Inverse of `y` in the price pane. */
  price(y: number): number;
  anchor(x: number, y: number): Anchor;
}

/** Pane ranges for visible separate-pane indicators, fitted to the visible bars unless fixed. */
export function paneRanges(state: RuntimeState, fromMs: number, toMs: number): PaneRange[] {
  if (!state.document.layers.indicator) return [];
  const { start, end } = visibleRange(state.candles, fromMs, toMs, state.feed.intervalMs);
  return state.indicators
    .filter(item => item.visible && item.plugin.pane === 'separate')
    .map(({ plugin, series }) => {
      if (plugin.range)
        return { id: plugin.id, name: plugin.name, min: plugin.range.min, max: plugin.range.max };
      let min = Infinity,
        max = -Infinity;
      for (const [k, values] of series.entries())
        if (plugin.outputs?.[k]?.style !== 'candles')
          for (let i = start; i < end; i++)
            if (Number.isFinite(values[i])) {
              min = Math.min(min, values[i]);
              max = Math.max(max, values[i]);
            }
      for (const level of plugin.levels ?? []) {
        min = Math.min(min, level);
        max = Math.max(max, level);
      }
      if (!Number.isFinite(min)) [min, max] = [0, 1];
      const pad = Math.max((max - min) * 0.1, Math.abs(max) * 1e-6, 1e-9);
      return { id: plugin.id, name: plugin.name, min: min - pad, max: max + pad };
    });
}

/** Log flag and panes for the displayed ranges. */
export function geometryLayout(state: RuntimeState, fromMs: number, toMs: number): GeometryLayout {
  return { log: !!state.document.priceScale.log, panes: paneRanges(state, fromMs, toMs) };
}

export function createGeometry(
  state: RuntimeState,
  width: number,
  height: number,
  appearance: ThemeChart = themeTokenDefaults.chart,
): ChartGeometry {
  const { fromMs, toMs } = state.document.viewport;
  const scale = state.document.priceScale;
  const timeScale = stateTimeScale(state);
  const layout = geometryLayout(state, fromMs, toMs);
  if (scale.mode === 'manual')
    return geometryForRanges(
      { fromMs, toMs, minPrice: scale.minPrice, maxPrice: scale.maxPrice },
      width,
      height,
      appearance,
      timeScale,
      layout,
    );
  const indexes = visibleRange(state.candles, fromMs, toMs, state.feed.intervalMs);
  const visible = state.candles.slice(indexes.start, indexes.end);
  const range = visible.length ? visible : state.candles.slice(-1);
  let low = Infinity,
    high = -Infinity;
  const closes = drawsClosesOnly(state.document.chartType);
  for (const bar of range) {
    low = Math.min(low, closes ? bar.close : bar.low);
    high = Math.max(high, closes ? bar.close : bar.high);
  }
  // Price-pane overlays such as Bollinger Bands stay inside the fitted range.
  if (state.document.layers.indicator && visible.length)
    for (const { plugin, series, visible: shown } of state.indicators) {
      if (!shown || (plugin.pane ?? 'price') !== 'price') continue;
      for (const [k, values] of series.entries())
        if (plugin.outputs?.[k]?.style !== 'candles')
          for (let i = indexes.start; i < indexes.end; i++)
            if (Number.isFinite(values[i]) && values[i] > 0) {
              low = Math.min(low, values[i]);
              high = Math.max(high, values[i]);
            }
    }
  if (!Number.isFinite(low)) {
    low = 68000;
    high = 69000;
  }
  const tick = state.feed.instrument.tickSize;
  let minPrice: number, maxPrice: number;
  if (layout.log) {
    const lo = Math.log(Math.max(tick, low)),
      hi = Math.log(Math.max(tick, high));
    const padding = Math.max((hi - lo) * 0.15, 0.0002);
    minPrice = Math.max(tick, Math.exp(lo - padding));
    maxPrice = Math.max(minPrice + tick, Math.exp(hi + padding));
  } else {
    const padding = Math.max(tick * 10, (high - low) * 0.15, high * 0.0002);
    minPrice = Math.max(tick, low - padding);
    maxPrice = high + padding;
  }
  return geometryForRanges(
    { fromMs, toMs, minPrice, maxPrice },
    width,
    height,
    appearance,
    timeScale,
    layout,
  );
}

/** Uses the same displayed ranges for candles, axes, overlays and hit testing. */
export function geometryForRanges(
  { fromMs, toMs, minPrice, maxPrice }: ViewRanges,
  width: number,
  height: number,
  appearance: ThemeChart = themeTokenDefaults.chart,
  timeScale: TimeScale = createTimeScale([], 1),
  layout: GeometryLayout = {},
): ChartGeometry {
  const left = appearance.plotLeft,
    top = appearance.plotTop;
  const plotWidth = Math.max(1, width - left - appearance.priceAxisWidth);
  const available = height - top - appearance.timeAxisHeight - appearance.axisGap;
  const gap = appearance.volumeGap;
  const ranges = layout.panes ?? [];
  // Each pane takes a fifth of the height, within limits, and together at most 55%.
  let paneHeight = ranges.length ? Math.max(56, Math.min(140, available * 0.2)) : 0;
  if (ranges.length && ranges.length * (paneHeight + gap) > available * 0.55)
    paneHeight = Math.max(28, (available * 0.55) / ranges.length - gap);
  const priceArea = available - ranges.length * (paneHeight + gap);
  const volumeHeight = Math.min(appearance.volumeHeight, Math.max(0, priceArea - gap - 1));
  const plotHeight = Math.max(1, priceArea - gap - volumeHeight);
  const volumeTop = top + plotHeight + gap;
  let paneTop = volumeTop + volumeHeight + gap;
  const panes = ranges.map(range => {
    const paneTopEdge = paneTop;
    paneTop += paneHeight + gap;
    const span = range.max - range.min || 1;
    return {
      ...range,
      top: paneTopEdge,
      height: paneHeight,
      y: (value: number) => paneTopEdge + ((range.max - value) / span) * paneHeight,
      value: (y: number) => range.max - ((y - paneTopEdge) / paneHeight) * span,
    };
  });
  const fromLogical = timeScale.logical(fromMs),
    toLogical = timeScale.logical(toMs);
  const log = !!layout.log;
  const lnMin = Math.log(Math.max(1e-12, minPrice)),
    lnMax = Math.log(Math.max(1e-12, maxPrice));
  const y = log
    ? (price: number) => top + ((lnMax - Math.log(Math.max(1e-12, price))) / (lnMax - lnMin)) * plotHeight
    : (price: number) => top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
  const price = log
    ? (py: number) => Math.exp(lnMax - ((py - top) / plotHeight) * (lnMax - lnMin))
    : (py: number) => maxPrice - ((py - top) / plotHeight) * (maxPrice - minPrice);
  return {
    width,
    height,
    left,
    top,
    plotWidth,
    plotHeight,
    volumeTop,
    volumeHeight,
    minPrice,
    maxPrice,
    fromMs,
    toMs,
    barSpacing: plotWidth / Math.max(1e-9, toLogical - fromLogical),
    timeScale,
    log,
    panes,
    bottom: panes.length ? panes.at(-1)!.top + paneHeight : volumeTop + volumeHeight,
    // Continuous scales keep the direct time formula so pixel/time round trips stay exact.
    x: timeScale.linear
      ? timeMs => left + ((timeMs - fromMs) / (toMs - fromMs)) * plotWidth
      : timeMs => left + ((timeScale.logical(timeMs) - fromLogical) / (toLogical - fromLogical)) * plotWidth,
    y,
    price,
    anchor: (x, py) => ({
      timeMs: timeScale.linear
        ? fromMs + ((x - left) / plotWidth) * (toMs - fromMs)
        : timeScale.time(fromLogical + ((x - left) / plotWidth) * (toLogical - fromLogical)),
      price: price(py),
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
