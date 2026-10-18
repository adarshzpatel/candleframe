import { ChartError } from './errors.ts';
import { channelTools, cycleTools } from './drawing-tools-channels.ts';
import { fibLevelDefaults, fibTools, gannTools, pitchforkTools } from './drawing-tools-fib.ts';
import { projectionTools, volumeTools } from './drawing-tools-forecast.ts';
import { elliottTools, patternTools } from './drawing-tools-patterns.ts';
import { arrowTools, noteTools, shapeTools } from './drawing-tools-shapes.ts';
import {
  add,
  angle,
  arrow,
  arrowHead,
  axisTag,
  bars,
  choice,
  drawingOption,
  duration,
  fill,
  line,
  midpoint,
  path,
  rectangle,
  screen,
  signed,
  text,
  toggle,
} from './drawing-primitives.ts';
import {
  createPosition,
  movePositionHandle,
  positionHandles,
  positionMetrics,
  positionOutcome,
} from './position-drawing.ts';
import { themeTokenDefaults } from './theme-tokens.ts';
import { drawingShown, normalizedVisibility } from './drawing-visibility.ts';
import type { Anchor } from './types.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingOptionValue,
  DrawingOptionValues,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
  DrawingStyle,
  DrawingToolDefaults,
  DrawingToolDefinition,
} from './drawing-types.ts';

export { drawingOption };

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
        : fibLevelDefaults[type]
          ? [...fibLevelDefaults[type]]
          : type.startsWith('fib-')
            ? RETRACEMENT
            : [];
const levelsFor = (d: Drawing): number[] => (d.levels.length ? d.levels : defaultsFor(d.type));
/** True for tools whose `Drawing.levels` drive their geometry. */
export const usesDrawingLevels = (type: string): boolean => defaultsFor(type).length > 0;

/** Familiar Fibonacci hues by ratio; other ratios cycle through the same set. */
const FIB_COLORS: Record<string, string> = {
  '0': '#787b86',
  '0.236': '#f23645',
  '0.382': '#ff9800',
  '0.5': '#4caf50',
  '0.618': '#089981',
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

const ENDS = [
  ['normal', 'Normal'],
  ['arrow', 'Arrow'],
] as const;
const ALIGN = [
  ['left', 'Left'],
  ['center', 'Center'],
  ['right', 'Right'],
] as const;
const lineSettings = (left: boolean, right: boolean, end = 'normal', stats = 'never'): DrawingSetting[] => [
  toggle('extendLeft', 'Extend left', left, 'Line'),
  toggle('extendRight', 'Extend right', right, 'Line'),
  choice('leftEnd', 'Left end', 'normal', ENDS, 'Line'),
  choice('rightEnd', 'Right end', end, ENDS, 'Line'),
  toggle('middlePoint', 'Middle point', false, 'Line'),
  choice(
    'stats',
    'Stats',
    stats,
    [
      ['never', 'Hidden'],
      ['selected', 'When selected'],
      ['always', 'Always'],
    ],
    'Stats',
  ),
  choice('textAlign', 'Text position', 'center', ALIGN, 'Text'),
];
const levelLineSettings = (price: boolean, time: boolean): DrawingSetting[] => [
  ...(price ? [toggle('priceLabel', 'Price label', true, 'Line')] : []),
  ...(time ? [toggle('timeLabel', 'Time label', true, 'Line')] : []),
  choice('textAlign', 'Text position', 'right', ALIGN, 'Text'),
];
const fibSettings = (background: boolean, labels: boolean): DrawingSetting[] => [
  toggle('levelColors', 'Colour each level', true, 'Levels'),
  ...(background ? [toggle('background', 'Background', true, 'Levels')] : []),
  ...(labels
    ? [
        toggle('trendLine', 'Trend line', true, 'Levels'),
        toggle('reverse', 'Reverse', false, 'Levels'),
        choice(
          'extend',
          'Extend lines',
          'none',
          [
            ['none', 'None'],
            ['left', 'Left'],
            ['right', 'Right'],
            ['both', 'Both'],
          ],
          'Levels',
        ),
        choice(
          'labels',
          'Labels',
          'left',
          [
            ['left', 'Left'],
            ['right', 'Right'],
            ['hidden', 'Hidden'],
          ],
          'Labels',
        ),
        toggle('showLevels', 'Show levels', true, 'Labels'),
        toggle('showPrices', 'Show prices', true, 'Labels'),
        choice(
          'levelFormat',
          'Level format',
          'values',
          [
            ['values', 'Values'],
            ['percent', 'Percent'],
          ],
          'Labels',
        ),
      ]
    : []),
];
// The background is a light tint of the text colour by default, so candles stay visible through it.
const textSettings = (background: boolean): DrawingSetting[] => [
  toggle('bold', 'Bold', false, 'Text'),
  toggle('italic', 'Italic', false, 'Text'),
  toggle('border', 'Border', false, 'Text'),
  toggle('background', 'Background', background, 'Background'),
  { key: 'backgroundColor', label: 'Colour', kind: 'color', default: '', section: 'Background' },
  {
    key: 'backgroundOpacity',
    label: 'Opacity',
    kind: 'number',
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
    section: 'Background',
  },
];
const shapeSettings = (extend: boolean): DrawingSetting[] => [
  toggle('background', 'Background', true, 'Style'),
  ...(extend
    ? [
        toggle('extendLeft', 'Extend left', false, 'Style'),
        toggle('extendRight', 'Extend right', false, 'Style'),
        toggle('middleLine', 'Middle line', false, 'Style'),
      ]
    : []),
];

/** Built-in settings by tool, read through `option` so each tool sees its own defaults. */
const builtInSettings = new Map<string, readonly DrawingSetting[]>();
const option = <T extends DrawingOptionValue>(d: Drawing, key: string): T =>
  drawingOption<T>(d, { settings: builtInSettings.get(d.type) }, key);

function dot(at: DrawingPoint, radius: number, color?: string): DrawingPrimitive {
  const points = Array.from({ length: 16 }, (_, i) => ({
    x: at.x + radius * Math.cos((i / 16) * Math.PI * 2),
    y: at.y + radius * Math.sin((i / 16) * Math.PI * 2),
  }));
  return path(points, { closed: true, ...(color ? { fill: color, color } : {}), width: 1, opacity: 1 });
}
/** Price change, bar count, elapsed time and screen angle between two anchors. */
function statsLines(d: Drawing, c: DrawingContext, a: DrawingPoint, b: DrawingPoint): string {
  const [from, to] = d.points,
    delta = to.price - from.price;
  const percent = signed((delta / from.price) * 100, v => v.toFixed(2));
  const ticks = c.tickSize ? `, ${Math.round(delta / c.tickSize)} ticks` : '';
  return [
    `${signed(delta, c.formatPrice)} (${percent}%)${ticks}`,
    `${bars(c, from.timeMs, to.timeMs)} bars, ${duration(to.timeMs - from.timeMs)}`,
    `${angle(a, b).toFixed(1)}°`,
  ].join('\n');
}
/** Text sits just above the line at the chosen end, or its middle. */
function lineText(d: Drawing, a: DrawingPoint, b: DrawingPoint): DrawingPrimitive[] {
  if (!d.text) return [];
  const align = option<'left' | 'center' | 'right'>(d, 'textAlign');
  const [first, last] = a.x <= b.x ? [a, b] : [b, a];
  const at = align === 'left' ? first : align === 'right' ? last : midpoint(a, b);
  return [text({ x: at.x, y: at.y - 6 }, d.text, { align, plain: true })];
}

function lineTool(type: string): DrawingToolDefinition['project'] {
  return (d, c) => {
    const [a, b] = screen(d, c),
      g = c.geometry;
    if (!a) return [];
    const right = { x: g.left + g.plotWidth, y: a.y };
    const horizontal = () => [
      ...(type === 'horizontal-ray'
        ? line(a, { x: a.x + 1, y: a.y }, c, 0, Infinity)
        : line({ x: g.left, y: a.y }, right, c)),
      ...(option(d, 'priceLabel') ? [axisTag('price', d.points[0].price, { color: d.style.color })] : []),
      ...lineText(d, type === 'horizontal-ray' ? a : { x: g.left + 8, y: a.y }, { x: right.x - 8, y: a.y }),
    ];
    const vertical = () => [
      ...line({ x: a.x, y: g.top }, { x: a.x, y: g.top + g.plotHeight }, c),
      ...(option(d, 'timeLabel') ? [axisTag('time', d.points[0].timeMs, { color: d.style.color })] : []),
    ];
    if (type === 'horizontal-line' || type === 'horizontal-ray') return horizontal();
    if (type === 'vertical-line') return vertical();
    if (type === 'cross-line') return [...horizontal(), ...vertical()];
    if (!b) return [];
    const result = line(
      a,
      b,
      c,
      option(d, 'extendLeft') ? -Infinity : 0,
      option(d, 'extendRight') ? Infinity : 1,
    );
    if (option(d, 'leftEnd') === 'arrow') result.push(...arrowHead(b, a, d.style.width));
    if (option(d, 'rightEnd') === 'arrow') result.push(...arrowHead(a, b, d.style.width));
    if (option(d, 'middlePoint')) result.push(dot(midpoint(a, b), 3 + d.style.width / 2, d.style.color));
    if (type === 'trend-angle') {
      const length = Math.hypot(b.x - a.x, b.y - a.y),
        radius = Math.min(48, length * 0.6),
        degrees = angle(a, b);
      result.push(path([a, { x: a.x + Math.max(radius + 16, length * 0.8), y: a.y }], { dash: [4, 4] }));
      const steps = Math.max(2, Math.ceil(Math.abs(degrees) / 6));
      result.push(
        path(
          Array.from({ length: steps + 1 }, (_, i) => {
            const t = ((degrees * i) / steps / 180) * Math.PI;
            return { x: a.x + radius * Math.cos(t), y: a.y - radius * Math.sin(t) };
          }),
          { width: 1 },
        ),
        text({ x: a.x + radius + 6, y: a.y + (degrees >= 0 ? -6 : 16) }, `${degrees.toFixed(1)}°`, {
          plain: true,
        }),
      );
    }
    const stats = option<string>(d, 'stats');
    if (stats === 'always' || (stats === 'selected' && c.selected))
      result.push(text({ x: b.x + 10, y: b.y + 18 }, statsLines(d, c, a, b)));
    result.push(...lineText(d, a, b));
    return result;
  };
}

/** Keep the first two time coordinates fixed; the third point lies on the opposite rail. */
function channelOffset(a: DrawingPoint, b: DrawingPoint, third: DrawingPoint): DrawingPoint {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (!dx) return { x: third.x - a.x, y: 0 };
  return { x: 0, y: third.y - a.y - ((third.x - a.x) / dx) * dy };
}
function levelColor(d: Drawing, level: number, index: number): string {
  if (!option(d, 'levelColors')) return d.style.color;
  return FIB_COLORS[String(Number(level.toFixed(3)))] ?? FIB_CYCLE[index % FIB_CYCLE.length];
}
function channel(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, third] = screen(d, c);
  if (!third) return b ? line(a, b, c) : [];
  const offset = channelOffset(a, b, third),
    topA = add(a, offset),
    topB = add(b, offset);
  if (d.type === 'fib-channel') {
    const levels = [...levelsFor(d)].sort((x, y) => x - y),
      result: DrawingPrimitive[] = [];
    levels.forEach((level, i) => {
      const color = levelColor(d, level, i);
      if (i && option(d, 'background'))
        result.push(
          fill(
            [
              add(a, offset, levels[i - 1]),
              add(b, offset, levels[i - 1]),
              add(b, offset, level),
              add(a, offset, level),
            ],
            color,
          ),
        );
      const start = add(a, offset, level),
        end = add(b, offset, level);
      result.push(...line(start, end, c, 0, 1, { color }), text(end, `${level}`, { color, plain: true }));
    });
    return result;
  }
  return [
    fill([a, b, topB, topA], d.style.color),
    ...line(a, b, c),
    ...line(topA, topB, c),
    ...line(add(a, offset, 0.5), add(b, offset, 0.5), c, 0, 1, { dash: [5, 4] }),
  ];
}
function pitchfork(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [first, b, third] = screen(d, c);
  if (!third) return b ? line(first, b, c) : [];
  const a = d.type === 'schiff-pitchfork' ? { x: first.x, y: (first.y + b.y) / 2 } : first;
  const center = midpoint(b, third),
    direction = { x: center.x - a.x, y: center.y - a.y },
    far = 4000 / Math.max(1, Math.hypot(direction.x, direction.y));
  return [
    ...(option(d, 'background')
      ? [fill([b, add(b, direction, far), add(third, direction, far), third], d.style.color)]
      : []),
    ...line(a, center, c, 0, Infinity),
    ...line(b, add(b, direction), c, 0, Infinity),
    ...line(third, add(third, direction), c, 0, Infinity),
    ...line(b, third, c, 0, 1, { dash: [4, 4] }),
  ];
}
function levelText(d: Drawing, level: number, price: string): string {
  const shown = option(d, 'levelFormat') === 'percent' ? `${Number((level * 100).toFixed(1))}%` : `${level}`;
  const showLevel = option(d, 'showLevels'),
    showPrice = option(d, 'showPrices');
  return showLevel && showPrice ? `${shown} (${price})` : showLevel ? shown : showPrice ? price : '';
}
function fibonacci(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c),
    [a, b, third] = points,
    g = c.geometry;
  if (!b) return [];
  const result: DrawingPrimitive[] = [];
  const levels = levelsFor(d);
  if (d.type === 'fib-time-zone') {
    levels.forEach((level, i) => {
      const x = a.x + (b.x - a.x) * level,
        color = levelColor(d, level, i);
      result.push(
        ...line({ x, y: g.top }, { x, y: g.top + g.plotHeight }, c, 0, 1, { color }),
        text({ x: x + 3, y: g.top + 15 }, `${level}`, { color, plain: true }),
      );
    });
    return result;
  }
  if (d.type === 'fib-fan') {
    const ends = levels.map(level => ({ x: b.x, y: a.y + (b.y - a.y) * level }));
    levels.forEach((level, i) => {
      const color = levelColor(d, level, i),
        end = ends[i];
      if (i && option(d, 'background')) {
        const reach = (p: DrawingPoint) => add(a, { x: p.x - a.x, y: p.y - a.y }, 50);
        result.push(fill([a, reach(ends[i - 1]), reach(end)], color));
      }
      result.push(
        ...line(a, end, c, 0, Infinity, { color }),
        text(end, `${level}`, { align: 'right', color, plain: true }),
      );
    });
    return result;
  }
  if (d.type === 'fib-extension' && !third) return line(a, b, c, 0, 1, { dash: [4, 4], opacity: 0.6 });
  const extend = option<string>(d, 'extend'),
    labels = option<string>(d, 'labels'),
    reverse = option<boolean>(d, 'reverse');
  const left = extend === 'left' || extend === 'both' ? g.left : Math.min(...points.map(p => p.x)),
    right =
      extend === 'right' || extend === 'both' ? g.left + g.plotWidth : Math.max(...points.map(p => p.x));
  // Retracements count from the second anchor back to the first; extensions project the
  // first leg from the third anchor.
  const [first, second] = reverse ? [d.points[1], d.points[0]] : [d.points[0], d.points[1]];
  const price =
    d.type === 'fib-extension'
      ? (level: number) => d.points[2].price + (second.price - first.price) * level
      : (level: number) => second.price + (first.price - second.price) * level;
  const rows = levels
    .map((level, i) => ({ level, price: price(level), color: levelColor(d, level, i) }))
    .sort((x, y) => x.price - y.price);
  rows.forEach((row, i) => {
    const y = g.y(row.price);
    if (i && option(d, 'background')) {
      const below = g.y(rows[i - 1].price);
      result.push(fill(rectangle({ x: left, y: below }, { x: right, y }), row.color));
    }
  });
  if (option(d, 'trendLine')) {
    const legs = d.type === 'fib-extension' ? [a, b, third] : [a, b];
    result.push(path(legs, { dash: [4, 4], opacity: 0.6, width: 1 }));
  }
  for (const row of rows) {
    const y = g.y(row.price);
    result.push(...line({ x: left, y }, { x: right, y }, c, 0, 1, { color: row.color }));
    const label = levelText(d, row.level, c.formatPrice(row.price));
    if (labels === 'hidden' || !label) continue;
    // Labels sit just outside the levels, or inside the plot edge when the lines reach it.
    const at =
      labels === 'left'
        ? left <= g.left + 1
          ? { x: g.left + 4, y, align: 'left' as const }
          : { x: left - 4, y, align: 'right' as const }
        : right >= g.left + g.plotWidth - 1
          ? { x: g.left + g.plotWidth - 4, y, align: 'right' as const }
          : { x: right + 4, y, align: 'left' as const };
    result.push(
      text({ x: at.x, y }, label, { align: at.align, color: row.color, plain: true, middle: true }),
    );
  }
  return result;
}
function shape(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c),
    [a, b] = points,
    g = c.geometry;
  if (!b) return [];
  if (d.type === 'brush' || d.type === 'polyline') return [path(points)];
  if (d.type === 'highlighter')
    return [path(points, { width: Math.max(8, d.style.width * 4), opacity: 0.3 })];
  let outline = points;
  const extras: DrawingPrimitive[] = [];
  if (d.type === 'rectangle') {
    const x1 = option(d, 'extendLeft') ? g.left - 2 : Math.min(a.x, b.x),
      x2 = option(d, 'extendRight') ? g.left + g.plotWidth + 2 : Math.max(a.x, b.x);
    outline = rectangle({ x: x1, y: a.y }, { x: x2, y: b.y });
    if (option(d, 'middleLine'))
      extras.push(
        path(
          [
            { x: x1, y: (a.y + b.y) / 2 },
            { x: x2, y: (a.y + b.y) / 2 },
          ],
          { dash: [5, 4], width: 1 },
        ),
      );
  }
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
    ...(option(d, 'background') ? [fill(outline, d.style.color)] : []),
    path(outline, { closed: true }),
    ...extras,
  ];
}
function annotation(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!a) return [];
  const look = {
    bold: option<boolean>(d, 'bold'),
    italic: option<boolean>(d, 'italic'),
    plain: !option<boolean>(d, 'background'),
    background: option<string>(d, 'backgroundColor') || d.style.color,
    backgroundOpacity: option<number>(d, 'backgroundOpacity'),
    ...(option(d, 'border') ? { border: d.style.color } : {}),
  };
  if (d.type === 'price-label')
    return [
      text(a, `${d.text ? `${d.text} · ` : ''}${c.formatPrice(d.points[0].price)}`, look),
      axisTag('price', d.points[0].price, { color: d.style.color }),
    ];
  if (d.type === 'callout' && b) return [...arrow(b, a, c, d.style.width), text(b, d.text, look)];
  return [text(a, d.text, look)];
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
function projectPosition(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
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
/** Alt+key shortcuts by `KeyboardEvent.code`, matching the familiar defaults. */
export const DRAWING_HOTKEYS: Readonly<Record<string, string>> = Object.freeze({
  KeyT: 'trendline',
  KeyH: 'horizontal-line',
  KeyJ: 'horizontal-ray',
  KeyV: 'vertical-line',
  KeyC: 'cross-line',
  KeyF: 'fib-retracement',
});

const tool = (
  type: string,
  label: string,
  group: string,
  section: string,
  points: DrawingToolDefinition['points'],
  project: DrawingToolDefinition['project'],
  extra: Partial<Omit<DrawingToolDefinition, 'type' | 'label' | 'group' | 'points' | 'project'>> = {},
): DrawingToolDefinition => ({
  type,
  label,
  group,
  section,
  points,
  project,
  hint:
    points === 'path'
      ? 'Click points; press Enter or double-click to finish.'
      : points === 'freehand'
        ? 'Press and drag; release to finish.'
        : `Click ${points === 1 ? 'one point' : `${points} points`} to place.`,
  ...extra,
});

const position = (type: 'long-position' | 'short-position', label: string): DrawingToolDefinition =>
  tool(type, label, 'Forecasting', 'Projection', 3, projectPosition, {
    hint: 'Click to place. Drag target, stop or width handles to adjust.',
    validate: validatePosition(type === 'long-position'),
    editableProperties: true,
    create: (anchor, context) => createPosition(type, anchor, context),
    handles: positionHandles,
    moveHandle: movePositionHandle,
  });

/** Grouped like the familiar six-family drawing rail: Lines, Fib & Gann, Patterns, Forecasting, Shapes, Annotations. */
export const builtInDrawingTools: readonly DrawingToolDefinition[] = Object.freeze([
  ...(
    [
      ['trendline', 'Trend line', 2, lineSettings(false, false)],
      ['ray', 'Ray', 2, lineSettings(false, true)],
      ['info-line', 'Info line', 2, lineSettings(false, false, 'normal', 'always')],
      ['extended-line', 'Extended line', 2, lineSettings(true, true)],
      ['trend-angle', 'Trend angle', 2, lineSettings(false, false)],
      ['horizontal-line', 'Horizontal line', 1, levelLineSettings(true, false)],
      ['horizontal-ray', 'Horizontal ray', 1, levelLineSettings(true, false)],
      ['vertical-line', 'Vertical line', 1, levelLineSettings(false, true)],
      ['cross-line', 'Cross line', 1, levelLineSettings(true, true)],
    ] as const
  ).map(([type, label, points, settings]) =>
    tool(type, label, 'Lines', 'Lines', points, lineTool(type), { settings }),
  ),
  tool('parallel-channel', 'Parallel channel', 'Lines', 'Channels', 3, channel, {
    hint: 'Click two baseline points, then the opposite side.',
  }),
  ...channelTools,
  tool('pitchfork', 'Pitchfork', 'Lines', 'Pitchforks', 3, pitchfork, {
    hint: 'Click the origin, then the two fork anchors.',
    settings: [toggle('background', 'Background', true, 'Style')],
  }),
  tool('schiff-pitchfork', 'Schiff pitchfork', 'Lines', 'Pitchforks', 3, pitchfork, {
    hint: 'Click the origin, then the two fork anchors.',
    settings: [toggle('background', 'Background', true, 'Style')],
  }),
  ...pitchforkTools,
  tool('fib-retracement', 'Fib retracement', 'Fib & Gann', 'Fibonacci', 2, fibonacci, {
    hint: 'Click the start of the move, then its end.',
    settings: fibSettings(true, true),
  }),
  tool('fib-extension', 'Trend-based fib extension', 'Fib & Gann', 'Fibonacci', 3, fibonacci, {
    hint: 'Click the start and end of the move, then the extension origin.',
    settings: fibSettings(true, true),
  }),
  tool('fib-channel', 'Fib channel', 'Fib & Gann', 'Fibonacci', 3, channel, {
    hint: 'Click two baseline points, then the opposite side.',
    settings: fibSettings(true, false),
  }),
  tool('fib-time-zone', 'Fib time zone', 'Fib & Gann', 'Fibonacci', 2, fibonacci, {
    hint: 'Click the origin, then one time interval.',
    settings: fibSettings(false, false),
  }),
  tool('fib-fan', 'Fib speed resistance fan', 'Fib & Gann', 'Fibonacci', 2, fibonacci, {
    settings: fibSettings(true, false),
  }),
  ...fibTools,
  ...gannTools,
  ...patternTools,
  ...elliottTools,
  ...cycleTools,
  position('long-position', 'Long position'),
  position('short-position', 'Short position'),
  ...projectionTools,
  ...volumeTools,
  tool('date-range', 'Date range', 'Forecasting', 'Measurer', 2, measurement),
  tool('price-range', 'Price range', 'Forecasting', 'Measurer', 2, measurement),
  tool('date-price-range', 'Date and price range', 'Forecasting', 'Measurer', 2, measurement),
  tool('brush', 'Brush', 'Shapes', 'Brushes', 'freehand', shape),
  tool('highlighter', 'Highlighter', 'Shapes', 'Brushes', 'freehand', shape),
  tool('arrow', 'Arrow', 'Shapes', 'Arrows', 2, lineTool('arrow'), {
    settings: lineSettings(false, false, 'arrow'),
  }),
  ...arrowTools,
  tool('rectangle', 'Rectangle', 'Shapes', 'Shapes', 2, shape, { settings: shapeSettings(true) }),
  tool('ellipse', 'Ellipse', 'Shapes', 'Shapes', 2, shape, { settings: shapeSettings(false) }),
  tool('triangle', 'Triangle', 'Shapes', 'Shapes', 3, shape, { settings: shapeSettings(false) }),
  tool('polyline', 'Polyline', 'Shapes', 'Shapes', 'path', shape),
  ...shapeTools,
  tool('text', 'Text', 'Annotations', 'Text and notes', 1, annotation, {
    hint: 'Click to place, then type your text.',
    editableText: true,
    settings: textSettings(false),
  }),
  tool('callout', 'Callout', 'Annotations', 'Text and notes', 2, annotation, {
    hint: 'Click the arrow tip, then the text location.',
    editableText: true,
    settings: textSettings(true),
  }),
  tool('price-label', 'Price label', 'Annotations', 'Text and notes', 1, annotation, {
    editableText: true,
    settings: textSettings(true),
  }),
  ...noteTools,
]);
for (const definition of builtInDrawingTools)
  if (definition.settings) builtInSettings.set(definition.type, definition.settings);

const COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
const STYLE_KEYS = ['color', 'width', 'lineStyle', 'fillOpacity', 'fontSize'] as const;
function normalizedStyle(value: unknown): DrawingStyle {
  if (value !== undefined && !object(value)) throw new ChartError('INVALID_DRAWING_STYLE');
  const style = { ...DEFAULT_DRAWING_STYLE, ...(value as Partial<DrawingStyle> | undefined) };
  if (
    typeof style.color !== 'string' ||
    !COLOR.test(style.color) ||
    !boundedNumber(style.width, 1, 8) ||
    !['solid', 'dashed', 'dotted'].includes(style.lineStyle) ||
    !boundedNumber(style.fillOpacity, 0, 1) ||
    !boundedNumber(style.fontSize, 10, 32)
  )
    throw new ChartError('INVALID_DRAWING_STYLE');
  return {
    color: style.color,
    width: style.width,
    lineStyle: style.lineStyle,
    fillOpacity: style.fillOpacity,
    fontSize: style.fontSize,
  };
}
function normalizedLevels(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 24 || !value.every(level => boundedNumber(level, -1000, 1000)))
    throw new ChartError('INVALID_DRAWING_LEVELS');
  return [...value];
}
/** Checks a tool's defaults or a template without a drawing: a partial style, settings and levels. */
export function normalizedToolDefaults(
  value: unknown,
  definition: Pick<DrawingToolDefinition, 'settings'> | undefined,
): DrawingToolDefaults {
  if (
    !object(value) ||
    Object.keys(value).some(key => !['style', 'options', 'levels', 'visibility'].includes(key))
  )
    throw new ChartError('INVALID_DRAWING_OPTIONS');
  const result: DrawingToolDefaults = {};
  if (value.style !== undefined) {
    const given = value.style;
    if (!object(given) || Object.keys(given).some(key => !(STYLE_KEYS as readonly string[]).includes(key)))
      throw new ChartError('INVALID_DRAWING_STYLE');
    const keys = STYLE_KEYS.filter(key => given[key] !== undefined),
      full = normalizedStyle(Object.fromEntries(keys.map(key => [key, given[key]])));
    if (keys.length) result.style = Object.fromEntries(keys.map(key => [key, full[key]]));
  }
  const options = normalizedOptions(value.options, definition);
  if (options) result.options = options;
  const levels = value.levels === undefined ? [] : normalizedLevels(value.levels);
  if (levels.length) result.levels = levels;
  const visibility = normalizedVisibility(value.visibility);
  if (visibility) result.visibility = visibility;
  return result;
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

/** Keeps only values that differ from the tool's defaults, so untouched drawings serialize as before. */
function normalizedOptions(
  value: unknown,
  definition: Pick<DrawingToolDefinition, 'settings'> | undefined,
): DrawingOptionValues | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || Object.keys(value).length > 32) throw new ChartError('INVALID_DRAWING_OPTIONS');
  const result: DrawingOptionValues = {};
  for (const [key, given] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key)) throw new ChartError('INVALID_DRAWING_OPTIONS', key);
    const setting = definition?.settings?.find(s => s.key === key);
    const valid = setting
      ? setting.kind === 'boolean'
        ? typeof given === 'boolean'
        : setting.kind === 'number'
          ? boundedNumber(given, setting.min, setting.max)
          : setting.kind === 'select'
            ? setting.choices.some(choice => choice.value === given)
            : typeof given === 'string' && (given === setting.default || COLOR.test(given))
      : typeof given === 'boolean' ||
        (typeof given === 'number' && Number.isFinite(given)) ||
        (typeof given === 'string' && given.length <= 64);
    if (!valid) throw new ChartError('INVALID_DRAWING_OPTIONS', key);
    if (setting?.default !== given) result[key] = given as DrawingOptionValue;
  }
  return Object.keys(result).length ? result : undefined;
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
  /** Validates and normalizes defaults or a template for a registered tool. */
  validateDefaults(type: string, value: unknown): DrawingToolDefaults {
    if (!this.get(type)) throw new ChartError('UNKNOWN_DRAWING_TOOL', type);
    return normalizedToolDefaults(value, this.get(type));
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
    const style = normalizedStyle(value.style);
    if (
      (value.locked !== undefined && typeof value.locked !== 'boolean') ||
      (value.visible !== undefined && typeof value.visible !== 'boolean')
    )
      throw new ChartError('INVALID_DRAWING_FLAGS');
    if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 2000))
      throw new ChartError('INVALID_DRAWING_TEXT');
    const levels = normalizedLevels(value.levels === undefined ? defaultsFor(type) : value.levels);
    const drawing: Drawing = {
      id: value.id,
      type,
      points,
      style,
      locked: (value.locked as boolean | undefined) ?? false,
      visible: (value.visible as boolean | undefined) ?? true,
      text: (value.text as string | undefined) ?? '',
      levels,
    };
    const options = normalizedOptions(value.options, definition);
    if (options) drawing.options = options;
    const visibility = normalizedVisibility(value.visibility);
    if (visibility) drawing.visibility = visibility;
    definition?.validate?.(drawing);
    return drawing;
  }
  project(drawing: Drawing, context: DrawingContext): DrawingPrimitive[] {
    if (!drawingShown(drawing, context.interval)) return [];
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
  return {
    ...drawing,
    points,
    style: { ...drawing.style },
    levels: [...drawing.levels],
    ...(drawing.options ? { options: { ...drawing.options } } : {}),
    ...(drawing.visibility ? { visibility: structuredClone(drawing.visibility) } : {}),
  };
}
