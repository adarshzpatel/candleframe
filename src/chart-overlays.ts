import { ChartError } from './errors.ts';
import type { ChartGeometry } from './geometry.ts';
import { themeColorCSS, type ChartTheme, type ResolvedChartTheme } from './themes.ts';
import type { Candle } from './types.ts';

/**
 * A horizontal line at a price, such as a working order or a position's entry. Price
 * lines and markers are host-owned view state: they are not saved in documents, not
 * undoable and not editable by the user.
 */
export interface PriceLine {
  price: number;
  /** A theme palette name such as `@positive`, or `#rrggbb`. Default `@accent`. */
  color?: string;
  /** Text in the tag on the price axis, such as "BUY 2 LMT". The price follows it. */
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  /** Line width in CSS pixels. Default 1. */
  width?: number;
}

/** A shape at a time and price, such as a fill or a large trade. */
export interface ChartMarker {
  timeMs: number;
  price: number;
  shape?: 'circle' | 'triangle-up' | 'triangle-down';
  /** Radius in CSS pixels. Default 5. */
  size?: number;
  /** A theme palette name such as `@negative`, or `#rrggbb`. Default `@accent`. */
  color?: string;
  /** Fill opacity from 0 to 1. Default 0.85. */
  opacity?: number;
  /** Short text drawn beside the marker when there is room. */
  label?: string;
}

const COLOR = /^(@[a-zA-Z0-9]+|#[0-9a-fA-F]{6})$/;

function checkColor(color: string | undefined, path: string, theme?: Pick<ChartTheme, 'palette'>): void {
  if (color === undefined) return;
  const known = !color.startsWith('@') || !theme || color.slice(1) in theme.palette;
  if (!COLOR.test(color) || !known)
    throw new ChartError('INVALID_INPUT', 'color must be a palette name like @positive or #rrggbb', { path });
}

/** Validated copies, so the chart never holds a host's mutable objects. */
export function copyPriceLines(lines: readonly PriceLine[]): PriceLine[] {
  if (!Array.isArray(lines)) throw new ChartError('INVALID_INPUT', 'price lines must be an array');
  return lines.map((line, i) => {
    if (!Number.isFinite(line?.price))
      throw new ChartError('INVALID_INPUT', 'price must be finite', { path: `${i}.price` });
    checkColor(line.color, `${i}.color`);
    if (line.width !== undefined && !(line.width > 0 && line.width <= 8))
      throw new ChartError('INVALID_INPUT', 'width must be 0 to 8', { path: `${i}.width` });
    return { ...line };
  });
}

export function copyMarkers(markers: readonly ChartMarker[]): ChartMarker[] {
  if (!Array.isArray(markers)) throw new ChartError('INVALID_INPUT', 'markers must be an array');
  return markers
    .map((marker, i) => {
      if (!Number.isFinite(marker?.timeMs) || !Number.isFinite(marker.price))
        throw new ChartError('INVALID_INPUT', 'timeMs and price must be finite', { path: `${i}` });
      checkColor(marker.color, `${i}.color`);
      if (marker.size !== undefined && !(marker.size > 0 && marker.size <= 60))
        throw new ChartError('INVALID_INPUT', 'size must be 0 to 60', { path: `${i}.size` });
      return { ...marker };
    })
    .sort((a, b) => a.timeMs - b.timeMs);
}

const css = (theme: Pick<ChartTheme, 'palette'>, color: string | undefined, opacity = 1) =>
  themeColorCSS(theme, color ?? '@accent', opacity);

/** Price lines across the plot, each with a tag on the price axis. */
export function renderPriceLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly PriceLine[],
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  formatPrice: (price: number) => string,
): void {
  const height = theme.chart.markerHeight;
  for (const line of lines) {
    const y = Math.round(g.y(line.price)) + 0.5;
    if (y < g.top || y > g.top + g.plotHeight) continue;
    ctx.strokeStyle = css(theme, line.color);
    ctx.lineWidth = line.width ?? 1;
    ctx.setLineDash(line.style === 'dotted' ? [1, 3] : line.style === 'dashed' ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(g.left, y);
    ctx.lineTo(g.left + g.plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // The tag sits at the right edge of the plot, so it never covers the axis prices.
    const text = line.label ? `${line.label}  ${formatPrice(line.price)}` : formatPrice(line.price);
    ctx.font = `${theme.typography.markerSize}px ${theme.typography.numberFamily}`;
    const w = ctx.measureText(text).width + theme.chart.markerPadding * 2;
    const x = g.left + g.plotWidth - w - 4;
    ctx.fillStyle = css(theme, line.color);
    ctx.fillRect(x, y - height / 2, w, height);
    ctx.fillStyle = theme.palette.markerText;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + theme.chart.markerPadding, y + theme.typography.markerSize * 0.35);
  }
}

/**
 * Markers at the centre of the bar that was open at their time, so they line up with
 * candles on gapped, tick and range axes alike.
 */
export function renderMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly ChartMarker[],
  candles: readonly Candle[],
  intervalMs: number,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
): void {
  if (!markers.length || !candles.length) return;
  const first = candles[0]!.timeMs;
  let lo = 0;
  for (const marker of markers) {
    if (marker.timeMs < first) continue;
    // Markers are sorted, so the bar search only moves forward.
    while (lo + 1 < candles.length && candles[lo + 1]!.timeMs <= marker.timeMs) lo++;
    const x = g.x(candles[lo]!.timeMs + intervalMs / 2);
    const y = g.y(marker.price);
    const r = marker.size ?? 5;
    if (x < g.left - r || x > g.left + g.plotWidth + r || y < g.top - r || y > g.top + g.plotHeight + r)
      continue;
    ctx.fillStyle = css(theme, marker.color, marker.opacity ?? 0.85);
    ctx.strokeStyle = css(theme, marker.color);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (marker.shape === 'triangle-up' || marker.shape === 'triangle-down') {
      const d = marker.shape === 'triangle-up' ? 1 : -1;
      ctx.moveTo(x, y - d * r);
      ctx.lineTo(x + r, y + d * r * 0.8);
      ctx.lineTo(x - r, y + d * r * 0.8);
      ctx.closePath();
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (marker.label && r >= 7) {
      ctx.font = `${theme.typography.markerSize}px ${theme.typography.numberFamily}`;
      ctx.fillStyle = theme.palette.textStrong;
      ctx.textAlign = 'left';
      ctx.fillText(marker.label, x + r + 3, y + theme.typography.markerSize * 0.35);
    }
  }
}
