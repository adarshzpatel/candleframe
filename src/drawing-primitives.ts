import type {
  Drawing,
  DrawingContext,
  DrawingOptionValue,
  DrawingToolDefinition,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
} from './drawing-types.ts';

/** Shared geometry and primitive builders for the built-in tool families. */

export type PathPrimitive = Extract<DrawingPrimitive, { kind: 'path' }>;
export type TextPrimitive = Extract<DrawingPrimitive, { kind: 'text' }>;

export const screen = (d: Drawing, c: DrawingContext): DrawingPoint[] =>
  d.points.map(p => ({ x: c.geometry.x(p.timeMs), y: c.geometry.y(p.price) }));
export const path = (
  points: DrawingPoint[],
  extra: Omit<PathPrimitive, 'kind' | 'points'> = {},
): DrawingPrimitive => ({ kind: 'path', points, ...extra });
export const text = (
  at: DrawingPoint,
  value: string,
  extra: Omit<TextPrimitive, 'kind' | 'at' | 'text'> = {},
): DrawingPrimitive => ({ kind: 'text', at, text: value, ...extra });
export const axisTag = (
  axis: 'price' | 'time',
  value: number,
  extra: { color?: string; text?: string } = {},
): DrawingPrimitive => ({ kind: 'axis', axis, value, ...extra });
export const add = (p: DrawingPoint, v: DrawingPoint, factor = 1): DrawingPoint => ({
  x: p.x + v.x * factor,
  y: p.y + v.y * factor,
});
export const midpoint = (a: DrawingPoint, b: DrawingPoint): DrawingPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export const rectangle = (a: DrawingPoint, b: DrawingPoint): DrawingPoint[] => [
  a,
  { x: b.x, y: a.y },
  b,
  { x: a.x, y: b.y },
];
export const fill = (points: DrawingPoint[], color: string, opacity?: number): DrawingPrimitive =>
  path(points, { closed: true, fill: color, width: 0, ...(opacity === undefined ? {} : { opacity }) });

/** Where a `fixedToPlot` drawing sits: `options.plotX`/`plotY` fractions, else its first anchor. */
export function plotPoint(d: Drawing, c: DrawingContext): DrawingPoint | undefined {
  const g = c.geometry,
    x = d.options?.plotX,
    y = d.options?.plotY;
  return typeof x === 'number' && typeof y === 'number'
    ? { x: g.left + x * g.plotWidth, y: g.top + y * g.plotHeight }
    : screen(d, c)[0];
}
/** The options that fix a drawing to screen point `p`, clamped inside the plot. */
export function plotOptions(p: DrawingPoint, c: DrawingContext): { plotX: number; plotY: number } {
  const g = c.geometry,
    fraction = (v: number) => (Number.isFinite(v) ? Number(Math.min(1, Math.max(0, v)).toFixed(4)) : 0);
  return { plotX: fraction((p.x - g.left) / g.plotWidth), plotY: fraction((p.y - g.top) / g.plotHeight) };
}

/** Parametric clipping also handles vertical lines, reversed rays and offscreen anchors. */
export function clipLine(
  a: DrawingPoint,
  b: DrawingPoint,
  c: DrawingContext,
  low = 0,
  high = 1,
): DrawingPoint[] {
  const g = c.geometry,
    dx = b.x - a.x,
    dy = b.y - a.y;
  if (![a.x, a.y, b.x, b.y, dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0)) return [];
  for (const [origin, direction, min, max] of [
    [a.x, dx, g.left, g.left + g.plotWidth],
    [a.y, dy, g.top, g.top + g.plotHeight],
  ]) {
    if (direction === 0) {
      if (origin < min || origin > max) return [];
      continue;
    }
    const first = (min - origin) / direction,
      second = (max - origin) / direction;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return [];
  }
  return [
    { x: a.x + dx * low, y: a.y + dy * low },
    { x: a.x + dx * high, y: a.y + dy * high },
  ];
}
export function line(
  a: DrawingPoint,
  b: DrawingPoint,
  c: DrawingContext,
  low = 0,
  high = 1,
  extra: Omit<PathPrimitive, 'kind' | 'points'> = {},
): DrawingPrimitive[] {
  const points = clipLine(a, b, c, low, high);
  return points.length ? [path(points, extra)] : [];
}
/** An open arrowhead at `tip`, pointing away from `from`, scaled with the stroke width. */
export function arrowHead(
  from: DrawingPoint,
  tip: DrawingPoint,
  width = 2,
  extra: Omit<PathPrimitive, 'kind' | 'points'> = {},
): DrawingPrimitive[] {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (!length) return [];
  const dx = (tip.x - from.x) / length,
    dy = (tip.y - from.y) / length,
    long = 8 + width * 2,
    wide = 4 + width;
  return [
    path(
      [
        { x: tip.x - dx * long - dy * wide, y: tip.y - dy * long + dx * wide },
        tip,
        { x: tip.x - dx * long + dy * wide, y: tip.y - dy * long - dx * wide },
      ],
      extra,
    ),
  ];
}
export function arrow(a: DrawingPoint, b: DrawingPoint, c: DrawingContext, width = 2): DrawingPrimitive[] {
  return [...line(a, b, c), ...arrowHead(a, b, width)];
}
/** Screen angle in degrees, counter-clockwise from the time axis like a protractor. */
export const angle = (a: DrawingPoint, b: DrawingPoint): number =>
  (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
export const signed = (value: number, format: (value: number) => string): string =>
  `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;

export function duration(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60000);
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  const parts = days
    ? [`${days}d`, hours && `${hours}h`]
    : hours
      ? [`${hours}h`, rest && `${rest}m`]
      : [`${rest}m`];
  return parts.filter(Boolean).join(' ');
}
/** Bar count between two times, respecting session gaps when the scale is not linear. */
export function bars(c: DrawingContext, from: number, to: number): number {
  const scale = c.geometry.timeScale;
  const count = scale && !scale.linear ? scale.bars(from, to) : (to - from) / c.intervalMs;
  return Number(count.toFixed(2));
}

/** Familiar Fibonacci hues by ratio, plus Gann's quarters; other ratios cycle through the same set. */
const FIB_COLORS: Record<string, string> = {
  '0': '#787b86',
  '0.236': '#f23645',
  '0.25': '#f23645',
  '0.382': '#ff9800',
  '0.5': '#4caf50',
  '0.618': '#089981',
  '0.75': '#00bcd4',
  '0.786': '#00bcd4',
  '1': '#787b86',
  '1.272': '#9c27b0',
  '1.414': '#f23645',
  '1.618': '#2962ff',
  '2': '#ff9800',
  '2.618': '#f23645',
  '3.618': '#9c27b0',
  '4.236': '#e91e63',
};
const FIB_CYCLE = ['#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0', '#e91e63'];
/** A level's built-in hue: the familiar colour for its ratio, else one from a cycle by position. */
export const fibLevelColor = (level: number, index: number): string =>
  FIB_COLORS[String(Number(level.toFixed(3)))] ?? FIB_CYCLE[index % FIB_CYCLE.length];
/**
 * A Fibonacci drawing's visible levels, in table order, with their colours. Uses `defaults` while
 * the drawing has no levels of its own. With a `levelColors` setting turned off, every level takes
 * the line colour.
 */
export function fibLevels(
  d: Drawing,
  defaults: readonly number[],
  settings?: DrawingToolDefinition['settings'],
): { level: number; color: string; index: number }[] {
  const oneColor = drawingOption<boolean>(d, { settings }, 'levelColors') === false;
  return (d.levels.length ? d.levels : defaults).flatMap((level, index) => {
    const look = d.levelStyles?.[index];
    if (look?.visible === false) return [];
    return [{ level, index, color: oneColor ? d.style.color : (look?.color ?? fibLevelColor(level, index)) }];
  });
}

/** Setting builders keep tool definitions short and their defaults in one place. */
export const toggle = (key: string, label: string, value: boolean, section?: string): DrawingSetting => ({
  key,
  label,
  kind: 'boolean',
  default: value,
  ...(section ? { section } : {}),
});
export const choice = (
  key: string,
  label: string,
  value: string,
  choices: readonly (readonly [string, string])[],
  section?: string,
): DrawingSetting => ({
  key,
  label,
  kind: 'select',
  default: value,
  choices: choices.map(([v, l]) => ({ value: v, label: l })),
  ...(section ? { section } : {}),
});

/** Reads a tool setting, falling back to its declared default. */
export function drawingOption<T extends DrawingOptionValue>(
  drawing: Pick<Drawing, 'options'>,
  definition: Pick<DrawingToolDefinition, 'settings'> | undefined,
  key: string,
): T {
  return (drawing.options?.[key] ?? definition?.settings?.find(s => s.key === key)?.default) as T;
}
