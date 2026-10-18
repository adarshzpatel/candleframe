import { choice, drawingOption, fill, line, path, screen, text, toggle } from './drawing-primitives.ts';
import type { Candle } from './types.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingHandle,
  DrawingOptionValue,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
  DrawingToolDefinition,
} from './drawing-types.ts';

/** Channels (Lines family) and cycles (Patterns family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */

const tool = (
  type: string,
  label: string,
  group: string,
  section: string,
  points: number,
  project: DrawingToolDefinition['project'],
  extra: Partial<Omit<DrawingToolDefinition, 'type' | 'label' | 'group' | 'points' | 'project'>> = {},
): DrawingToolDefinition => ({
  type,
  label,
  group,
  section,
  points,
  project,
  hint: `Click ${points} points to place.`,
  ...extra,
});

const color = (key: string, label: string, value: string, section: string): DrawingSetting => ({
  key,
  label,
  kind: 'color',
  default: value,
  section,
});
const deviation = (key: string, label: string, value: number): DrawingSetting => ({
  key,
  label,
  kind: 'number',
  default: value,
  min: -10,
  max: 10,
  step: 0.1,
  section: 'Inputs',
});

const REGRESSION_SETTINGS: readonly DrawingSetting[] = [
  choice(
    'source',
    'Source',
    'close',
    [
      ['close', 'Close'],
      ['open', 'Open'],
      ['high', 'High'],
      ['low', 'Low'],
      ['hl2', '(H + L) / 2'],
      ['hlc3', '(H + L + C) / 3'],
      ['ohlc4', '(O + H + L + C) / 4'],
    ],
    'Inputs',
  ),
  deviation('upperDeviation', 'Upper deviation', 2),
  deviation('lowerDeviation', 'Lower deviation', -2),
  color('baseColor', 'Base line', '#f23645', 'Style'),
  color('upperColor', 'Upper line', '', 'Style'),
  color('lowerColor', 'Lower line', '', 'Style'),
  toggle('background', 'Background', true, 'Style'),
  toggle('extendRight', 'Extend right', false, 'Style'),
  toggle('pearson', "Pearson's R", true, 'Style'),
];
const CHANNEL_SETTINGS: readonly DrawingSetting[] = [
  toggle('background', 'Background', true, 'Style'),
  toggle('extendLeft', 'Extend left', false, 'Style'),
  toggle('extendRight', 'Extend right', false, 'Style'),
];
const CYCLE_SETTINGS: readonly DrawingSetting[] = [toggle('background', 'Background', true, 'Style')];

const settingsByType = new Map<string, readonly DrawingSetting[]>([
  ['regression-trend', REGRESSION_SETTINGS],
  ['flat-top-bottom', CHANNEL_SETTINGS],
  ['disjoint-channel', CHANNEL_SETTINGS],
  ['time-cycles', CYCLE_SETTINGS],
]);
const option = <T extends DrawingOptionValue>(d: Drawing, key: string): T =>
  drawingOption<T>(d, { settings: settingsByType.get(d.type) }, key);

const sourceValue = (candle: Candle, source: string): number =>
  source === 'open'
    ? candle.open
    : source === 'high'
      ? candle.high
      : source === 'low'
        ? candle.low
        : source === 'hl2'
          ? (candle.high + candle.low) / 2
          : source === 'hlc3'
            ? (candle.high + candle.low + candle.close) / 3
            : source === 'ohlc4'
              ? (candle.open + candle.high + candle.low + candle.close) / 4
              : candle.close;

/** First index whose candle opens at or after `timeMs`, or after it when `after` is set. */
function search(candles: readonly Candle[], timeMs: number, after: boolean): number {
  let lo = 0,
    hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (after ? candles[mid].timeMs <= timeMs : candles[mid].timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RegressionFit {
  /** Indices of the first and last candle inside the range. */
  first: number;
  last: number;
  /** Price at the first candle and change per bar. */
  intercept: number;
  slope: number;
  /** Standard deviation of the residuals around the fitted line. */
  deviation: number;
  /** Pearson's correlation between bar index and price, 0 for a flat series. */
  pearson: number;
}
/**
 * Least-squares line through the source price of every candle between two times. The fit runs
 * on bar index rather than time, so session gaps do not bend the slope. Fewer than two candles
 * have no fit.
 */
export function regression(
  candles: readonly Candle[],
  fromMs: number,
  toMs: number,
  source = 'close',
): RegressionFit | null {
  const first = search(candles, Math.min(fromMs, toMs), false),
    last = search(candles, Math.max(fromMs, toMs), true) - 1,
    n = last - first + 1;
  if (n < 2) return null;
  const values = candles.slice(first, last + 1).map(candle => sourceValue(candle, source));
  // Centred sums keep precision at large prices.
  const meanX = (n - 1) / 2,
    meanY = values.reduce((sum, y) => sum + y, 0) / n;
  let xx = 0,
    xy = 0,
    yy = 0;
  values.forEach((y, x) => {
    xx += (x - meanX) ** 2;
    xy += (x - meanX) * (y - meanY);
    yy += (y - meanY) ** 2;
  });
  const slope = xy / xx,
    intercept = meanY - slope * meanX;
  const residuals = values.reduce((sum, y, x) => sum + (y - intercept - slope * x) ** 2, 0);
  return {
    first,
    last,
    intercept,
    slope,
    deviation: Math.sqrt(residuals / n),
    pearson: yy > 0 ? xy / Math.sqrt(xx * yy) : 0,
  };
}

/** Screen x is linear in bar index on both time scales, so the fit maps through the end candles. */
function regressionFrame(d: Drawing, c: DrawingContext) {
  const fit =
    c.candles && regression(c.candles, d.points[0].timeMs, d.points[1].timeMs, option<string>(d, 'source'));
  if (!fit) return null;
  const x0 = c.geometry.x(c.candles![fit.first].timeMs),
    x1 = c.geometry.x(c.candles![fit.last].timeMs);
  if (!(x1 > x0)) return null;
  const bars = fit.last - fit.first;
  const at = (x: number, sigmas = 0): DrawingPoint => {
    const index = ((x - x0) / (x1 - x0)) * bars;
    return { x, y: c.geometry.y(fit.intercept + fit.slope * index + sigmas * fit.deviation) };
  };
  return { fit, x0, x1, at };
}
function regressionTrend(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!b) return [];
  const frame = regressionFrame(d, c);
  if (!frame) return line(a, b, c);
  const { fit, x0, x1, at } = frame,
    g = c.geometry;
  const from = Math.max(x0, g.left),
    to = Math.min(option(d, 'extendRight') ? Infinity : x1, g.left + g.plotWidth);
  if (from > to) return [];
  // Straight in price, so a log scale needs samples to show the curve.
  const steps = g.log ? Math.min(200, Math.max(1, Math.ceil((to - from) / 6))) : 1;
  const curve = (sigmas: number) =>
    Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps, sigmas));
  const upper = curve(option<number>(d, 'upperDeviation')),
    base = curve(0),
    lower = curve(option<number>(d, 'lowerDeviation'));
  const baseColor = option<string>(d, 'baseColor') || d.style.color,
    upperColor = option<string>(d, 'upperColor') || d.style.color,
    lowerColor = option<string>(d, 'lowerColor') || d.style.color;
  const result: DrawingPrimitive[] = option(d, 'background')
    ? [
        fill([...upper, ...[...base].reverse()], upperColor),
        fill([...base, ...[...lower].reverse()], baseColor),
      ]
    : [];
  result.push(
    path(upper, { color: upperColor }),
    path(lower, { color: lowerColor }),
    path(base, { color: baseColor, dash: [6, 4] }),
  );
  if (option(d, 'pearson')) {
    const start = lower[0],
      below = Math.max(start.y, upper[0].y);
    result.push(
      text({ x: start.x + 4, y: below + 18 }, fit.pearson.toFixed(4), { color: lowerColor, plain: true }),
    );
  }
  return result;
}
/** Each anchor's handle sits on the base line at the matching end, and drags in time only. */
function regressionHandles(d: Drawing, c: DrawingContext): DrawingHandle[] {
  const raw = screen(d, c);
  const frame = raw.length === 2 ? regressionFrame(d, c) : null;
  return raw.map((p, i) => {
    const later = d.points[i].timeMs > d.points[1 - i]?.timeMs;
    return { id: String(i), at: frame ? frame.at(later ? frame.x1 : frame.x0) : p, cursor: 'ew-resize' };
  });
}
function moveTime(d: Drawing, handle: string, anchor: { timeMs: number }) {
  return d.points.map((p, i) =>
    String(i) === handle ? { timeMs: anchor.timeMs, price: p.price } : { ...p },
  );
}

/**
 * A trend line from the first two anchors and a second line drawn by `other`, spanning the same
 * time range and filled between. Extending stretches both lines to the plot edge.
 */
function twoLines(
  d: Drawing,
  c: DrawingContext,
  other: (left: DrawingPoint, right: DrawingPoint, x: number) => number,
): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c),
    g = c.geometry;
  if (!b) return [];
  if (!third || a.x === b.x) return line(a, b, c);
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  const trend = (x: number) => left.y + ((x - left.x) / (right.x - left.x)) * (right.y - left.y);
  const x1 = option(d, 'extendLeft') ? Math.min(left.x, g.left) : left.x,
    x2 = option(d, 'extendRight') ? Math.max(right.x, g.left + g.plotWidth) : right.x;
  const first = [
      { x: x1, y: trend(x1) },
      { x: x2, y: trend(x2) },
    ],
    second = [
      { x: x1, y: other(left, right, x1) },
      { x: x2, y: other(left, right, x2) },
    ];
  return [
    ...(option(d, 'background') ? [fill([first[0], first[1], second[1], second[0]], d.style.color)] : []),
    ...line(first[0], first[1], c),
    ...line(second[0], second[1], c),
  ];
}
/** The third anchor sets the flat line's price; its time is ignored. */
const flat = (d: Drawing, c: DrawingContext) => twoLines(d, c, () => c.geometry.y(d.points[2].price));
/** The second line passes through the third anchor with the trend line's slope reversed. */
function mirror(d: Drawing, c: DrawingContext) {
  const third = screen(d, c)[2];
  return twoLines(d, c, (left, right, x) => {
    const slope = (right.y - left.y) / (right.x - left.x);
    return third.y - slope * (x - third.x);
  });
}
/** Trend anchors keep raw handles; the second line has one handle at each end. */
function secondLineHandles(lineY: (d: Drawing, c: DrawingContext, x: number) => number) {
  return (d: Drawing, c: DrawingContext): DrawingHandle[] => {
    const raw = screen(d, c),
      handles: DrawingHandle[] = raw.slice(0, 2).map((at, id) => ({ id, at, cursor: 'move' }));
    if (raw.length < 3 || raw[0].x === raw[1].x) return handles;
    for (const i of [0, 1])
      handles.push({ id: `line-${i}`, at: { x: raw[i].x, y: lineY(d, c, raw[i].x) }, cursor: 'ns-resize' });
    return handles;
  };
}
const flatHandles = secondLineHandles((d, c) => c.geometry.y(d.points[2].price));
const mirrorHandles = secondLineHandles((d, c, x) => {
  const [a, b, third] = screen(d, c);
  return third.y - ((b.y - a.y) / (b.x - a.x)) * (x - third.x);
});
/** Moves the third anchor to the dragged price. The mirror line pins it to that end's time. */
const moveSecondLine =
  (pinTime: boolean) => (d: Drawing, handle: string, anchor: { timeMs: number; price: number }) => {
    const end = d.points[handle === 'line-1' ? 1 : 0];
    return d.points.map((p, i) =>
      i === 2 ? { timeMs: pinTime ? end.timeMs : p.timeMs, price: anchor.price } : { ...p },
    );
  };

/** First repeat whose span reaches the plot, so far-off cycles are skipped rather than walked. */
function firstCycle(c: DrawingContext, origin: number, step: number, span: number): number {
  const g = c.geometry,
    near = step > 0 ? g.left : g.left + g.plotWidth;
  return Math.max(0, Math.ceil((near - origin) / step - span));
}
const MAX_CYCLES = 500;
function cyclicLines(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!a) return [];
  const vertical = (x: number) => line({ x, y: g.top }, { x, y: g.top + g.plotHeight }, c);
  if (!b) return vertical(a.x);
  const step = b.x - a.x;
  // Closer than two pixels the repeats would merge into a solid block.
  if (Math.abs(step) < 2) return [...vertical(a.x), ...vertical(b.x)];
  const result = [path([a, b], { dash: [4, 4], width: 1, opacity: 0.6 })],
    far = step > 0 ? g.left + g.plotWidth : g.left;
  for (let k = firstCycle(c, a.x, step, 0), n = 0; n < MAX_CYCLES; k++, n++) {
    const x = a.x + k * step;
    if (step > 0 ? x > far : x < far) break;
    result.push(...vertical(x));
  }
  return result;
}
/** Half circles on the first anchor's price, each as wide as the anchor spacing. */
function timeCycles(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!b) return [];
  const step = b.x - a.x;
  if (Math.abs(step) < 2) return [];
  const radius = Math.abs(step) / 2,
    segments = Math.min(48, Math.max(8, Math.ceil(radius / 4))),
    far = step > 0 ? g.left + g.plotWidth : g.left,
    background = option(d, 'background'),
    result: DrawingPrimitive[] = [];
  for (let k = firstCycle(c, a.x, step, 1), n = 0; n < MAX_CYCLES; k++, n++) {
    const start = a.x + k * step;
    if (step > 0 ? start > far : start < far) break;
    const center = start + step / 2;
    const arc = Array.from({ length: segments + 1 }, (_, i) => {
      const t = (i / segments) * Math.PI;
      return { x: center - Math.sign(step) * radius * Math.cos(t), y: a.y - radius * Math.sin(t) };
    });
    if (background) result.push(fill(arc, d.style.color));
    result.push(path(arc));
  }
  return result;
}
function timeCycleHandles(d: Drawing, c: DrawingContext): DrawingHandle[] {
  const [a, b] = screen(d, c);
  return [
    { id: 0, at: a, cursor: 'move' },
    ...(b ? [{ id: '1', at: { x: b.x, y: a.y }, cursor: 'ew-resize' as const }] : []),
  ];
}
/** A cosine through both anchors: the first is a crest or trough, the second the next opposite one. */
function sineLine(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!b) return [];
  const half = b.x - a.x;
  if (Math.abs(half) < 1) return line(a, b, c);
  const middle = (a.y + b.y) / 2,
    amplitude = (a.y - b.y) / 2;
  const step = Math.max(g.plotWidth / 2000, Math.min(4, Math.abs(half) / 12)),
    count = Math.ceil(g.plotWidth / step);
  return [
    path(
      Array.from({ length: count + 1 }, (_, i) => {
        const x = g.left + i * step;
        return { x, y: middle + amplitude * Math.cos((Math.PI * (x - a.x)) / half) };
      }),
    ),
  ];
}

/** Channels after the parallel channel. */
export const channelTools: readonly DrawingToolDefinition[] = [
  tool('regression-trend', 'Regression trend', 'Lines', 'Channels', 2, regressionTrend, {
    hint: 'Click the first bar, then the last bar of the range.',
    settings: REGRESSION_SETTINGS,
    handles: regressionHandles,
    moveHandle: moveTime,
  }),
  tool('flat-top-bottom', 'Flat top/bottom', 'Lines', 'Channels', 3, flat, {
    hint: 'Click two trend points, then the flat level.',
    settings: CHANNEL_SETTINGS,
    handles: flatHandles,
    moveHandle: moveSecondLine(false),
  }),
  tool('disjoint-channel', 'Disjoint channel', 'Lines', 'Channels', 3, mirror, {
    hint: 'Click two trend points, then a point on the mirrored line.',
    settings: CHANNEL_SETTINGS,
    handles: mirrorHandles,
    moveHandle: moveSecondLine(true),
  }),
];
/** Cycles. */
export const cycleTools: readonly DrawingToolDefinition[] = [
  tool('cyclic-lines', 'Cyclic lines', 'Patterns', 'Cycles', 2, cyclicLines, {
    hint: 'Click the first cycle, then the next one.',
  }),
  tool('time-cycles', 'Time cycles', 'Patterns', 'Cycles', 2, timeCycles, {
    hint: 'Click the start of a cycle, then its end.',
    settings: CYCLE_SETTINGS,
    handles: timeCycleHandles,
    moveHandle: moveTime,
  }),
  tool('sine-line', 'Sine line', 'Patterns', 'Cycles', 2, sineLine, {
    hint: 'Click a crest or trough, then the next opposite one.',
  }),
];
/** 24-unit SVG paths keyed by tool type. */
export const channelsIcons: Readonly<Record<string, string>> = {
  'regression-trend': '<path d="m3 12 18-7M3 20l18-7"/><path d="m3 16 18-7" stroke-dasharray="2 2"/>',
  'flat-top-bottom': '<path d="M3 6h18M3 19l18-8"/>',
  'disjoint-channel': '<path d="m3 10 18-6M3 14l18 6"/>',
  'cyclic-lines': '<path d="M3 4v16M9 4v16M15 4v16M21 4v16"/>',
  'time-cycles': '<path d="M2 17a5 5 0 0 1 10 0 5 5 0 0 1 10 0"/>',
  'sine-line': '<path d="M2 12c1.7-6 3.3-6 5 0s3.3 6 5 0 3.3-6 5 0 3.3 6 5 0"/>',
};
