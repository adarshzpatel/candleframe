import type { Anchor, RuntimeState } from './types.ts';
import type { ViewRanges } from './scale-motion.ts';
import { themeTokenDefaults } from './theme-tokens.ts';
import type { ThemeChart } from './theme-tokens.ts';

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
    );
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
  return geometryForRanges({ fromMs, toMs, minPrice, maxPrice }, width, height, appearance);
}

/** Uses the same displayed ranges for candles, axes, overlays and hit testing. */
export function geometryForRanges(
  { fromMs, toMs, minPrice, maxPrice }: ViewRanges,
  width: number,
  height: number,
  appearance: ThemeChart = themeTokenDefaults.chart,
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
    x: timeMs => left + ((timeMs - fromMs) / (toMs - fromMs)) * plotWidth,
    y: price => top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight,
    anchor: (x, y) => ({
      timeMs: fromMs + ((x - left) / plotWidth) * (toMs - fromMs),
      price: maxPrice - ((y - top) / plotHeight) * (maxPrice - minPrice),
    }),
  };
}
