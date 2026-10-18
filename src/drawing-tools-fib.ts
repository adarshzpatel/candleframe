import {
  add,
  drawingOption,
  fill,
  line,
  midpoint,
  path,
  rectangle,
  screen,
  text,
  toggle,
} from './drawing-primitives.ts';
import type { Anchor } from './types.ts';
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

/** More Fibonacci and Gann tools, and extra pitchforks. Registered in drawing-tools.ts; icons merge into ui-icons.ts. */

const GANN_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
/** Built-in levels by tool type; `Drawing.levels` overrides them when not empty. */
export const fibLevelDefaults: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'fib-trend-time': [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236],
  'fib-arcs': [0.236, 0.382, 0.5, 0.618, 0.786, 1],
  'fib-circles': [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618],
  'fib-spiral': [],
  'fib-wedge': [0.236, 0.382, 0.5, 0.618, 0.786, 1],
  pitchfan: [0, 0.382, 0.5, 0.618, 1],
  'gann-box': GANN_LEVELS,
  'gann-square': GANN_LEVELS,
});
const levelsFor = (d: Drawing): readonly number[] =>
  d.levels.length ? d.levels : (fibLevelDefaults[d.type] ?? []);

/** Same hues as the other Fibonacci tools, plus the quarter levels Gann tools use. */
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

const settingsByType = new Map<string, readonly DrawingSetting[]>();
const option = <T extends DrawingOptionValue>(d: Drawing, key: string): T =>
  drawingOption<T>(d, { settings: settingsByType.get(d.type) }, key);

function levelColor(d: Drawing, level: number, index: number): string {
  if (!option(d, 'levelColors')) return d.style.color;
  return FIB_COLORS[String(Number(level.toFixed(3)))] ?? FIB_CYCLE[index % FIB_CYCLE.length];
}
const sorted = (d: Drawing) =>
  [...levelsFor(d)].sort((x, y) => x - y).map((level, i) => ({ level, color: levelColor(d, level, i) }));
const dashed = (points: DrawingPoint[]): DrawingPrimitive =>
  path(points, { dash: [4, 4], opacity: 0.6, width: 1 });
const label = (at: DrawingPoint, value: string, color: string, align: 'left' | 'center' | 'right' = 'left') =>
  text(at, value, { align, color, plain: true, middle: true });
const distance = (a: DrawingPoint, b: DrawingPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/** Points on an axis-aligned ellipse around `center`, from angle `from` to `to` in screen radians. */
function arc(center: DrawingPoint, rx: number, ry: number, from: number, to: number): DrawingPoint[] {
  const steps = Math.max(8, Math.ceil((Math.abs(to - from) / Math.PI) * 48));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps;
    return { x: center.x + rx * Math.cos(t), y: center.y + ry * Math.sin(t) };
  });
}
/** The band between two arcs of the same sweep, for background fills. */
const ring = (outer: DrawingPoint[], inner: DrawingPoint[]) => [...outer, ...[...inner].reverse()];

/** Concentric arcs with optional bands between them; `radius` maps a level to screen pixels. */
function arcs(
  d: Drawing,
  center: DrawingPoint,
  radius: number,
  from: number,
  to: number,
  labelAt: (r: number) => DrawingPoint,
): DrawingPrimitive[] {
  const rows = sorted(d).filter(row => row.level > 0),
    result: DrawingPrimitive[] = [],
    curves = rows.map(row => arc(center, radius * row.level, radius * row.level, from, to));
  if (option(d, 'background'))
    rows.forEach((row, i) => {
      if (i) result.push(fill(ring(curves[i], curves[i - 1]), row.color));
    });
  rows.forEach((row, i) => {
    result.push(path(curves[i], { color: row.color }));
    if (option(d, 'showLabels')) result.push(label(labelAt(radius * row.level), `${row.level}`, row.color));
  });
  return result;
}

/** Vertical levels: the first two points give the interval, the third the origin. */
function trendTime(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c),
    g = c.geometry;
  if (!b) return [];
  if (!third) return [dashed([a, b])];
  const bottom = g.top + g.plotHeight,
    rows = sorted(d).map(row => ({ ...row, x: third.x + (b.x - a.x) * row.level })),
    result: DrawingPrimitive[] = [];
  if (option(d, 'background'))
    rows.forEach((row, i) => {
      if (i) result.push(fill(rectangle({ x: rows[i - 1].x, y: g.top }, { x: row.x, y: bottom }), row.color));
    });
  if (option(d, 'trendLine')) result.push(dashed([a, b, third]));
  for (const row of rows) {
    result.push(...line({ x: row.x, y: g.top }, { x: row.x, y: bottom }, c, 0, 1, { color: row.color }));
    if (option(d, 'showLabels'))
      result.push(label({ x: row.x + 4, y: bottom - 10 }, `${row.level}`, row.color));
  }
  return result;
}

/** Arcs around the first point; level 1 passes through the second. Half circles open towards it. */
function speedArcs(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!b) return [];
  const side = b.y <= a.y ? -1 : 1,
    full = option<boolean>(d, 'fullCircles');
  // A negative sweep draws the upper half on screen, where y grows downwards.
  const [from, to] = full ? [0, Math.PI * 2] : [0, side * Math.PI];
  return [
    ...arcs(d, a, distance(a, b), from, to, r => ({ x: a.x, y: a.y + side * (r + 8) })),
    ...(option(d, 'trendLine') ? [dashed([a, b])] : []),
  ];
}

/** Concentric circles around the midpoint; level 1 passes through both points. */
function circles(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!b) return [];
  const center = midpoint(a, b);
  return [
    ...arcs(d, center, distance(a, b) / 2, 0, Math.PI * 2, r => ({
      x: center.x,
      y: center.y - r - 8,
    })),
    ...(option(d, 'trendLine') ? [dashed([a, b])] : []),
  ];
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** A golden spiral around the first point through the second, growing by φ every quarter turn. */
function spiral(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!b) return [];
  const radius = distance(a, b);
  if (!radius) return [];
  const start = Math.atan2(b.y - a.y, b.x - a.x),
    turn = option(d, 'counterclockwise') ? -1 : 1;
  // Grow until the spiral is past every plot corner, and shrink inwards for four turns.
  const reach = Math.max(
    ...rectangle({ x: g.left, y: g.top }, { x: g.left + g.plotWidth, y: g.top + g.plotHeight }).map(p =>
      distance(a, p),
    ),
  );
  const last = Math.min(
    Math.PI * 16,
    Math.max(0, (Math.log(reach / radius) / Math.log(PHI)) * (Math.PI / 2)),
  );
  const first = -Math.PI * 8,
    steps = Math.ceil((last - first) / (Math.PI / 32));
  const curve = Array.from({ length: steps + 1 }, (_, i) => {
    const t = first + ((last - first) * i) / steps,
      r = radius * PHI ** (t / (Math.PI / 2));
    return { x: a.x + r * Math.cos(start + turn * t), y: a.y + r * Math.sin(start + turn * t) };
  });
  return [path(curve), ...line(a, b, c, 0, Infinity, { dash: [4, 4], width: 1 })];
}

/** Arcs around the first point between the rays through the second and third points. */
function wedge(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c);
  if (!b) return [];
  if (!third) return line(a, b, c);
  const radius = distance(a, b),
    from = Math.atan2(b.y - a.y, b.x - a.x);
  let sweep = Math.atan2(third.y - a.y, third.x - a.x) - from;
  // The shorter way round, so the wedge never wraps past half a turn.
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  if (sweep < -Math.PI) sweep += Math.PI * 2;
  const reach = radius * Math.max(1, ...levelsFor(d)),
    ray = (angle: number) => ({ x: a.x + reach * Math.cos(angle), y: a.y + reach * Math.sin(angle) });
  return [
    ...arcs(d, a, radius, from, from + sweep, r => ({
      x: a.x + (r + 6) * Math.cos(from),
      y: a.y + (r + 6) * Math.sin(from),
    })),
    path([ray(from), a, ray(from + sweep)]),
  ];
}

/** Rays from the origin through levels on both halves of the segment between the second and third points. */
function pitchfan(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c);
  if (!b) return [];
  if (!third) return line(a, b, c);
  const center = midpoint(b, third),
    reach = (p: DrawingPoint) => add(a, { x: p.x - a.x, y: p.y - a.y }, 50),
    result: DrawingPrimitive[] = [];
  const rows = sorted(d).filter(row => row.level >= 0);
  for (const end of [b, third]) {
    const at = rows.map(row => add(center, { x: end.x - center.x, y: end.y - center.y }, row.level));
    rows.forEach((row, i) => {
      if (i && option(d, 'background')) result.push(fill([a, reach(at[i - 1]), reach(at[i])], row.color));
    });
    rows.forEach((row, i) => {
      if (!row.level && end === third) return;
      result.push(...line(a, at[i], c, 0, Infinity, { color: row.color }));
      if (option(d, 'showLabels'))
        result.push(label({ x: at[i].x + 6, y: at[i].y }, `${row.level}`, row.color));
    });
  }
  result.push(dashed([b, third]));
  return result;
}

/** Price and time levels across the box between the two points, with shaded bands. */
function gannBox(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c);
  if (!points[1]) return [];
  const [a, b] = option(d, 'reverse') ? [points[1], points[0]] : points;
  const rows = sorted(d),
    xs = rows.map(row => a.x + (b.x - a.x) * row.level),
    ys = rows.map(row => a.y + (b.y - a.y) * row.level),
    top = Math.min(a.y, b.y),
    bottom = Math.max(a.y, b.y),
    left = Math.min(a.x, b.x),
    right = Math.max(a.x, b.x),
    result: DrawingPrimitive[] = [];
  rows.forEach((row, i) => {
    if (!i) return;
    if (option(d, 'priceBackground'))
      result.push(fill(rectangle({ x: left, y: ys[i - 1] }, { x: right, y: ys[i] }), row.color, 0.06));
    if (option(d, 'timeBackground'))
      result.push(fill(rectangle({ x: xs[i - 1], y: top }, { x: xs[i], y: bottom }), row.color, 0.06));
  });
  rows.forEach((row, i) => {
    const color = row.color,
      name = `${row.level}`;
    result.push(
      path(
        [
          { x: left, y: ys[i] },
          { x: right, y: ys[i] },
        ],
        { color },
      ),
      path(
        [
          { x: xs[i], y: top },
          { x: xs[i], y: bottom },
        ],
        { color },
      ),
    );
    if (option(d, 'leftLabels')) result.push(label({ x: left - 4, y: ys[i] }, name, color, 'right'));
    if (option(d, 'rightLabels')) result.push(label({ x: right + 4, y: ys[i] }, name, color));
    if (option(d, 'topLabels')) result.push(label({ x: xs[i], y: top - 10 }, name, color, 'center'));
    if (option(d, 'bottomLabels')) result.push(label({ x: xs[i], y: bottom + 10 }, name, color, 'center'));
  });
  if (option(d, 'angles'))
    result.push(
      path([a, b]),
      path([
        { x: a.x, y: b.y },
        { x: b.x, y: a.y },
      ]),
    );
  return result;
}

/** Gann ratios as price units per time unit, flattest first. */
const FAN = [
  ['1x8', 1 / 8],
  ['1x4', 1 / 4],
  ['1x3', 1 / 3],
  ['1x2', 1 / 2],
  ['1x1', 1],
  ['2x1', 2],
  ['3x1', 3],
  ['4x1', 4],
  ['8x1', 8],
] as const;
const FAN_COLORS = [
  '#ff9800',
  '#4caf50',
  '#089981',
  '#00bcd4',
  '#2962ff',
  '#9c27b0',
  '#e91e63',
  '#f23645',
  '#ff9800',
];
/** Where a ratio's line leaves the unit square from the origin: 1x1 meets the far corner. */
const fanEnd = (ratio: number) => (ratio <= 1 ? { x: 1, y: ratio } : { x: 1 / ratio, y: 1 });
const within = (a: DrawingPoint, b: DrawingPoint, f: { x: number; y: number }) => ({
  x: a.x + (b.x - a.x) * f.x,
  y: a.y + (b.y - a.y) * f.y,
});

/** Lines at Gann ratios from the first point; the second point sets the 1x1 line. */
function gannFan(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!b) return [];
  const ends = FAN.map(([, ratio]) => within(a, b, fanEnd(ratio))),
    color = (i: number) => (option(d, 'levelColors') ? FAN_COLORS[i] : d.style.color),
    reach = (p: DrawingPoint) => add(a, { x: p.x - a.x, y: p.y - a.y }, 50),
    result: DrawingPrimitive[] = [];
  if (option(d, 'background'))
    ends.forEach((end, i) => {
      if (i) result.push(fill([a, reach(ends[i - 1]), reach(end)], color(i)));
    });
  ends.forEach((end, i) => {
    result.push(...line(a, end, c, 0, Infinity, { color: color(i) }));
    if (option(d, 'showLabels')) result.push(text(end, FAN[i][0], { color: color(i), plain: true }));
  });
  return result;
}

/** Arcs of the fixed square, as radii in cells of its 5 × 5 grid. */
const FIXED_ARCS = [1, Math.SQRT2, 1.5, 2, Math.sqrt(5), 3, Math.sqrt(10), 4, Math.sqrt(17), 5];
const FIXED_FAN = [
  ['1x1', 1],
  ['1x2', 1 / 2],
  ['2x1', 2],
  ['1x3', 1 / 3],
  ['3x1', 3],
  ['1x4', 1 / 4],
  ['4x1', 4],
  ['1x5', 1 / 5],
  ['5x1', 5],
  ['1x8', 1 / 8],
  ['8x1', 8],
] as const;

/**
 * A grid of levels across the box, Gann fan lines and arcs from its first corner. The fixed square
 * uses a 5 × 5 grid; the other uses the drawing's levels.
 */
function gannSquare(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c);
  if (!points[1]) return [];
  const [a, b] = option(d, 'reverse') ? [points[1], points[0]] : points;
  const fixed = d.type === 'gann-square-fixed',
    rows = fixed
      ? [0, 1, 2, 3, 4, 5].map((step, i) => ({
          level: step / 5,
          name: `${step}`,
          color: levelColor(d, step / 5, i),
        }))
      : sorted(d).map(row => ({ ...row, name: `${row.level}` })),
    result: DrawingPrimitive[] = [];
  const at = (x: number, y: number) => within(a, b, { x, y });
  if (option(d, 'background'))
    rows.forEach((row, i) => {
      if (i) result.push(fill(rectangle(at(0, rows[i - 1].level), at(1, row.level)), row.color));
    });
  for (const row of rows) {
    result.push(path([at(0, row.level), at(1, row.level)], { color: row.color }));
    result.push(path([at(row.level, 0), at(row.level, 1)], { color: row.color }));
    if (option(d, 'showLabels')) {
      const side = b.x >= a.x ? -1 : 1,
        down = b.y >= a.y ? 1 : -1;
      result.push(
        label(add(at(0, row.level), { x: side * 4, y: 0 }), row.name, row.color, side < 0 ? 'right' : 'left'),
        label(add(at(row.level, 1), { x: 0, y: down * 10 }), row.name, row.color, 'center'),
      );
    }
  }
  if (option(d, 'fans'))
    (fixed ? FIXED_FAN : FAN).forEach(([, ratio], i) => {
      const end = at(fanEnd(ratio).x, fanEnd(ratio).y),
        color = option(d, 'levelColors') ? FAN_COLORS[i % FAN_COLORS.length] : d.style.color;
      result.push(path([a, end], { color, width: 1 }));
    });
  if (option(d, 'arcs')) {
    const radii = fixed ? FIXED_ARCS.map(r => r / 5) : rows.map(row => row.level).filter(r => r > 0);
    radii.forEach((r, i) => {
      const color = fixed ? FAN_COLORS[i % FAN_COLORS.length] : levelColor(d, r, i);
      result.push(
        path(arc(a, (b.x - a.x) * r, (b.y - a.y) * r, 0, Math.PI / 2), {
          color: option(d, 'levelColors') ? color : d.style.color,
          width: 1,
        }),
      );
    });
  }
  return result;
}

/**
 * The fixed square keeps its price-per-time ratio while its corners are dragged. The anchors stay
 * ordinary points, so placement and body moves work as for any two-point tool.
 */
function fixedSquareHandles(d: Drawing, c: DrawingContext): DrawingHandle[] {
  return screen(d, c).map((at, i) => ({ id: i ? 'corner' : 'origin', at, cursor: 'move' as const }));
}
function moveFixedSquare(d: Drawing, handle: string, anchor: Anchor, c: DrawingContext): Anchor[] {
  const [origin, corner] = d.points,
    span = corner.timeMs - origin.timeMs,
    ratio = span ? Math.abs(corner.price - origin.price) / Math.abs(span) : 0,
    up = corner.price >= origin.price,
    floor = c.tickSize ?? Number.MIN_VALUE;
  if (!ratio) return handle === 'origin' ? [anchor, corner] : [origin, anchor];
  if (handle === 'origin') {
    const height = Math.abs(corner.timeMs - anchor.timeMs) * ratio;
    return [
      { timeMs: anchor.timeMs, price: Math.max(floor, up ? corner.price - height : corner.price + height) },
      corner,
    ];
  }
  const height = Math.abs(anchor.timeMs - origin.timeMs) * ratio,
    rising = anchor.price === origin.price ? up : anchor.price > origin.price;
  return [
    origin,
    { timeMs: anchor.timeMs, price: Math.max(floor, rising ? origin.price + height : origin.price - height) },
  ];
}

/**
 * The same fork as the built-in pitchfork with a different origin and base. Modified Schiff starts
 * halfway between the first two points. Inside starts there too, aims at the third point and puts
 * the tines through the second point and its mirror across the third.
 */
function pitchfork(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [first, b, third] = screen(d, c);
  if (!third) return b ? line(first, b, c) : [];
  const a = midpoint(first, b),
    inside = d.type === 'inside-pitchfork',
    low = inside ? add(third, { x: third.x - b.x, y: third.y - b.y }) : third,
    center = midpoint(b, low),
    direction = { x: center.x - a.x, y: center.y - a.y },
    far = 4000 / Math.max(1, Math.hypot(direction.x, direction.y));
  return [
    ...(option(d, 'background')
      ? [fill([b, add(b, direction, far), add(low, direction, far), low], d.style.color)]
      : []),
    ...line(a, center, c, 0, Infinity),
    ...line(b, add(b, direction), c, 0, Infinity),
    ...line(low, add(low, direction), c, 0, Infinity),
    ...line(b, low, c, 0, 1, { dash: [4, 4] }),
    ...line(first, b, c, 0, 1, { dash: [4, 4], opacity: 0.6 }),
  ];
}

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
const levelSettings = (background: boolean, ...extra: DrawingSetting[]): DrawingSetting[] => [
  toggle('levelColors', 'Colour each level', true, 'Levels'),
  toggle('background', 'Background', background, 'Levels'),
  ...extra,
  toggle('showLabels', 'Labels', true, 'Labels'),
];
const trendLine = toggle('trendLine', 'Trend line', true, 'Levels');
const fib = (
  type: string,
  label: string,
  points: number,
  project: DrawingToolDefinition['project'],
  hint: string,
  settings: DrawingSetting[],
) => tool(type, label, 'Fib & Gann', 'Fibonacci', points, project, { hint, settings });
const gann = (
  type: string,
  label: string,
  project: DrawingToolDefinition['project'],
  hint: string,
  settings: DrawingSetting[],
  extra: Partial<DrawingToolDefinition> = {},
) => tool(type, label, 'Fib & Gann', 'Gann', 2, project, { hint, settings, ...extra });
const squareSettings = (): DrawingSetting[] => [
  ...levelSettings(true),
  toggle('fans', 'Fans', true, 'Levels'),
  toggle('arcs', 'Arcs', true, 'Levels'),
  toggle('reverse', 'Reverse', false, 'Levels'),
];

/** Fibonacci tools after the speed resistance fan. */
export const fibTools: readonly DrawingToolDefinition[] = [
  fib(
    'fib-trend-time',
    'Trend-based fib time',
    3,
    trendTime,
    'Click the start and end of a move, then where the time levels start.',
    levelSettings(false, trendLine),
  ),
  fib(
    'fib-arcs',
    'Fib speed resistance arcs',
    2,
    speedArcs,
    'Click the arc centre, then the end of the move.',
    levelSettings(true, trendLine, toggle('fullCircles', 'Full circles', false, 'Levels')),
  ),
  fib(
    'fib-circles',
    'Fib circles',
    2,
    circles,
    'Click two points across the 1 circle.',
    levelSettings(true, trendLine),
  ),
  tool('fib-spiral', 'Fib spiral', 'Fib & Gann', 'Fibonacci', 2, spiral, {
    hint: 'Click the spiral centre, then a point it passes through.',
    settings: [toggle('counterclockwise', 'Counterclockwise', false, 'Style')],
  }),
  fib(
    'fib-wedge',
    'Fib wedge',
    3,
    wedge,
    'Click the apex, the end of the 1 arc, then the other side.',
    levelSettings(true),
  ),
  fib(
    'pitchfan',
    'Pitchfan',
    3,
    pitchfan,
    'Click the origin, then the two fork anchors.',
    levelSettings(true),
  ),
];
/** Gann. */
export const gannTools: readonly DrawingToolDefinition[] = [
  gann('gann-box', 'Gann box', gannBox, 'Click two opposite corners.', [
    toggle('levelColors', 'Colour each level', true, 'Levels'),
    toggle('priceBackground', 'Price background', true, 'Levels'),
    toggle('timeBackground', 'Time background', true, 'Levels'),
    toggle('angles', 'Angles', false, 'Levels'),
    toggle('reverse', 'Reverse', false, 'Levels'),
    toggle('leftLabels', 'Left labels', true, 'Labels'),
    toggle('rightLabels', 'Right labels', false, 'Labels'),
    toggle('topLabels', 'Top labels', true, 'Labels'),
    toggle('bottomLabels', 'Bottom labels', false, 'Labels'),
  ]),
  gann(
    'gann-square-fixed',
    'Gann square fixed',
    gannSquare,
    'Click the origin, then the opposite corner. Dragging a corner keeps the ratio.',
    squareSettings(),
    { handles: fixedSquareHandles, moveHandle: moveFixedSquare },
  ),
  gann('gann-square', 'Gann square', gannSquare, 'Click two opposite corners.', squareSettings()),
  gann('gann-fan', 'Gann fan', gannFan, 'Click the origin, then a point on the 1x1 line.', [
    toggle('levelColors', 'Colour each line', true, 'Levels'),
    toggle('background', 'Background', true, 'Levels'),
    toggle('showLabels', 'Labels', true, 'Labels'),
  ]),
];
/** Pitchforks after the Schiff pitchfork. */
export const pitchforkTools: readonly DrawingToolDefinition[] = [
  tool('modified-schiff-pitchfork', 'Modified Schiff pitchfork', 'Lines', 'Pitchforks', 3, pitchfork, {
    hint: 'Click the origin, then the two fork anchors.',
    settings: [toggle('background', 'Background', true, 'Style')],
  }),
  tool('inside-pitchfork', 'Inside pitchfork', 'Lines', 'Pitchforks', 3, pitchfork, {
    hint: 'Click the origin, the upper fork anchor, then the median target.',
    settings: [toggle('background', 'Background', true, 'Style')],
  }),
];
for (const definition of [...fibTools, ...gannTools, ...pitchforkTools])
  if (definition.settings) settingsByType.set(definition.type, definition.settings);

/** 24-unit SVG paths keyed by tool type. */
export const fibIcons: Readonly<Record<string, string>> = {
  'fib-trend-time': '<path d="M9 4v16M13 4v16M20 4v16"/><path d="m3 18 3-8 3 5" stroke-dasharray="2 2"/>',
  'fib-arcs': '<path d="M4 20 17 7M11 20a7 7 0 0 0-7-7m14 7A14 14 0 0 0 4 6"/>',
  'fib-circles':
    '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9"/>',
  'fib-spiral': '<path d="M12 12a2 2 0 0 1 2 2 3 3 0 0 1-3 3 5 5 0 0 1-5-5 7 7 0 0 1 7-7 8 8 0 0 1 8 8"/>',
  'fib-wedge': '<path d="M3 20 20 6M3 20h18M12 20a9 9 0 0 0-2-6m10 6a17 17 0 0 0-3-11"/>',
  pitchfan:
    '<path d="M3 20 21 4M3 20l18-8M3 20 13 3M3 20l18 1"/><path d="m13 3 8 18" stroke-dasharray="2 2"/>',
  'gann-box': '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M8 4v16M14 4v16"/>',
  'gann-square-fixed':
    '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 21 21 3M3 21l18-9M3 21 12 3M3 12a9 9 0 0 1 9 9"/>',
  'gann-square':
    '<rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 20 21 5M3 20l18-7M3 11h18M10 5v15"/>',
  'gann-fan': '<path d="M3 21 21 3M3 21l18-9M3 21 12 3M3 21l18-4M3 21 7 3"/>',
  'modified-schiff-pitchfork':
    '<path d="m8 16 12-12M3 11l10 10M3 11l8-8m2 18 8-8"/><path d="m3 11 10 10" stroke-dasharray="1 3"/>',
  'inside-pitchfork': '<path d="m7 15 13-11M5 9l7-6m-2 18 11-11M5 9l5 12"/>',
};
