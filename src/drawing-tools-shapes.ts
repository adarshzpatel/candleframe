import {
  add,
  arrowHead,
  axisTag,
  choice,
  drawingOption,
  fill,
  midpoint,
  path,
  plotPoint,
  rectangle,
  screen,
  text,
  toggle,
} from './drawing-primitives.ts';
import { chartThemes } from './themes.ts';
import type { Anchor, Candle } from './types.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingOptionValue,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
  DrawingToolDefinition,
} from './drawing-types.ts';

/** Extra shapes, arrows and notes. Registered in drawing-tools.ts; icons merge into ui-icons.ts. */

const settingsByType = new Map<string, readonly DrawingSetting[]>();
const option = <T extends DrawingOptionValue>(d: Drawing, key: string): T =>
  drawingOption<T>(d, { settings: settingsByType.get(d.type) }, key);

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
      : `Click ${points === 1 ? 'one point' : `${points} points`} to place.`,
  ...extra,
});

const ENDS = [
  ['normal', 'Normal'],
  ['arrow', 'Arrow'],
] as const;
const endSettings = (right: string): DrawingSetting[] => [
  choice('leftEnd', 'Left end', 'normal', ENDS, 'Line'),
  choice('rightEnd', 'Right end', right, ENDS, 'Line'),
];
const backgroundSetting = toggle('background', 'Background', true, 'Style');
// Same fields as the built-in text tools: the background is a 20% tint of the text colour by default.
const textSettings = (background: boolean, border = false): DrawingSetting[] => [
  toggle('bold', 'Bold', false, 'Text'),
  toggle('italic', 'Italic', false, 'Text'),
  toggle('border', 'Border', border, 'Text'),
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

/** Text primitive options from the text settings. */
function look(d: Drawing) {
  return {
    bold: option<boolean>(d, 'bold'),
    italic: option<boolean>(d, 'italic'),
    plain: !option<boolean>(d, 'background'),
    background: option<string>(d, 'backgroundColor') || d.style.color,
    backgroundOpacity: option<number>(d, 'backgroundOpacity'),
    ...(option(d, 'border') ? { border: d.style.color } : {}),
  };
}
/** Text metrics that match the scene's text boxes. */
function metrics(d: Drawing, c: DrawingContext, bold = option<boolean>(d, 'bold')) {
  const theme = c.theme ?? chartThemes.evergreen,
    size = d.style.fontSize;
  const font = `${option(d, 'italic') ? 'italic ' : ''}${bold ? '600 ' : ''}${size}px ${theme.typography.annotationFamily}`;
  return {
    size,
    padding: theme.chart.annotationPadding,
    width: (value: string) =>
      Math.max(...value.split('\n').map(line => c.measureText?.(line, font) ?? line.length * size * 0.62)),
    /** Height of a boxed text primitive, as the scene lays it out. */
    height: (value: string) => value.split('\n').length * (size + 4) + theme.chart.annotationPadding,
  };
}

const unit = (a: DrawingPoint, b: DrawingPoint) => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length, length } : undefined;
};
/** Signed distance of `p` from the line through `a` along unit `u`, measured along the left normal. */
const offset = (p: DrawingPoint, a: DrawingPoint, u: DrawingPoint) => (p.x - a.x) * -u.y + (p.y - a.y) * u.x;
const ring = (center: DrawingPoint, rx: number, ry: number, steps: number): DrawingPoint[] =>
  Array.from({ length: steps }, (_, i) => ({
    x: center.x + rx * Math.cos((i / steps) * Math.PI * 2),
    y: center.y + ry * Math.sin((i / steps) * Math.PI * 2),
  }));
const quadratic = (a: DrawingPoint, q: DrawingPoint, b: DrawingPoint, steps = 48): DrawingPoint[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps,
      s = 1 - t;
    return { x: s * s * a.x + 2 * s * t * q.x + t * t * b.x, y: s * s * a.y + 2 * s * t * q.y + t * t * b.y };
  });
/** The control point of a quadratic from `a` to `b` that passes through `p` halfway. */
const through = (a: DrawingPoint, p: DrawingPoint, b: DrawingPoint): DrawingPoint => ({
  x: 2 * p.x - (a.x + b.x) / 2,
  y: 2 * p.y - (a.y + b.y) / 2,
});
const outlined = (d: Drawing, outline: DrawingPoint[]): DrawingPrimitive[] => [
  ...(option(d, 'background') ? [fill(outline, d.style.color)] : []),
  path(outline, { closed: true }),
];
/** Arrowheads on an open path's ends, aimed along the last distinct segment. */
function ends(d: Drawing, points: DrawingPoint[]): DrawingPrimitive[] {
  const result: DrawingPrimitive[] = [];
  const end = (index: number, step: number) => {
    const tip = points[index];
    for (let i = index + step; i >= 0 && i < points.length; i += step)
      if (points[i].x !== tip.x || points[i].y !== tip.y)
        return result.push(...arrowHead(points[i], tip, d.style.width));
  };
  if (option(d, 'leftEnd') === 'arrow') end(0, 1);
  if (option(d, 'rightEnd') === 'arrow') end(points.length - 1, -1);
  return result;
}

function rotatedRectangle(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, p] = screen(d, c);
  if (!b) return [];
  const u = unit(a, b);
  if (!p || !u) return [path([a, b])];
  const n = { x: -u.y, y: u.x },
    h = offset(p, a, u);
  return outlined(d, [a, b, add(b, n, h), add(a, n, h)]);
}
function circle(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [center, edge] = screen(d, c);
  if (!edge) return [];
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  return outlined(d, ring(center, r, r, Math.min(180, Math.max(24, Math.ceil(r / 2)))));
}
function polyline(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c);
  return points.length < 2 ? [] : [path(points), ...ends(d, points)];
}
/** Half an ellipse over the chord from start to end; the third point sets its height. */
function arc(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, p] = screen(d, c);
  if (!b) return [];
  const u = unit(a, b);
  if (!p || !u) return [path([a, b])];
  const m = midpoint(a, b),
    r = u.length / 2,
    h = offset(p, m, u);
  const points = Array.from({ length: 65 }, (_, i) => {
    const t = (i / 64) * Math.PI;
    return {
      x: m.x - u.x * r * Math.cos(t) - u.y * h * Math.sin(t),
      y: m.y - u.y * r * Math.cos(t) + u.x * h * Math.sin(t),
    };
  });
  return [...(option(d, 'background') ? [fill(points, d.style.color)] : []), path(points)];
}
/** A quadratic through the third point; the double curve mirrors it into an S around the middle. */
function curve(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b, p] = screen(d, c);
  if (!b) return [];
  if (!p) return [path([a, b])];
  let points: DrawingPoint[];
  if (d.type === 'double-curve') {
    const m = midpoint(a, b),
      q = through(a, p, m);
    points = [
      ...quadratic(a, q, m, 32),
      ...quadratic(m, { x: 2 * m.x - q.x, y: 2 * m.y - q.y }, b, 32).slice(1),
    ];
  } else points = quadratic(a, through(a, p, b), b);
  return [path(points), ...ends(d, points)];
}

/** The candle whose bar contains `timeMs`. */
function barAt(
  candles: readonly Candle[] | undefined,
  timeMs: number,
  intervalMs: number,
): Candle | undefined {
  if (!candles?.length) return undefined;
  let low = 0,
    high = candles.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (candles[mid].timeMs <= timeMs) low = mid;
    else high = mid - 1;
  }
  const bar = candles[low];
  return bar.timeMs <= timeMs && timeMs < bar.timeMs + intervalMs ? bar : undefined;
}
/** Text beside an arrow's tail, on the side away from the tip. */
function tailText(d: Drawing, c: DrawingContext, tail: DrawingPoint, u: DrawingPoint): DrawingPrimitive[] {
  if (!d.text) return [];
  const m = metrics(d, c),
    across = Math.abs(u.x) > Math.abs(u.y) * 0.6;
  const at = across
    ? { x: tail.x - u.x * 8, y: tail.y }
    : { x: tail.x, y: tail.y - Math.sign(u.y) * (8 + m.height(d.text) / 2) };
  return [
    text(at, d.text, {
      ...look(d),
      middle: true,
      align: across ? (u.x > 0 ? 'right' : 'left') : 'center',
    }),
  ];
}
function arrowMarker(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [tail, tip] = screen(d, c);
  if (!tip) return [];
  const u = unit(tail, tip);
  if (!u) return [];
  const n = { x: -u.y, y: u.x },
    head = Math.min(u.length, Math.max(12, Math.min(36, u.length * 0.3))),
    wide = head * 0.7,
    shaft = wide * 0.45,
    neck = add(tip, u, -head);
  const outline = [
    add(tail, n, shaft),
    add(neck, n, shaft),
    add(neck, n, wide),
    tip,
    add(neck, n, -wide),
    add(neck, n, -shaft),
    add(tail, n, -shaft),
  ];
  return [fill(outline, d.style.color, 1), ...tailText(d, c, tail, u)];
}
/** Up marks start under the bar's low and down marks over its high. */
const markCreate =
  (up: boolean) =>
  (anchor: Anchor, c: DrawingContext): Anchor[] => {
    const bar = barAt(c.candles, anchor.timeMs, c.intervalMs);
    return bar ? [{ timeMs: bar.timeMs + c.intervalMs / 2, price: up ? bar.low : bar.high }] : [anchor];
  };
function arrowMark(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  // `s` points from the tip into the body: down the screen for an up mark.
  const s = d.type === 'arrow-mark-up' ? 1 : -1,
    wide = 9 + d.style.width,
    head = wide * 1.1,
    shaft = wide * 0.42,
    length = wide * 2.6,
    tip = { x: p.x, y: p.y + s * 4 };
  const at = (dx: number, dy: number) => ({ x: tip.x + dx, y: tip.y + s * dy });
  const outline = [
    tip,
    at(wide, head),
    at(shaft, head),
    at(shaft, length),
    at(-shaft, length),
    at(-shaft, head),
    at(-wide, head),
  ];
  return [
    fill(outline, option<string>(d, 'arrowColor'), 1),
    ...tailText(d, c, at(0, length), { x: 0, y: -s }),
  ];
}

/** A speech-bubble tooltip above a marker, shown while hovered or selected. */
function tooltip(d: Drawing, c: DrawingContext, x: number, bottom: number): DrawingPrimitive[] {
  if (!d.text || !(c.selected || c.hovered)) return [];
  const m = metrics(d, c);
  return [
    text({ x, y: bottom - 6 - m.height(d.text) / 2 }, d.text, { ...look(d), align: 'center', middle: true }),
  ];
}
/** A sticky-note marker whose pointer touches `p`. */
function noteMarker(d: Drawing, p: DrawingPoint): DrawingPrimitive[] {
  const bottom = p.y - 7,
    top = bottom - 16;
  return [
    fill(
      [
        { x: p.x - 9, y: top },
        { x: p.x + 9, y: top },
        { x: p.x + 9, y: bottom },
        { x: p.x + 4, y: bottom },
        p,
        { x: p.x - 4, y: bottom },
        { x: p.x - 9, y: bottom },
      ],
      d.style.color,
      1,
    ),
    path(
      [
        { x: p.x - 5, y: top + 5 },
        { x: p.x + 5, y: top + 5 },
      ],
      { color: '#ffffff', width: 1.5 },
    ),
    path(
      [
        { x: p.x - 5, y: top + 10 },
        { x: p.x + 2, y: top + 10 },
      ],
      { color: '#ffffff', width: 1.5 },
    ),
  ];
}
function note(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const p = d.type === 'anchored-note' ? plotPoint(d, c) : screen(d, c)[0];
  if (!p) return [];
  return [...noteMarker(d, p), ...tooltip(d, c, p.x, p.y - 23)];
}
/** A map pin: a round head that narrows to a point at the anchor. */
function pin(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  const r = 8,
    center = { x: p.x, y: p.y - 20 },
    spread = Math.acos(r / 20);
  const head = Array.from({ length: 33 }, (_, i) => {
    const t = Math.PI / 2 + spread + ((2 * Math.PI - 2 * spread) * i) / 32;
    return { x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) };
  });
  return [
    fill([...head, p], d.style.color, 1),
    fill(ring(center, 3, 3, 12), '#ffffff', 1),
    ...tooltip(d, c, p.x, center.y - r),
  ];
}
function priceNote(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c);
  if (!a) return [];
  const price = c.formatPrice(d.points[0].price),
    result: DrawingPrimitive[] = [axisTag('price', d.points[0].price, { color: d.style.color })];
  if (b) {
    result.push(
      path([a, b]),
      text(b, d.text ? `${d.text}\n${price}` : price, {
        ...look(d),
        middle: true,
        align: b.x >= a.x ? 'left' : 'right',
      }),
    );
  }
  result.push(fill(ring(a, 3 + d.style.width / 2, 3 + d.style.width / 2, 16), d.style.color, 1));
  return result;
}
/** A post from the anchor to a text plate above or below it. */
function signpost(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  const s = option(d, 'plate') === 'below' ? 1 : -1,
    m = metrics(d, c),
    label = d.text || ' ',
    end = { x: p.x, y: p.y + s * 48 };
  return [
    path([p, end]),
    fill(ring(p, 3, 3, 12), d.style.color, 1),
    text({ x: p.x, y: end.y + (s * m.height(label)) / 2 }, label, {
      ...look(d),
      align: 'center',
      middle: true,
    }),
  ];
}
function flag(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  const top = p.y - 30,
    wave = (y: number, reverse: boolean) => {
      const edge = Array.from({ length: 9 }, (_, i) => ({
        x: p.x + i * 2.5,
        y: y + Math.sin((i / 8) * Math.PI * 2) * 2,
      }));
      return reverse ? edge.reverse() : edge;
    };
  return [
    path([p, { x: p.x, y: top }], { width: 2 }),
    fill([...wave(top, false), ...wave(top + 13, true)], d.style.color, 1),
  ];
}
/** Rounded corners for a box path, clockwise from the top left. */
function rounded(x: number, y: number, w: number, h: number, r: number, tail: DrawingPoint[] = []) {
  const corner = (cx: number, cy: number, from: number) =>
    Array.from({ length: 5 }, (_, i) => {
      const t = from + (i / 4) * (Math.PI / 2);
      return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
    });
  return [
    ...corner(x + r, y + r, Math.PI),
    ...corner(x + w - r, y + r, -Math.PI / 2),
    ...corner(x + w - r, y + h - r, 0),
    ...tail,
    ...corner(x + r, y + h - r, Math.PI / 2),
  ];
}
/** A speech bubble whose tail points down at the anchor. */
function comment(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  const m = metrics(d, c),
    value = d.text || ' ',
    lines = value.split('\n').length,
    w = m.width(value) + m.padding * 2,
    h = lines * (m.size + 4) - 4 + m.padding * 2 + 2,
    x = p.x - 6,
    y = p.y - 10 - h;
  const outline = rounded(x, y, w, h, 6, [{ x: x + 22, y: y + h }, p, { x: x + 10, y: y + h }]);
  return [
    ...(option(d, 'background')
      ? [
          fill(
            outline,
            option<string>(d, 'backgroundColor') || d.style.color,
            option<number>(d, 'backgroundOpacity'),
          ),
        ]
      : []),
    ...(option(d, 'border') ? [path(outline, { closed: true, width: 1 })] : []),
    text({ x: x + m.padding - 2, y: y + m.padding + m.size }, d.text, {
      plain: true,
      bold: option<boolean>(d, 'bold'),
      italic: option<boolean>(d, 'italic'),
    }),
  ];
}

/** Rows split on new lines and cells on tabs or `|`; Markdown edge pipes and rule rows are dropped. */
export function tableCells(value: string): string[][] {
  return value
    .split('\n')
    .map(line => {
      const piped = /^\s*\|.*\|\s*$/.test(line) && line.trim().length > 1;
      return (piped ? line.trim().slice(1, -1) : line).split(/\t|\|/).map(cell => cell.trim());
    })
    .filter(row => !(row.length && row.every(cell => /^:?-{3,}:?$/.test(cell))));
}
function table(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [p] = screen(d, c);
  if (!p) return [];
  const cells = tableCells(d.text),
    rows = cells.length ? cells : [['']],
    header = option<boolean>(d, 'header') && rows.length > 1,
    columns = Math.max(...rows.map(row => row.length)),
    m = metrics(d, c),
    strong = metrics(d, c, true),
    pad = 6,
    height = m.size + 10;
  const widths = Array.from(
    { length: columns },
    (_, i) =>
      Math.max(16, ...rows.map((row, r) => (header && !r ? strong : m).width(row[i] ?? '') || 0)) + pad * 2,
  );
  const right = p.x + widths.reduce((sum, w) => sum + w, 0),
    bottom = p.y + rows.length * height,
    background = option<string>(d, 'backgroundColor') || d.style.color,
    opacity = option<number>(d, 'backgroundOpacity');
  const result: DrawingPrimitive[] = [];
  if (option(d, 'background')) {
    result.push(fill(rectangle(p, { x: right, y: bottom }), background, opacity));
    if (header) result.push(fill(rectangle(p, { x: right, y: p.y + height }), background, opacity));
  }
  // Without borders the frame stays as an invisible closed path, so the whole table is hittable.
  const border = option<boolean>(d, 'border');
  result.push(path(rectangle(p, { x: right, y: bottom }), { closed: true, width: border ? 1 : 0 }));
  if (border) {
    for (let r = 1; r < rows.length; r++)
      result.push(
        path(
          [
            { x: p.x, y: p.y + r * height },
            { x: right, y: p.y + r * height },
          ],
          { width: 1, opacity: 0.6 },
        ),
      );
    let x = p.x;
    for (const w of widths.slice(0, -1))
      result.push(
        path(
          [
            { x: (x += w), y: p.y },
            { x, y: bottom },
          ],
          { width: 1, opacity: 0.6 },
        ),
      );
  }
  rows.forEach((row, r) => {
    let x = p.x;
    row.forEach((cell, i) => {
      if (cell)
        result.push(
          text({ x: x + pad - 2, y: p.y + r * height + height / 2 }, cell, {
            plain: true,
            middle: true,
            bold: option<boolean>(d, 'bold') || (header && !r),
            italic: option<boolean>(d, 'italic'),
          }),
        );
      x += widths[i];
    });
  });
  return result;
}
function anchoredText(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const p = plotPoint(d, c);
  return p ? [text(p, d.text, look(d))] : [];
}
/** Plot-fixed drawings keep their handle where they are drawn, not at their stored anchor. */
const plotHandles = {
  fixedToPlot: true,
  handles: (d: Drawing, c: DrawingContext) => {
    const at = plotPoint(d, c);
    return at ? [{ id: 'plot', at, cursor: 'move' as const }] : [];
  },
  moveHandle: (_d: Drawing, _handle: string, anchor: Anchor) => [anchor],
};

/** Shapes after the polyline. */
export const shapeTools: readonly DrawingToolDefinition[] = [
  tool('rotated-rectangle', 'Rotated rectangle', 'Shapes', 'Shapes', 3, rotatedRectangle, {
    hint: 'Click two corners along one side, then the width.',
    settings: [backgroundSetting],
  }),
  tool('circle', 'Circle', 'Shapes', 'Shapes', 2, circle, {
    hint: 'Click the centre, then a point on the edge.',
    settings: [backgroundSetting],
  }),
  tool('path', 'Path', 'Shapes', 'Shapes', 'path', polyline, { settings: endSettings('arrow') }),
  tool('arc', 'Arc', 'Shapes', 'Shapes', 3, arc, {
    hint: 'Click the start and end, then the height of the arc.',
    settings: [backgroundSetting],
  }),
  tool('curve', 'Curve', 'Shapes', 'Shapes', 3, curve, {
    hint: 'Click the start and end, then where the curve bends.',
    settings: endSettings('normal'),
  }),
  tool('double-curve', 'Double curve', 'Shapes', 'Shapes', 3, curve, {
    hint: 'Click the start and end, then the peak of the first bend.',
    settings: endSettings('normal'),
  }),
];
/** Arrows after the arrow. */
export const arrowTools: readonly DrawingToolDefinition[] = [
  tool('arrow-marker', 'Arrow marker', 'Shapes', 'Arrows', 2, arrowMarker, {
    hint: 'Click the tail, then the tip.',
    settings: textSettings(false),
  }),
  ...(
    [
      ['arrow-mark-up', 'Arrow mark up', true, '#089981', 'below'],
      ['arrow-mark-down', 'Arrow mark down', false, '#f23645', 'above'],
    ] as const
  ).map(([type, label, up, color, side]) =>
    tool(type, label, 'Shapes', 'Arrows', 1, arrowMark, {
      hint: `Click a bar to mark it from ${side}.`,
      create: markCreate(up),
      settings: [
        { key: 'arrowColor', label: 'Arrow colour', kind: 'color', default: color, section: 'Style' },
        ...textSettings(false),
      ],
    }),
  ),
];
/** Text and notes after the price label. */
export const noteTools: readonly DrawingToolDefinition[] = [
  tool('note', 'Note', 'Annotations', 'Text and notes', 1, note, {
    hint: 'Click to place a note. Its text shows on hover.',
    editableText: true,
    settings: textSettings(true),
  }),
  tool('price-note', 'Price note', 'Annotations', 'Text and notes', 2, priceNote, {
    hint: 'Click a price, then where its label goes.',
    settings: textSettings(true),
  }),
  tool('pin', 'Pin', 'Annotations', 'Text and notes', 1, pin, {
    hint: 'Click to place a pin. Its text shows on hover.',
    editableText: true,
    settings: textSettings(true),
  }),
  tool('signpost', 'Signpost', 'Annotations', 'Text and notes', 1, signpost, {
    hint: 'Click a bar, then type the text for the sign.',
    editableText: true,
    settings: [
      choice(
        'plate',
        'Plate',
        'above',
        [
          ['above', 'Above'],
          ['below', 'Below'],
        ],
        'Style',
      ),
      ...textSettings(true, true),
    ],
  }),
  tool('flag-mark', 'Flag mark', 'Annotations', 'Text and notes', 1, flag, {
    hint: 'Click to place a flag.',
  }),
  tool('comment', 'Comment', 'Annotations', 'Text and notes', 1, comment, {
    hint: 'Click where the bubble points, then type your comment.',
    editableText: true,
    settings: textSettings(true, true),
  }),
  tool('table', 'Table', 'Annotations', 'Text and notes', 1, table, {
    hint: 'Click the top-left corner. Type one row per line and split cells with tabs or |.',
    editableText: true,
    settings: [toggle('header', 'Header row', true, 'Text'), ...textSettings(true, true)],
  }),
  tool('anchored-text', 'Anchored text', 'Annotations', 'Text and notes', 1, anchoredText, {
    hint: 'Click to place. The text keeps its place on screen while you pan.',
    editableText: true,
    settings: textSettings(false),
    ...plotHandles,
  }),
  tool('anchored-note', 'Anchored note', 'Annotations', 'Text and notes', 1, note, {
    hint: 'Click to place. The note keeps its place on screen while you pan.',
    editableText: true,
    settings: textSettings(true),
    ...plotHandles,
  }),
];
for (const definition of [...shapeTools, ...arrowTools, ...noteTools])
  if (definition.settings) settingsByType.set(definition.type, definition.settings);

/** 24-unit SVG paths keyed by tool type. */
export const shapesIcons: Readonly<Record<string, string>> = {
  'rotated-rectangle': '<path d="m3 14 9-10 9 7-9 10-9-7Z"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/><circle cx="12" cy="12" r=".8"/>',
  path: '<path d="m3 19 6-9 5 5 6-10m-5 0h5v5"/>',
  arc: '<path d="M3 18a9 8 0 0 1 18 0"/><path d="M3 18h18" stroke-dasharray="2 3"/>',
  curve: '<path d="M3 19Q12 0 21 19"/>',
  'double-curve': '<path d="M3 12Q7.5 1 12 12t9 0"/>',
  'arrow-marker': '<path d="M3 9.5h10V5l8 7-8 7v-4.5H3v-5Z"/>',
  'arrow-mark-up': '<path d="M12 3 5 11h4.5v9h5v-9H19l-7-8Z"/>',
  'arrow-mark-down': '<path d="M12 21 5 13h4.5V4h5v9H19l-7 8Z"/>',
  note: '<path d="M5 4h14v10l-5 5H5V4Z"/><path d="M14 19v-5h5M8 8h8m-8 3h5"/>',
  'price-note':
    '<circle cx="5" cy="18" r="1.5"/><path d="m6 17 5-5"/><rect x="11" y="5" width="10" height="7" rx="1"/><path d="M14 8.5h4"/>',
  pin: '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11Z"/><circle cx="12" cy="10" r="2"/>',
  signpost: '<path d="M12 21V11"/><rect x="5" y="4" width="14" height="7" rx="1"/><path d="M8 7.5h8"/>',
  'flag-mark': '<path d="M6 21V4c4-2 7 2 12 0v8c-5 2-8-2-12 0"/>',
  comment: '<path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 14.5h18M10 5v14"/>',
  'anchored-text': '<path d="M8 8V7h8v1M12 7v10m-2 0h4M3 7V3h4m10 0h4v4M3 17v4h4m10 0h4v-4"/>',
  'anchored-note':
    '<path d="M7 7h10v6l-4 4H7V7Z"/><path d="M13 17v-4h4M3 6V3h3m12 0h3v3M3 18v3h3m12 0h3v-3"/>',
};
