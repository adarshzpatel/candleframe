import type { ChartGeometry } from './geometry.ts';
import { themeColorCSS, type ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { BubbleOptions, IndicatorPlugin, LargeTrade, RuntimeState } from './types.ts';

/** Smallest bubble, so a print just over the threshold stays visible. */
const MIN_RADIUS = 3;

/**
 * Draws the big trades indicator: one bubble per large print in the visible bars, at
 * the bar's centre and the print's price. Bubble area grows with size, scaled so the
 * largest print in view gets `maxRadius`.
 */
export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
): void {
  if (!state.document.layers.indicator || !state.candles.length) return;
  const layers = state.indicators.filter(
    (item): item is typeof item & { plugin: IndicatorPlugin & { bubbles: BubbleOptions } } =>
      item.visible && item.plugin.pane === 'profile' && !!item.plugin.bubbles,
  );
  if (!layers.length) return;
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, state.feed.intervalMs);
  if (end <= start) return;
  const half = state.feed.intervalMs / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight);
  ctx.clip();
  for (const { plugin } of layers) {
    const { minSize, maxRadius } = plugin.bubbles;
    const shown: { x: number; trade: LargeTrade }[] = [];
    let largest = 0;
    for (let i = start; i < end; i++) {
      const bar = state.candles[i]!;
      if (!bar.largeTrades?.length) continue;
      const x = g.x(bar.timeMs + half);
      for (const trade of bar.largeTrades) {
        if (trade[1] < minSize) continue;
        shown.push({ x, trade });
        largest = Math.max(largest, trade[1]);
      }
    }
    // Small bubbles last, so they stay visible on top of large ones.
    shown.sort((a, b) => b.trade[1] - a.trade[1]);
    ctx.font = `${theme.typography.markerSize}px ${theme.typography.numberFamily}`;
    ctx.textAlign = 'center';
    for (const { x, trade } of shown) {
      const [price, size, side] = trade;
      const r = Math.max(MIN_RADIUS, maxRadius * Math.sqrt(size / largest));
      const y = g.y(price);
      const color = side === 1 ? '@positive' : '@negative';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = themeColorCSS(theme, color, 0.35);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = themeColorCSS(theme, color, 0.9);
      ctx.stroke();
      if (r >= 10) {
        ctx.fillStyle = theme.palette.textStrong;
        ctx.fillText(String(size), x, y + theme.typography.markerSize * 0.35);
      }
    }
  }
  ctx.restore();
}
