import { ChartError } from './errors.ts';
import {
  createPosition,
  movePositionHandle,
  positionHandles,
  positionMetrics,
  positionOutcome,
} from './position-drawing.ts';
import { themeTokenDefaults } from './theme-tokens.ts';
import type { Anchor } from './types.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingPoint,
  DrawingPrimitive,
  DrawingStyle,
  DrawingToolDefinition,
} from './drawing-types.ts';

export const DEFAULT_DRAWING_STYLE: Readonly<DrawingStyle> = Object.freeze({
  color: '#a9c4ff',
  width: 2,
  lineStyle: 'solid',
  fillOpacity: 0.12,
  fontSize: 12,
});

const RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const EXTENSION = [0, 0.618, 1, 1.618, 2.618];
const FAN = [0.382, 0.5, 0.618, 1];
const TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34];
const defaultsFor = (type: string): number[] =>
  type === 'fib-time-zone'
    ? TIME_ZONES
    : type === 'fib-extension'
      ? EXTENSION
      : type === 'fib-fan'
        ? FAN
        : type.startsWith('fib-')
          ? RETRACEMENT
          : [];
const levelsFor = (d: Drawing): number[] => (d.levels.length ? d.levels : defaultsFor(d.type));
const screen = (d: Drawing, c: DrawingContext): DrawingPoint[] =>
  d.points.map(p => ({ x: c.geometry.x(p.timeMs), y: c.geometry.y(p.price) }));
const path = (
  points: DrawingPoint[],
  extra: Omit<Extract<DrawingPrimitive, { kind: 'path' }>, 'kind' | 'points'> = {},
): DrawingPrimitive => ({ kind: 'path', points, ...extra });
const text = (
  at: DrawingPoint,
  value: string,
  extra: Omit<Extract<DrawingPrimitive, { kind: 'text' }>, 'kind' | 'at' | 'text'> = {},
): DrawingPrimitive => ({ kind: 'text', at, text: value, ...extra });
const add = (p: DrawingPoint, v: DrawingPoint, factor = 1): DrawingPoint => ({
  x: p.x + v.x * factor,
  y: p.y + v.y * factor,
});
const midpoint = (a: DrawingPoint, b: DrawingPoint): DrawingPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const rectangle = (a: DrawingPoint, b: DrawingPoint): DrawingPoint[] => [
  a,
  { x: b.x, y: a.y },
  b,
  { x: a.x, y: b.y },
];

/** Parametric clipping also handles vertical lines, reversed rays and offscreen anchors. */
function clipLine(a: DrawingPoint, b: DrawingPoint, c: DrawingContext, low = 0, high = 1): DrawingPoint[] {
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
function line(
  a: DrawingPoint,
  b: DrawingPoint,
  c: DrawingContext,
  low = 0,
  high = 1,
  extra = {},
): DrawingPrimitive[] {
  const points = clipLine(a, b, c, low, high);
  return points.length ? [path(points, extra)] : [];
}
function arrow(a: DrawingPoint, b: DrawingPoint, c: DrawingContext): DrawingPrimitive[] {
  const result = line(a, b, c),
    length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return result;
  const dx = (b.x - a.x) / length,
    dy = (b.y - a.y) / length;
  result.push(
    path([
      { x: b.x - dx * 10 - dy * 5, y: b.y - dy * 10 + dx * 5 },
      b,
      { x: b.x - dx * 10 + dy * 5, y: b.y - dy * 10 - dx * 5 },
    ]),
  );
  return result;
}
function lineTool(type: string): DrawingToolDefinition['project'] {
  return (d, c) => {
    const [a, b] = screen(d, c),
      g = c.geometry;
    if (!a) return [];
    const horizontal = () =>
      type === 'horizontal-ray'
        ? line(a, { x: a.x + 1, y: a.y }, c, 0, Infinity)
        : line({ x: g.left, y: a.y }, { x: g.left + g.plotWidth, y: a.y }, c);
    const vertical = () => line({ x: a.x, y: g.top }, { x: a.x, y: g.top + g.plotHeight }, c);
    if (type === 'horizontal-line' || type === 'horizontal-ray') return horizontal();
    if (type === 'vertical-line') return vertical();
    if (type === 'cross-line') return [...horizontal(), ...vertical()];
    if (!b) return [];
    if (type === 'arrow') return arrow(a, b, c);
    return line(
      a,
      b,
      c,
      type === 'extended-line' ? -Infinity : 0,
      type === 'ray' || type === 'extended-line' ? Infinity : 1,
    );
  };
}

/** Keep the first two time coordinates fixed; the third point lies on the opposite rail. */
function channelOffset(a: DrawingPoint, b: DrawingPoint, third: DrawingPoint): DrawingPoint {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (!dx) return { x: third.x - a.x, y: 0 };
  return { x: 0, y: third.y - a.y - ((third.x - a.x) / dx) * dy };
}
function channel(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c);
  if (!third) return b ? line(a, b, c) : [];
  const offset = channelOffset(a, b, third),
    topA = add(a, offset),
    topB = add(b, offset);
  const result: DrawingPrimitive[] = [
    path([a, b, topB, topA], { closed: true, fill: d.style.color, opacity: d.style.fillOpacity, width: 0 }),
  ];
  if (d.type === 'fib-channel') {
    for (const level of levelsFor(d)) {
      const start = add(a, offset, level),
        end = add(b, offset, level);
      result.push(...line(start, end, c), text(end, `${(level * 100).toFixed(1)}%`, { align: 'right' }));
    }
  } else {
    result.push(
      ...line(a, b, c),
      ...line(topA, topB, c),
      ...line(add(a, offset, 0.5), add(b, offset, 0.5), c, 0, 1, { dash: [5, 4] }),
    );
  }
  return result;
}
function pitchfork(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [first, b, third] = screen(d, c);
  if (!third) return b ? line(first, b, c) : [];
  const a = d.type === 'schiff-pitchfork' ? { x: first.x, y: (first.y + b.y) / 2 } : first;
  const center = midpoint(b, third),
    direction = { x: center.x - a.x, y: center.y - a.y };
  return [
    ...line(a, center, c, 0, Infinity),
    ...line(b, add(b, direction), c, 0, Infinity),
    ...line(third, add(third, direction), c, 0, Infinity),
    ...line(b, third, c, 0, 1, { dash: [4, 4] }),
  ];
}
function fibonacci(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c),
    [a, b, third] = points,
    g = c.geometry;
  if (!b) return [];
  const result: DrawingPrimitive[] = [];
  if (d.type === 'fib-time-zone') {
    for (const level of levelsFor(d)) {
      const x = a.x + (b.x - a.x) * level;
      result.push(
        ...line({ x, y: g.top }, { x, y: g.top + g.plotHeight }, c),
        text({ x: x + 3, y: g.top + 15 }, `${level}`),
      );
    }
    return result;
  }
  if (d.type === 'fib-fan') {
    for (const level of levelsFor(d)) {
      const end = { x: b.x, y: a.y + (b.y - a.y) * level };
      result.push(
        ...line(a, end, c, 0, Infinity),
        text(end, `${(level * 100).toFixed(1)}%`, { align: 'right' }),
      );
    }
    return result;
  }
  if (d.type === 'fib-extension' && !third) return line(a, b, c);
  const left = Math.min(...points.map(p => p.x)),
    right = Math.max(...points.map(p => p.x));
  const origin = d.type === 'fib-extension' ? d.points[2].price : d.points[0].price;
  const difference = d.points[1].price - d.points[0].price;
  for (const level of levelsFor(d)) {
    const price = origin + difference * level,
      y = g.y(price);
    result.push(
      ...line({ x: left, y }, { x: right, y }, c),
      text({ x: right - 3, y: y - 4 }, `${(level * 100).toFixed(1)}%  ${c.formatPrice(price)}`, {
        align: 'right',
      }),
    );
  }
  return result;
}
function shape(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c),
    [a, b] = points;
  if (!b) return [];
  if (d.type === 'brush' || d.type === 'polyline') return [path(points)];
  if (d.type === 'highlighter')
    return [path(points, { width: Math.max(8, d.style.width * 4), opacity: 0.3 })];
  let outline = points;
  if (d.type === 'rectangle') outline = rectangle(a, b);
  if (d.type === 'ellipse') {
    const center = midpoint(a, b),
      rx = Math.abs(b.x - a.x) / 2,
      ry = Math.abs(b.y - a.y) / 2;
    outline = Array.from({ length: 64 }, (_, i) => ({
      x: center.x + rx * Math.cos((i / 64) * Math.PI * 2),
      y: center.y + ry * Math.sin((i / 64) * Math.PI * 2),
    }));
  }
  return [
    path(outline, { closed: true, fill: d.style.color, opacity: d.style.fillOpacity, width: 0 }),
    path(outline, { closed: true }),
  ];
}
function annotation(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!a) return [];
  if (d.type === 'price-label')
    return [text(a, `${d.text ? `${d.text} · ` : ''}${c.formatPrice(d.points[0].price)}`, {})];
  if (d.type === 'callout' && b) return [...arrow(b, a, c), text(b, d.text, {})];
  return [text(a, d.text)];
}
function durationLabel(d: Drawing, c: DrawingContext): string {
  const ms = Math.abs(d.points[1].timeMs - d.points[0].timeMs),
    bars =
      c.geometry.timeScale && !c.geometry.timeScale.linear
        ? Math.abs(c.geometry.timeScale.bars(d.points[0].timeMs, d.points[1].timeMs))
        : ms / c.intervalMs;
  const duration =
    ms >= 86400000
      ? `${(ms / 86400000).toFixed(2)} d`
      : ms >= 3600000
        ? `${(ms / 3600000).toFixed(2)} h`
        : `${(ms / 60000).toFixed(2)} min`;
  return `${Number(bars.toFixed(2))} bars · ${duration}`;
}
function measurement(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!b) return [];
  const middle = midpoint(a, b),
    delta = d.points[1].price - d.points[0].price;
  const prices = `${delta >= 0 ? '+' : ''}${c.formatPrice(delta)} (${((delta / d.points[0].price) * 100).toFixed(2)}%)`;
  const diagonal = path([a, b], {
    dash: [...(c.theme?.chart.measurementDash ?? themeTokenDefaults.chart.measurementDash)],
  });
  if (d.type === 'price-range')
    return [
      diagonal,
      path([
        { x: middle.x - 6, y: a.y },
        { x: middle.x + 6, y: a.y },
      ]),
      path([
        { x: middle.x, y: a.y },
        { x: middle.x, y: b.y },
      ]),
      path([
        { x: middle.x - 6, y: b.y },
        { x: middle.x + 6, y: b.y },
      ]),
      text({ x: middle.x + 9, y: middle.y }, prices, {}),
    ];
  if (d.type === 'date-range')
    return [
      diagonal,
      path([
        { x: a.x, y: middle.y - 6 },
        { x: a.x, y: middle.y + 6 },
      ]),
      path([
        { x: a.x, y: middle.y },
        { x: b.x, y: middle.y },
      ]),
      path([
        { x: b.x, y: middle.y - 6 },
        { x: b.x, y: middle.y + 6 },
      ]),
      text({ x: middle.x, y: middle.y - 9 }, durationLabel(d, c), { align: 'center' }),
    ];
  return [
    path(rectangle(a, b), { closed: true, fill: d.style.color, opacity: d.style.fillOpacity, width: 0 }),
    path(rectangle(a, b), { closed: true }),
    diagonal,
    text(middle, `${prices}\n${durationLabel(d, c)}`, { align: 'center' }),
  ];
}
function position(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [entry, target, stop] = screen(d, c);
  if (!target || !stop) return [];
  const g = c.geometry,
    right = target.x,
    x = (entry.x + right) / 2,
    metrics = positionMetrics(d),
    [entryPrice, targetPrice, stopPrice] = d.points.map(p => p.price);
  const gain = c.theme?.palette.positive ?? '#65d9a0',
    loss = c.theme?.palette.negative ?? '#ed7979',
    ink = c.theme?.palette.background ?? '#0b0f14';
  const region = (end: DrawingPoint, color: string): DrawingPrimitive[] => [
    path(rectangle(entry, { x: right, y: end.y }), { closed: true, fill: color, width: 0 }),
    path(rectangle(entry, { x: right, y: end.y }), {
      closed: true,
      color,
      width: d.style.width / 2,
      opacity: 0.65,
    }),
  ];
  const size = d.style.fontSize,
    padding = c.theme?.chart.annotationPadding ?? 6;
  const outside = (y: number) =>
    y < entry.y
      ? Math.max(g.top + size + padding, y - 10)
      : Math.min(g.top + g.plotHeight - padding, y + size + padding + 5);
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${c.formatPrice(Math.abs(value))}`;
  const percent = (value: number) => `${((value / entryPrice) * 100).toFixed(2)}%`;
  const ticks = (value: number) =>
    c.tickSize ? `  ·  ${Math.round(Math.abs(value) / c.tickSize)} ticks` : '';
  const pill = { align: 'center' as const, color: ink, radius: 4 };
  const font = `${size}px ${c.theme?.typography.annotationFamily ?? 'monospace'}`;
  const measure = (value: string) =>
    Math.max(...value.split('\n').map(line => c.measureText?.(line, font) ?? line.length * size * 0.62)) +
    padding * 2;
  // Keeps centred labels inside the plot when the plan is narrow or partly offscreen.
  const fit = (value: string, y: number): DrawingPoint => {
    const half = measure(value) / 2;
    return { x: Math.max(g.left + half, Math.min(g.left + g.plotWidth - half, x)), y };
  };
  const level = (name: string, price: number, distance: number) => {
    const head = `${name} ${c.formatPrice(price)}`,
      tail = `${signed(distance)} (${percent(Math.abs(distance))})${ticks(distance)}`,
      line = `${head}  ·  ${tail}`;
    return measure(line) > g.plotWidth ? `${head}\n${tail}` : line;
  };
  const side = d.type === 'long-position' ? 'LONG' : 'SHORT';
  const summary = `${side} ${c.formatPrice(entryPrice)}  ·  R/R ${metrics.ratio.toFixed(2)}`;
  const scene = [...region(target, gain), ...region(stop, loss), path([entry, { x: right, y: entry.y }])];
  let status = '',
    statusColor: string | undefined;
  if (c.candles) {
    const outcome = positionOutcome(d, c.candles);
    if (outcome.state === 'pending') status = 'Waiting for entry';
    else {
      const pnl = outcome.pnl!,
        color = pnl >= 0 ? gain : loss,
        from = { x: g.x(outcome.fillMs!), y: entry.y },
        to = { x: g.x(outcome.exitMs!), y: g.y(outcome.exitPrice!) };
      statusColor = color;
      // A second fill over the level region shows how far the trade has travelled so far.
      scene.push(
        path(rectangle(from, to), { closed: true, fill: color, width: 0 }),
        path([from, to], { color: c.theme?.palette.text ?? '#e6edf3', width: 1, dash: [4, 4], opacity: 0.7 }),
      );
      const name =
        outcome.state === 'open' ? 'Open P&L' : outcome.state === 'target' ? 'Target hit' : 'Stopped';
      status = `${name} ${signed(pnl)} (${pnl < 0 ? '−' : '+'}${percent(Math.abs(pnl))})`;
    }
  }
  const targetLabel = level('Target', targetPrice, metrics.reward),
    stopLabel = level('Stop', stopPrice, -metrics.risk),
    center = status ? `${summary}\n${status}` : summary;
  return [
    ...scene,
    text(fit(targetLabel, outside(target.y)), targetLabel, { ...pill, background: gain }),
    text(fit(center, entry.y + size * 0.35), center, {
      align: 'center',
      radius: 4,
      ...(statusColor ? { background: statusColor, color: ink } : {}),
    }),
    text(fit(stopLabel, outside(stop.y)), stopLabel, { ...pill, background: loss }),
  ];
}
const validatePosition =
  (long: boolean) =>
  (d: Drawing): void => {
    const [entry, target, stop] = d.points.map(p => p.price);
    if (long ? !(target > entry && entry > stop) : !(target < entry && entry < stop))
      throw new ChartError('INVALID_POSITION_PRICES');
  };
const tool = (
  type: string,
  label: string,
  group: string,
  points: DrawingToolDefinition['points'],
  project: DrawingToolDefinition['project'],
  hint?: string,
  validate?: DrawingToolDefinition['validate'],
): DrawingToolDefinition => ({
  type,
  label,
  group,
  points,
  project,
  hint:
    hint ??
    (points === 'path'
      ? 'Click points; press Enter or double-click to finish.'
      : points === 'freehand'
        ? 'Press and drag; release to finish.'
        : `Click ${points === 1 ? 'one point' : `${points} points`} to place.`),
  ...(validate ? { validate } : {}),
});

export const builtInDrawingTools: readonly DrawingToolDefinition[] = Object.freeze([
  ...(
    [
      ['trendline', 'Trend line', 2],
      ['ray', 'Ray', 2],
      ['extended-line', 'Extended line', 2],
      ['arrow', 'Arrow', 2],
      ['horizontal-line', 'Horizontal line', 1],
      ['horizontal-ray', 'Horizontal ray', 1],
      ['vertical-line', 'Vertical line', 1],
      ['cross-line', 'Cross line', 1],
    ] as const
  ).map(([type, label, points]) => tool(type, label, 'Lines', points, lineTool(type))),
  tool(
    'parallel-channel',
    'Parallel channel',
    'Channels',
    3,
    channel,
    'Click two baseline points, then the opposite side.',
  ),
  tool('pitchfork', 'Pitchfork', 'Channels', 3, pitchfork, 'Click the origin, then the two fork anchors.'),
  tool(
    'schiff-pitchfork',
    'Schiff pitchfork',
    'Channels',
    3,
    pitchfork,
    'Click the origin, then the two fork anchors.',
  ),
  tool('fib-retracement', 'Fib retracement', 'Fibonacci', 2, fibonacci),
  tool(
    'fib-extension',
    'Fib extension',
    'Fibonacci',
    3,
    fibonacci,
    'Click the start and end of the move, then the extension origin.',
  ),
  tool('fib-channel', 'Fib channel', 'Fibonacci', 3, channel),
  tool('fib-fan', 'Fib fan', 'Fibonacci', 2, fibonacci),
  tool(
    'fib-time-zone',
    'Fib time zones',
    'Fibonacci',
    2,
    fibonacci,
    'Click the origin, then one time interval.',
  ),
  tool('rectangle', 'Rectangle', 'Shapes', 2, shape),
  tool('ellipse', 'Ellipse', 'Shapes', 2, shape),
  tool('triangle', 'Triangle', 'Shapes', 3, shape),
  tool('polyline', 'Polyline', 'Shapes', 'path', shape),
  tool('brush', 'Brush', 'Freehand', 'freehand', shape),
  tool('highlighter', 'Highlighter', 'Freehand', 'freehand', shape),
  {
    ...tool('text', 'Text', 'Annotations', 1, annotation, 'Click to place, then type your text.'),
    editableText: true,
  },
  {
    ...tool(
      'callout',
      'Callout',
      'Annotations',
      2,
      annotation,
      'Click the arrow tip, then the text location.',
    ),
    editableText: true,
  },
  { ...tool('price-label', 'Price label', 'Annotations', 1, annotation), editableText: true },
  tool('price-range', 'Price range', 'Measure', 2, measurement),
  tool('date-range', 'Date range', 'Measure', 2, measurement),
  tool('date-price-range', 'Date and price range', 'Measure', 2, measurement),
  {
    ...tool(
      'long-position',
      'Long position',
      'Positions',
      3,
      position,
      'Click to place. Drag target, stop or width handles to adjust.',
      validatePosition(true),
    ),
    editableProperties: true,
    create: (anchor, context) => createPosition('long-position', anchor, context),
    handles: positionHandles,
    moveHandle: movePositionHandle,
  },
  {
    ...tool(
      'short-position',
      'Short position',
      'Positions',
      3,
      position,
      'Click to place. Drag target, stop or width handles to adjust.',
      validatePosition(false),
    ),
    editableProperties: true,
    create: (anchor, context) => createPosition('short-position', anchor, context),
    handles: positionHandles,
    moveHandle: movePositionHandle,
  },
]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function normalizedPoint(value: unknown): Anchor {
  if (
    !object(value) ||
    !boundedNumber(value.timeMs, -8.64e15, 8.64e15) ||
    typeof value.price !== 'number' ||
    !Number.isFinite(value.price) ||
    value.price <= 0
  )
    throw new ChartError('INVALID_DRAWING_POINTS');
  return { timeMs: value.timeMs, price: value.price };
}

/** Owns document validation and the trusted tool catalog; unknown tools stay round-trippable. */
export class DrawingRegistry {
  private readonly definitions = new Map<string, DrawingToolDefinition>();
  constructor(extra: readonly DrawingToolDefinition[] = []) {
    for (const definition of [...builtInDrawingTools, ...extra]) {
      if (
        !definition ||
        !/^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/.test(definition.type) ||
        typeof definition.label !== 'string' ||
        typeof definition.group !== 'string' ||
        typeof definition.hint !== 'string' ||
        typeof definition.project !== 'function' ||
        !(
          definition.points === 'path' ||
          definition.points === 'freehand' ||
          (Number.isInteger(definition.points) && definition.points >= 1 && definition.points <= 1024)
        ) ||
        (definition.validate !== undefined && typeof definition.validate !== 'function') ||
        (definition.editableText !== undefined && typeof definition.editableText !== 'boolean') ||
        (definition.editableProperties !== undefined && typeof definition.editableProperties !== 'boolean') ||
        !!definition.handles !== !!definition.moveHandle ||
        ['create', 'handles', 'moveHandle'].some(
          key =>
            definition[key as keyof DrawingToolDefinition] !== undefined &&
            typeof definition[key as keyof DrawingToolDefinition] !== 'function',
        )
      )
        throw new ChartError('INVALID_DRAWING_TOOL');
      if (this.definitions.has(definition.type)) throw new ChartError('DUPLICATE_DRAWING_TOOL');
      this.definitions.set(definition.type, Object.freeze({ ...definition }));
    }
  }
  get(type: string): DrawingToolDefinition | undefined {
    return this.definitions.get(type);
  }
  list(): readonly DrawingToolDefinition[] {
    return [...this.definitions.values()];
  }
  normalize(value: unknown): Drawing {
    if (!object(value)) throw new ChartError('INVALID_DRAWING');
    const legacy = value.type === undefined && value.start !== undefined && value.end !== undefined;
    const type = legacy ? 'trendline' : value.type;
    if (
      typeof value.id !== 'string' ||
      !value.id.trim() ||
      value.id.length > 128 ||
      typeof type !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/.test(type)
    )
      throw new ChartError('INVALID_DRAWING');
    const inputPoints = legacy ? [value.start, value.end] : value.points;
    if (!Array.isArray(inputPoints) || inputPoints.length < 1 || inputPoints.length > 1024)
      throw new ChartError('INVALID_DRAWING_POINTS');
    const points = inputPoints.map(normalizedPoint),
      definition = this.get(type);
    if (
      definition &&
      (typeof definition.points === 'number' ? points.length !== definition.points : points.length < 2)
    )
      throw new ChartError('INVALID_DRAWING_POINT_COUNT');
    if (value.style !== undefined && !object(value.style)) throw new ChartError('INVALID_DRAWING_STYLE');
    const style = { ...DEFAULT_DRAWING_STYLE, ...(value.style as Partial<DrawingStyle> | undefined) };
    if (
      typeof style.color !== 'string' ||
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(style.color) ||
      !boundedNumber(style.width, 1, 8) ||
      !['solid', 'dashed', 'dotted'].includes(style.lineStyle) ||
      !boundedNumber(style.fillOpacity, 0, 1) ||
      !boundedNumber(style.fontSize, 10, 32)
    )
      throw new ChartError('INVALID_DRAWING_STYLE');
    if (
      (value.locked !== undefined && typeof value.locked !== 'boolean') ||
      (value.visible !== undefined && typeof value.visible !== 'boolean')
    )
      throw new ChartError('INVALID_DRAWING_FLAGS');
    if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 2000))
      throw new ChartError('INVALID_DRAWING_TEXT');
    const levels = value.levels === undefined ? defaultsFor(type) : value.levels;
    if (
      !Array.isArray(levels) ||
      levels.length > 24 ||
      !levels.every(level => boundedNumber(level, -1000, 1000))
    )
      throw new ChartError('INVALID_DRAWING_LEVELS');
    const drawing: Drawing = {
      id: value.id,
      type,
      points,
      style: {
        color: style.color,
        width: style.width,
        lineStyle: style.lineStyle,
        fillOpacity: style.fillOpacity,
        fontSize: style.fontSize,
      },
      locked: (value.locked as boolean | undefined) ?? false,
      visible: (value.visible as boolean | undefined) ?? true,
      text: (value.text as string | undefined) ?? '',
      levels: [...levels],
    };
    definition?.validate?.(drawing);
    return drawing;
  }
  project(drawing: Drawing, context: DrawingContext): DrawingPrimitive[] {
    if (!drawing.visible) return [];
    return this.get(drawing.type)?.project(drawing, context) ?? [];
  }
}

/** Clamps one shared price delta so body movement never distorts a drawing. */
export function translateDrawing(
  drawing: Drawing,
  deltaTime: number,
  deltaPrice: number,
  tickSize: number,
): Drawing {
  if (![deltaTime, deltaPrice, tickSize].every(Number.isFinite) || tickSize <= 0 || !drawing.points.length)
    throw new ChartError('INVALID_DRAWING_TRANSLATION');
  const minPrice = Math.min(...drawing.points.map(p => p.price)),
    atFloor = minPrice + deltaPrice < tickSize;
  const points = drawing.points.map(point => ({
    timeMs: point.timeMs + deltaTime,
    price: atFloor ? point.price - minPrice + tickSize : point.price + deltaPrice,
  }));
  points.forEach(normalizedPoint);
  return { ...drawing, points, style: { ...drawing.style }, levels: [...drawing.levels] };
}
