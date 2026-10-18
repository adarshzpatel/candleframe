import type { ChartGeometry } from './geometry.ts';
import { indicatorColor, themeColor, type ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { RuntimeState } from './types.ts';

/** Default dot radius in pixels. Dots shrink when bars are narrower than them. */
const RADIUS = 3;

/** Draws `dot` outputs of shown price indicators: a small circle at each finite value in view. */
export function renderIndicatorDots(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
): void {
  if (!state.document.layers.indicator || !state.candles.length) return;
  const layers = state.indicators.filter(
    item =>
      item.visible &&
      (item.plugin.pane ?? 'price') === 'price' &&
      item.plugin.outputs?.some(o => o.style === 'dot'),
  );
  if (!layers.length) return;
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, state.feed.intervalMs);
  if (end <= start) return;
  const half = state.feed.intervalMs / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight);
  ctx.clip();
  for (const { plugin, series } of layers)
    plugin.outputs!.forEach((output, k) => {
      if (output.style !== 'dot') return;
      const radius = Math.max(1.5, Math.min(output.radius ?? RADIUS, g.barSpacing / 2));
      const [r, gr, b, a] = indicatorColor(theme, plugin, k);
      ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(gr * 255)} ${Math.round(b * 255)} / ${a})`;
      ctx.beginPath();
      const values = series[k] ?? [];
      for (let i = start; i < end; i++) {
        if (!Number.isFinite(values[i])) continue;
        const x = g.x(state.candles[i].timeMs + half),
          y = g.y(values[i]);
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    });
  ctx.restore();
}

/** Below this bar spacing, markers would touch, so `line-markers` draws the line alone. */
const MARKER_MIN_SPACING = 4;

/** The markers of the `line-markers` chart type: a dot at each close in view. `latest` is the displayed forming bar. */
export function renderLineMarkers(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  latest = state.candles.at(-1),
): void {
  if (state.document.chartType !== 'line-markers' || !state.document.layers.candles) return;
  if (g.barSpacing < MARKER_MIN_SPACING || !state.candles.length) return;
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, state.feed.intervalMs);
  const half = state.feed.intervalMs / 2,
    radius = Math.min(RADIUS, g.barSpacing / 4) + theme.chart.lineWidth / 2,
    last = state.candles.length - 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight);
  ctx.clip();
  ctx.fillStyle = themeColor(theme, theme.chart.lineColor);
  ctx.beginPath();
  for (let i = start; i < end; i++) {
    const bar = i === last && latest ? latest : state.candles[i];
    const x = g.x(bar.timeMs + half),
      y = g.y(bar.close);
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}
