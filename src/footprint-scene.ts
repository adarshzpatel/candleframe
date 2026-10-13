import {
  cellFormat,
  footprintBar,
  footprintBucket,
  footprintShown,
  FOOTPRINT_DEFAULTS,
} from './footprint.ts';
import type { FootprintBar } from './footprint.ts';
import type { ChartGeometry } from './geometry.ts';
import { profileStep } from './profiles.ts';
import { themeColor, themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { Candle, FootprintOptions, RuntimeState } from './types.ts';

/** Grouped rows per candle, rebuilt only when the bucket or row size changes. */
export type FootprintCache = WeakMap<Candle, { key: string; bar: FootprintBar }>;

/** Rows shorter than this merge buckets; text needs about this much height. */
const ROW_PX = 14;
const volumeFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const deltaFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 3,
  signDisplay: 'exceptZero',
});

/**
 * Draws footprint bars: a thin candle at the left of each column and one cell per price
 * row beside it. The WebGL pass skips these bars' candles; bars without levels keep them.
 */
export function renderFootprints(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  cache: FootprintCache,
): void {
  if (!state.document.layers.candles || !footprintShown(state.document, g.barSpacing)) return;
  const options: FootprintOptions = state.document.footprint ?? FOOTPRINT_DEFAULTS;
  const interval = state.feed.intervalMs;
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, interval, 1);
  if (end <= start) return;
  const tickSize = state.feed.instrument.tickSize;
  const bucket = footprintBucket(state.candles, start, end, tickSize);
  const mid = g.top + g.plotHeight / 2;
  const pricePerPixel = Math.abs(g.price(mid) - g.price(mid + 1));
  // Whole buckets per row, on a 1-2-5 ladder so rows stay put while zooming a little.
  const group = profileStep(Math.max(1, Math.ceil((ROW_PX * pricePerPixel) / bucket)));
  const key = `${bucket}:${group}`;
  const top = g.top,
    bottom = g.top + g.plotHeight;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, top, g.plotWidth, g.plotHeight);
  ctx.clip();
  const pad = Math.max(1.5, g.barSpacing * 0.04);
  const strip = Math.min(6, Math.max(3, g.barSpacing * 0.08));
  for (let i = start; i < end; i++) {
    const candle = state.candles[i];
    if (!candle.footprint?.length) continue;
    let entry = cache.get(candle);
    if (entry?.key !== key) {
      entry = { key, bar: footprintBar(candle.footprint, bucket, group) };
      cache.set(candle, entry);
    }
    const cx = g.x(candle.timeMs + interval / 2);
    const left = cx - g.barSpacing / 2 + pad,
      right = cx + g.barSpacing / 2 - pad;
    if (right < g.left || left > g.left + g.plotWidth) continue;
    drawCandleStrip(ctx, theme, g, candle, left, strip);
    const cells = { left: left + strip + 3, right };
    if (cells.right - cells.left < 8) continue;
    drawBar(ctx, theme, g, options, entry.bar, group * bucket, cells, top, bottom);
  }
  ctx.restore();
}

function drawCandleStrip(
  ctx: CanvasRenderingContext2D,
  theme: ResolvedChartTheme,
  g: ChartGeometry,
  candle: Candle,
  left: number,
  width: number,
): void {
  const up = candle.close >= candle.open;
  ctx.fillStyle = themeColor(theme, up ? theme.chart.candleUp : theme.chart.candleDown);
  const x = Math.round(left + width / 2);
  ctx.fillRect(x - 0.5, g.y(candle.high), 1, g.y(candle.low) - g.y(candle.high));
  const y0 = g.y(Math.max(candle.open, candle.close)),
    y1 = g.y(Math.min(candle.open, candle.close));
  ctx.fillRect(left, y0, width, Math.max(1, y1 - y0));
}

interface Cells {
  left: number;
  right: number;
}
function drawBar(
  ctx: CanvasRenderingContext2D,
  theme: ResolvedChartTheme,
  g: ChartGeometry,
  options: FootprintOptions,
  bar: FootprintBar,
  rowSize: number,
  cells: Cells,
  top: number,
  bottom: number,
): void {
  const up = theme.chart.candleUp,
    down = theme.chart.candleDown;
  const width = cells.right - cells.left;
  const format = barFormat(ctx, theme, g, options, bar, rowSize, width);
  const firstY = g.y(bar.rows[0]?.price ?? 0);
  let rowHeight = 0;
  bar.rows.forEach((row, i) => {
    const y0 = g.y(row.price + rowSize),
      y1 = g.y(row.price);
    if (y1 < top || y0 > bottom) return;
    // A hairline between rows once they are tall enough to separate.
    const gap = y1 - y0 >= 6 ? 1 : 0;
    const y = y0 + gap / 2,
      h = Math.max(0.5, y1 - y0 - gap);
    rowHeight = h;
    const volume = row.buy + row.sell,
      delta = row.buy - row.sell;
    const size = Math.min(14, Math.floor(h * 0.75));
    const text = h >= 9 && size >= 7;
    const font = (bold: boolean) =>
      `${bold ? Math.min(900, Number(theme.typography.uiWeight) + 200) || 600 : theme.typography.uiWeight} ${size}px ${theme.typography.numberFamily}`;
    const baseline = y + h / 2 + size * 0.36;
    const fits = (label: string, room: number) => ctx.measureText(label).width <= room;
    if (options.mode === 'bidAsk') {
      const half = width / 2,
        midX = cells.left + half;
      const sellHot = options.imbalance && row.sellImbalance,
        buyHot = options.imbalance && row.buyImbalance;
      const shade = (side: number, hot: boolean) =>
        hot ? 0.6 : bar.maxSide ? 0.06 + 0.34 * (side / bar.maxSide) ** 0.8 : 0;
      if (row.sell) {
        ctx.fillStyle = themeColorCSS(theme, down, shade(row.sell, sellHot));
        ctx.fillRect(cells.left, y, half - 0.5, h);
      }
      if (row.buy) {
        ctx.fillStyle = themeColorCSS(theme, up, shade(row.buy, buyHot));
        ctx.fillRect(midX + 0.5, y, half - 0.5, h);
      }
      if (text) {
        const sell = format(row.sell),
          buy = format(row.buy);
        ctx.font = font(sellHot);
        ctx.textAlign = 'right';
        ctx.fillStyle = sellHot ? theme.palette.textStrong : theme.palette.textMuted;
        if (fits(sell, half - 4)) ctx.fillText(sell, midX - 3, baseline);
        ctx.font = font(buyHot);
        ctx.textAlign = 'left';
        ctx.fillStyle = buyHot ? theme.palette.textStrong : theme.palette.textMuted;
        if (fits(buy, half - 4)) ctx.fillText(buy, midX + 3, baseline);
      }
    } else if (options.mode === 'delta') {
      const hot = options.imbalance && (delta > 0 ? row.buyImbalance : row.sellImbalance);
      if (delta) {
        const strength = bar.maxDelta ? Math.abs(delta) / bar.maxDelta : 0;
        ctx.fillStyle = themeColorCSS(
          theme,
          delta > 0 ? up : down,
          hot ? 0.6 : 0.08 + 0.42 * strength ** 0.8,
        );
        ctx.fillRect(cells.left, y, width, h);
      }
      if (text && volume) {
        const label = format(delta, true);
        ctx.font = font(hot);
        ctx.textAlign = 'center';
        ctx.fillStyle = hot ? theme.palette.textStrong : theme.palette.text;
        if (fits(label, width - 4)) ctx.fillText(label, cells.left + width / 2, baseline);
      }
    } else {
      const length = bar.maxVolume ? (width * volume) / bar.maxVolume : 0;
      const sellLength = volume ? (length * row.sell) / volume : 0;
      ctx.fillStyle = themeColorCSS(theme, down, 0.5);
      ctx.fillRect(cells.left, y, sellLength, h);
      ctx.fillStyle = themeColorCSS(theme, up, 0.5);
      ctx.fillRect(cells.left + sellLength, y, length - sellLength, h);
      if (options.imbalance && (row.buyImbalance || row.sellImbalance)) {
        // A tick on the free edge; color names the side that won.
        ctx.fillStyle = themeColor(theme, row.buyImbalance ? up : down);
        ctx.fillRect(cells.right - 2, y, 2, h);
      }
      if (text && volume) {
        const label = format(volume);
        ctx.font = font(false);
        ctx.textAlign = 'left';
        ctx.fillStyle = theme.palette.textStrong;
        if (fits(label, width - 6)) ctx.fillText(label, cells.left + 3, baseline);
      }
    }
    if (options.poc && i === bar.poc) {
      ctx.strokeStyle = themeColor(theme, '@accent');
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(cells.left) + 0.5,
        Math.round(y) + 0.5,
        Math.round(width) - 1,
        Math.max(1, Math.round(h) - 1),
      );
    }
  });
  if (options.summary && bar.rows.length) {
    const size = theme.typography.axisSize;
    let y = firstY + Math.max(3, rowHeight * 0.25) + size;
    if (y > bottom - 2) return;
    const delta = bar.buy - bar.sell;
    ctx.textAlign = 'center';
    ctx.font = `${theme.typography.uiWeight} ${size}px ${theme.typography.numberFamily}`;
    const x = cells.left + width / 2;
    for (const [label, color] of [
      [`Δ ${deltaFormat.format(delta)}`, themeColor(theme, delta >= 0 ? up : down)],
      [volumeFormat.format(bar.buy + bar.sell), theme.palette.textMuted],
    ] as const) {
      if (y > bottom - 2 || ctx.measureText(label).width > width + 4) break;
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
      y += size + 2;
    }
  }
}

/** Three significant digits when the bar's widest label fits its cell, else two. */
function barFormat(
  ctx: CanvasRenderingContext2D,
  theme: ResolvedChartTheme,
  g: ChartGeometry,
  options: FootprintOptions,
  bar: FootprintBar,
  rowSize: number,
  width: number,
): ReturnType<typeof cellFormat> {
  const max =
    options.mode === 'bidAsk' ? bar.maxSide : options.mode === 'delta' ? bar.maxDelta : bar.maxVolume;
  const precise = cellFormat(max, 3);
  const row = bar.rows[0];
  if (!row) return precise;
  const h = g.y(row.price) - g.y(row.price + rowSize);
  const size = Math.min(14, Math.floor(h * 0.75));
  ctx.font = `${Math.min(900, Number(theme.typography.uiWeight) + 200) || 600} ${size}px ${theme.typography.numberFamily}`;
  const room = options.mode === 'bidAsk' ? width / 2 - 4 : options.mode === 'delta' ? width - 4 : width - 6;
  // Signed delta labels are widest at the largest magnitude; the sign counts too.
  const widest = options.mode === 'delta' ? precise(-max, true) : precise(max);
  return ctx.measureText(widest).width <= room ? precise : cellFormat(max, 2);
}
