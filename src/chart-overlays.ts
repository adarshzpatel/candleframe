import { ChartError } from './errors.ts';
import type { ChartGeometry } from './geometry.ts';
import { colorRGBA, themeColor, themeColorCSS, type ChartTheme, type ResolvedChartTheme } from './themes.ts';
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
  /** Names the line in drag and close events. Required with `drag` or `closable`. */
  id?: string;
  /**
   * Shown in its own box after the label, such as an order's size. With `quantity` or
   * `closable` the tag is segmented, `[label][quantity][×]`, and the price moves to a
   * tag on the price axis.
   */
  quantity?: string;
  /** Adds a × box; clicking it reports a `close` action for the host to act on. */
  closable?: boolean;
  /**
   * Lets the user drag the line. `move` drags the line itself, such as a working order.
   * `copy` leaves it in place and drags out a new line, such as a target from a
   * position's entry. The chart only reports the drag; the host decides what it means.
   */
  drag?: 'move' | 'copy';
}

/** A drag of a price line. Prices snap to the instrument's tick size. */
export interface PriceLineDragEvent {
  id: string;
  phase: 'start' | 'move' | 'end' | 'cancel';
  mode: 'move' | 'copy';
  /** The line's price when the drag started. */
  fromPrice: number;
  price: number;
}

/** Gap between a segmented tag and the right edge of the plot, in pixels. */
const SEGMENTED_INSET = 86;

/** A click on a price line's × box. */
export interface PriceLineActionEvent {
  id: string;
  action: 'close';
}
export type PriceLineActionListener = (event: PriceLineActionEvent) => void;

/** Where a line's × box was drawn, for hit testing clicks. */
export interface PriceLineCloseBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Receives price line drags. Returning a string on `start` or `move` labels the line
 * being dragged, such as "TP +$40".
 */
export type PriceLineDragListener = (event: PriceLineDragEvent) => string | void;

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
  /** One or two characters drawn inside a circle marker, such as B or S for fills. */
  glyph?: string;
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
    if (line.drag !== undefined && (!['move', 'copy'].includes(line.drag) || !line.id))
      throw new ChartError('INVALID_INPUT', 'drag must be move or copy, with an id', { path: `${i}.drag` });
    if (line.closable && !line.id)
      throw new ChartError('INVALID_INPUT', 'a closable line needs an id', { path: `${i}.closable` });
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

/**
 * Text color for a tag filled with `color`: the theme's background on light fills,
 * its strongest text on dark ones, whichever reads better (relative luminance).
 */
function tagText(theme: ResolvedChartTheme, color: string | undefined): string {
  const [r, g, b] = colorRGBA(themeColor(theme, color ?? '@accent')).map(c =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.3 ? '#0b0e11' : '#ffffff';
}

const css = (theme: Pick<ChartTheme, 'palette'>, color: string | undefined, opacity = 1) =>
  themeColorCSS(theme, color ?? '@accent', opacity);

/** The draggable line within `slop` pixels of `y`, nearest first. */
export function hitPriceLine(
  lines: readonly PriceLine[],
  g: ChartGeometry,
  x: number,
  y: number,
  slop = 6,
): PriceLine | null {
  if (x < g.left || x > g.left + g.plotWidth) return null;
  let best: PriceLine | null = null;
  let nearest = slop;
  for (const line of lines) {
    if (!line.drag) continue;
    const distance = Math.abs(g.y(line.price) - y);
    if (distance <= nearest) {
      nearest = distance;
      best = line;
    }
  }
  return best;
}

/**
 * Price lines across the plot. A plain line gets one tag with its label and price. A
 * line with `quantity` or `closable` gets a segmented tag, `[label][quantity][×]`, at
 * the right of the plot and its price in a tag on the price axis. Returns where each
 * × box was drawn.
 */
export function renderPriceLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly PriceLine[],
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  formatPrice: (price: number) => string,
): PriceLineCloseBox[] {
  const boxes: PriceLineCloseBox[] = [];
  const pad = theme.chart.markerPadding;
  const size = theme.typography.markerSize;
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
    ctx.textAlign = 'left';
    if (line.quantity === undefined && !line.closable) {
      // The tag sits at the right edge of the plot, so it never covers the axis prices.
      const text = line.label ? `${line.label}  ${formatPrice(line.price)}` : formatPrice(line.price);
      const height = theme.chart.markerHeight;
      ctx.font = `${size}px ${theme.typography.numberFamily}`;
      const w = ctx.measureText(text).width + pad * 2;
      const x = g.left + g.plotWidth - w - 4;
      ctx.fillStyle = css(theme, line.color);
      ctx.fillRect(x, y - height / 2, w, height);
      ctx.fillStyle = tagText(theme, line.color);
      ctx.fillText(text, x + pad, y + size * 0.35);
      continue;
    }
    // Segmented: a filled label, then boxes outlined in the line's color.
    // Same height as plain tags, with slightly smaller text so the boxes stay compact.
    const height = theme.chart.markerHeight;
    const tagSize = Math.max(9, Math.round(size * 0.92));
    const top = y - height / 2;
    const bold = `600 ${tagSize}px ${theme.typography.numberFamily}`;
    const regular = `${tagSize}px ${theme.typography.numberFamily}`;
    ctx.font = bold;
    const labelWidth = line.label ? ctx.measureText(line.label).width + pad * 2 : 0;
    ctx.font = regular;
    const quantityWidth = line.quantity !== undefined ? ctx.measureText(line.quantity).width + pad * 2 : 0;
    const closeWidth = line.closable ? height : 0;
    // Set in from the right edge, clear of the newest bars and the price axis.
    let x = g.left + g.plotWidth - SEGMENTED_INSET - labelWidth - quantityWidth - closeWidth;
    if (labelWidth) {
      ctx.fillStyle = css(theme, line.color);
      ctx.fillRect(x, top, labelWidth, height);
      ctx.font = bold;
      ctx.fillStyle = tagText(theme, line.color);
      ctx.fillText(line.label!, x + pad, y + tagSize * 0.35);
      x += labelWidth;
    }
    const boxed = (width: number, draw: (left: number) => void) => {
      ctx.fillStyle = theme.palette.background;
      ctx.fillRect(x, top, width, height);
      ctx.strokeStyle = css(theme, line.color);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1);
      draw(x);
      x += width;
    };
    if (quantityWidth)
      boxed(quantityWidth, left => {
        ctx.font = regular;
        ctx.fillStyle = theme.palette.textStrong;
        ctx.fillText(line.quantity!, left + pad, y + tagSize * 0.35);
      });
    if (closeWidth)
      boxed(closeWidth, left => {
        const c = left + closeWidth / 2;
        const r = height * 0.16;
        ctx.strokeStyle = theme.palette.textStrong;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(c - r, y - r);
        ctx.lineTo(c + r, y + r);
        ctx.moveTo(c + r, y - r);
        ctx.lineTo(c - r, y + r);
        ctx.stroke();
        boxes.push({ id: line.id!, x: left, y: top, width: closeWidth, height });
      });
    // The price, on the axis.
    ctx.font = `${size}px ${theme.typography.numberFamily}`;
    const priceText = formatPrice(line.price);
    const axisX = g.left + g.plotWidth + 1;
    const priceWidth = ctx.measureText(priceText).width + pad * 2;
    ctx.fillStyle = css(theme, line.color);
    ctx.fillRect(axisX, y - theme.chart.markerHeight / 2, priceWidth, theme.chart.markerHeight);
    ctx.fillStyle = tagText(theme, line.color);
    ctx.fillText(priceText, axisX + pad, y + size * 0.35);
  }
  return boxes;
}

/** The × box under a point, if any. */
export function hitCloseBox(
  boxes: readonly PriceLineCloseBox[],
  x: number,
  y: number,
): PriceLineCloseBox | null {
  return boxes.find(b => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) ?? null;
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
    if (marker.glyph && marker.shape !== 'triangle-up' && marker.shape !== 'triangle-down') {
      ctx.font = `700 ${Math.round(r * 1.1)}px ${theme.typography.numberFamily}`;
      ctx.fillStyle = tagText(theme, marker.color);
      ctx.textAlign = 'center';
      ctx.fillText(marker.glyph, x, y + r * 0.38);
    }
    if (marker.label && r >= 7) {
      ctx.font = `${theme.typography.markerSize}px ${theme.typography.numberFamily}`;
      ctx.fillStyle = theme.palette.textStrong;
      ctx.textAlign = 'left';
      ctx.fillText(marker.label, x + r + 3, y + theme.typography.markerSize * 0.35);
    }
  }
}
