import { detectFlowSignals, zoneEnd, type FlowSignal, type FlowSignalOptions } from './flow-signals.ts';
import type { ChartGeometry } from './geometry.ts';
import { themeColorCSS, type ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { IndicatorPlugin, RuntimeState } from './types.ts';

/** Gap between a bar's extreme and its aggression triangle, in pixels. */
const GAP = 4;

/**
 * Draws the absorption and aggression indicator for the visible bars. Aggression is an
 * arrow beyond the bar's high or low, pointing the way price was pushed.
 * Absorption is an outlined diamond at the price where resting orders held, colored by
 * the side that absorbed. Size grows with the bar's volume over its average.
 */
export function renderFlowSignals(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
): void {
  if (!state.document.layers.indicator || !state.candles.length) return;
  const layers = state.indicators.filter(
    (item): item is typeof item & { plugin: IndicatorPlugin & { flowSignals: FlowSignalOptions } } =>
      item.visible && item.plugin.pane === 'profile' && !!item.plugin.flowSignals,
  );
  if (!layers.length) return;
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, state.feed.intervalMs);
  if (end <= start) return;
  const half = state.feed.intervalMs / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight);
  ctx.clip();
  const tickSize = state.feed.instrument.tickSize;
  for (const { plugin } of layers) {
    const options = { ...plugin.flowSignals, tickSize };
    const zoneBars = options.zoneBars ?? 0;
    // Zones from signals left of the view can still reach into it.
    const signals = detectFlowSignals(state.candles, Math.max(0, start - zoneBars), end, options);
    if (zoneBars > 0) drawZones(ctx, state, g, theme, signals, zoneBars, start);
    for (const signal of signals) {
      if (signal.index < start) continue;
      const bar = state.candles[signal.index]!;
      const x = g.x(bar.timeMs + half);
      const r = Math.min(10, 4 + signal.strength);
      const color = signal.side === 1 ? '@positive' : '@negative';
      ctx.beginPath();
      if (signal.kind === 'aggression') {
        // An arrow with a stem, so it reads differently from fill triangles.
        const d = signal.side; // 1: below the low, pointing up.
        const tip = g.y(signal.price) + d * GAP;
        const head = tip + d * r * 1.2;
        ctx.moveTo(x, tip);
        ctx.lineTo(x + r, head);
        ctx.lineTo(x - r, head);
        ctx.closePath();
        ctx.fillStyle = themeColorCSS(theme, color, 0.95);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, head);
        ctx.lineTo(x, head + d * r * 1.6);
        ctx.lineWidth = Math.max(2, r / 2.5);
        ctx.strokeStyle = themeColorCSS(theme, color, 0.95);
        ctx.stroke();
      } else {
        const y = g.y(signal.price);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fillStyle = themeColorCSS(theme, color, 0.25);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = themeColorCSS(theme, color, 1);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * Translucent bands from each signal bar to the bar that closed through the zone, or to
 * the right edge while it holds. Absorption has a solid border, aggression a dashed one.
 */
function drawZones(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  signals: readonly FlowSignal[],
  zoneBars: number,
  start: number,
): void {
  const candles = state.candles;
  const half = state.feed.intervalMs / 2;
  ctx.font = `600 ${Math.max(9, theme.typography.axisSize - 2)}px ${theme.typography.numberFamily}`;
  ctx.textAlign = 'left';
  for (const signal of signals) {
    const { endIndex, broken } = zoneEnd(candles, signal, zoneBars);
    if (endIndex < start) continue;
    const color = signal.side === 1 ? '@positive' : '@negative';
    const left = g.x(candles[signal.index]!.timeMs + half);
    const holding = !broken && endIndex === candles.length - 1;
    const right = holding ? g.left + g.plotWidth : g.x(candles[endIndex]!.timeMs + half);
    const top = g.y(signal.zoneHigh);
    const bottom = g.y(signal.zoneLow);
    const height = Math.max(2, bottom - top);
    ctx.fillStyle = themeColorCSS(theme, color, signal.kind === 'absorption' ? 0.16 : 0.1);
    ctx.fillRect(left, top, right - left, height);
    ctx.strokeStyle = themeColorCSS(theme, color, broken ? 0.35 : 0.7);
    ctx.lineWidth = 1;
    ctx.setLineDash(signal.kind === 'aggression' ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(left, Math.round(top) + 0.5);
    ctx.lineTo(right, Math.round(top) + 0.5);
    ctx.moveTo(left, Math.round(top + height) - 0.5);
    ctx.lineTo(right, Math.round(top + height) - 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    if (height >= 9 && right - left >= 34) {
      ctx.fillStyle = themeColorCSS(theme, color, 0.95);
      ctx.fillText(signal.kind === 'absorption' ? 'ABS' : 'AGG', left + 4, top + Math.min(height - 2, 10));
    }
  }
}
