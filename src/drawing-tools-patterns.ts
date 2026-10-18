import {
  choice,
  drawingOption,
  fill,
  line,
  midpoint,
  path,
  screen,
  text,
  toggle,
} from './drawing-primitives.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingOptionValue,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
  DrawingToolDefinition,
} from './drawing-types.ts';

/** Chart patterns and Elliott waves (Patterns family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */

const labelColor: DrawingSetting = {
  key: 'labelColor',
  label: 'Text colour',
  kind: 'color',
  default: '',
  section: 'Labels',
};
const patternSettings = (background: boolean, ratios: boolean): DrawingSetting[] => [
  ...(background ? [toggle('background', 'Background', true, 'Style')] : []),
  labelColor,
  ...(ratios ? [toggle('ratios', 'Show ratios', true, 'Labels')] : []),
];

/** Elliott degrees from largest to smallest, with the usual label notation and a colour each. */
type Numbers = 'roman' | 'digits' | 'small-roman';
const DEGREES: readonly {
  value: string;
  label: string;
  numbers: Numbers;
  wrap: 'double' | 'paren' | 'plain' | 'circle';
  color: string;
}[] = [
  {
    value: 'grand-supercycle',
    label: 'Grand supercycle',
    numbers: 'roman',
    wrap: 'double',
    color: '#e91e63',
  },
  { value: 'supercycle', label: 'Supercycle', numbers: 'roman', wrap: 'paren', color: '#9c27b0' },
  { value: 'cycle', label: 'Cycle', numbers: 'roman', wrap: 'plain', color: '#673ab7' },
  { value: 'primary', label: 'Primary', numbers: 'digits', wrap: 'circle', color: '#2962ff' },
  { value: 'intermediate', label: 'Intermediate', numbers: 'digits', wrap: 'paren', color: '#089981' },
  { value: 'minor', label: 'Minor', numbers: 'digits', wrap: 'plain', color: '#4caf50' },
  { value: 'minute', label: 'Minute', numbers: 'small-roman', wrap: 'circle', color: '#ff9800' },
  { value: 'minuette', label: 'Minuette', numbers: 'small-roman', wrap: 'paren', color: '#f23645' },
  { value: 'subminuette', label: 'Subminuette', numbers: 'small-roman', wrap: 'plain', color: '#00bcd4' },
];
const elliottSettings: DrawingSetting[] = [
  choice(
    'degree',
    'Degree',
    'intermediate',
    DEGREES.map(d => [d.value, d.label] as const),
    'Wave',
  ),
  toggle('showWave', 'Show wave', true, 'Wave'),
  labelColor,
];

const option = <T extends DrawingOptionValue>(
  d: Drawing,
  key: string,
  settings: readonly DrawingSetting[],
): T => drawingOption<T>(d, { settings }, key);

/** Dark or white text, whichever reads better on a label box in `color`. */
function contrast(color: string): string {
  const hex = color.replace('#', ''),
    full = hex.length < 6 ? [...hex.slice(0, 3)].map(c => c + c).join('') : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#131722' : '#ffffff';
}
/** A point is a high when it sits above its neighbours on screen; the first point compares with the next. */
function isHigh(points: DrawingPoint[], i: number): boolean {
  const neighbours = [points[i - 1], points[i + 1]].filter(Boolean);
  if (!neighbours.length) return true;
  return points[i].y <= neighbours.reduce((sum, p) => sum + p.y, 0) / neighbours.length;
}
/** Label centre just above a high or below a low, clear of the anchor handle. */
function labelAt(p: DrawingPoint, high: boolean, size: number, gap: number): DrawingPoint {
  const offset = size / 2 + gap;
  return { x: p.x, y: p.y + (high ? -offset : offset) };
}
/** Value of `leg` as a multiple of `base`, rounded like a Fibonacci ratio. */
function ratio(leg: number, base: number): string | undefined {
  if (!base || !Number.isFinite(leg / base)) return undefined;
  return String(Number(Math.abs(leg / base).toFixed(3)));
}
function intersect(a: DrawingPoint, b: DrawingPoint, c: DrawingPoint, d: DrawingPoint) {
  const r = { x: b.x - a.x, y: b.y - a.y },
    s = { x: d.x - c.x, y: d.y - c.y },
    cross = r.x * s.y - r.y * s.x;
  if (Math.abs(cross) < 1e-9) return undefined;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / cross,
    u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / cross;
  return { t, u, at: { x: a.x + r.x * t, y: a.y + r.y * t } };
}

/** Shared drawing kit for chart patterns: zigzag legs, fills, boxed labels and dashed ratio lines. */
function patternKit(d: Drawing, c: DrawingContext, settings: readonly DrawingSetting[]) {
  const points = screen(d, c),
    color = d.style.color,
    ink = option<string>(d, 'labelColor', settings) || contrast(color),
    size = d.style.fontSize,
    background = settings.some(s => s.key === 'background') && option<boolean>(d, 'background', settings),
    ratios = settings.some(s => s.key === 'ratios') && option<boolean>(d, 'ratios', settings);
  const box = { background: color, backgroundOpacity: 0.9, color: ink, radius: 3 };
  return {
    points,
    zigzag: (): DrawingPrimitive[] => (points.length > 1 ? [path(points)] : []),
    area: (...corners: (DrawingPoint | undefined)[]): DrawingPrimitive[] =>
      background && corners.every(Boolean) ? [fill(corners as DrawingPoint[], color)] : [],
    label: (i: number, value: string, high?: boolean): DrawingPrimitive[] =>
      points[i]
        ? [
            text(labelAt(points[i], high ?? isHigh(points, i), size, 10), value, {
              ...box,
              align: 'center',
              middle: true,
              bold: true,
            }),
          ]
        : [],
    /** Dashed connector between two anchors with `value` boxed at its midpoint. */
    connector: (i: number, j: number, value?: string): DrawingPrimitive[] => {
      const a = points[i],
        b = points[j];
      if (!a || !b) return [];
      return [
        ...line(a, b, c, 0, 1, { dash: [5, 4], width: 1 }),
        ...(ratios && value
          ? [
              text(midpoint(a, b), value, {
                ...box,
                align: 'center',
                middle: true,
                size: Math.max(10, size - 1),
              }),
            ]
          : []),
      ];
    },
  };
}
const leg = (d: Drawing, i: number, j: number): number =>
  d.points[i] && d.points[j] ? d.points[j].price - d.points[i].price : 0;

const XABCD_SETTINGS = patternSettings(true, true);
const xabcd = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, XABCD_SETTINGS),
    [x, a, b, cc, dd] = k.points;
  return [
    ...k.area(x, a, b),
    ...k.area(b, cc, dd),
    ...k.zigzag(),
    ...k.connector(0, 2, ratio(leg(d, 1, 2), leg(d, 0, 1))),
    ...k.connector(1, 3, ratio(leg(d, 2, 3), leg(d, 1, 2))),
    ...k.connector(2, 4, ratio(leg(d, 3, 4), leg(d, 2, 3))),
    ...k.connector(0, 4, ratio(leg(d, 1, 4), leg(d, 1, 0))),
    ...['X', 'A', 'B', 'C', 'D'].flatMap((name, i) => k.label(i, name)),
  ];
};
/** Cypher: C extends XA from X, and D retraces XC, so the second triangle hangs off X. */
const cypher = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, XABCD_SETTINGS),
    [x, a, b, cc, dd] = k.points;
  return [
    ...k.area(x, a, b),
    ...k.area(x, cc, dd),
    ...k.zigzag(),
    ...k.connector(0, 2, ratio(leg(d, 1, 2), leg(d, 0, 1))),
    ...k.connector(1, 3, ratio(leg(d, 0, 3), leg(d, 0, 1))),
    ...k.connector(0, 3),
    ...k.connector(0, 4, ratio(leg(d, 3, 4), leg(d, 3, 0))),
    ...['X', 'A', 'B', 'C', 'D'].flatMap((name, i) => k.label(i, name)),
  ];
};
const ABCD_SETTINGS = patternSettings(false, true);
const abcd = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, ABCD_SETTINGS);
  return [
    ...k.zigzag(),
    ...k.connector(0, 2, ratio(leg(d, 1, 2), leg(d, 0, 1))),
    ...k.connector(1, 3, ratio(leg(d, 2, 3), leg(d, 1, 2))),
    ...['A', 'B', 'C', 'D'].flatMap((name, i) => k.label(i, name)),
  ];
};
const SHADED_SETTINGS = patternSettings(true, false);
/** Start, left shoulder, trough, head, trough, right shoulder, end. The neckline joins the troughs. */
const headAndShoulders = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, SHADED_SETTINGS),
    [start, left, first, head, second, right, end] = k.points;
  const scene: DrawingPrimitive[] = [];
  // The neckline runs from the start to the end bar, and the shading sits between it and each peak.
  const neck = first && second && (first.x !== second.x || first.y !== second.y);
  const onNeck = (from?: DrawingPoint, to?: DrawingPoint) => {
    if (!neck || !from || !to) return from;
    const hit = intersect(first, second, from, to);
    return hit && hit.u >= 0 && hit.u <= 1 ? hit.at : from;
  };
  scene.push(...k.area(onNeck(start, left), left, first));
  scene.push(...k.area(first, head, second));
  scene.push(...k.area(second, right, onNeck(end, right)));
  scene.push(...k.zigzag());
  if (neck) {
    const span = second.x - first.x,
      lowX = Math.min(start.x, first.x),
      highX = Math.max(end?.x ?? right?.x ?? second.x, second.x);
    scene.push(
      ...(span
        ? line(first, second, c, (lowX - first.x) / span, (highX - first.x) / span, { width: 1 })
        : line(first, second, c)),
    );
  }
  const high = head ? isHigh(k.points, 3) : left ? isHigh(k.points, 1) : true;
  scene.push(
    ...k.label(1, 'Left Shoulder', high),
    ...k.label(3, 'Head', high),
    ...k.label(5, 'Right Shoulder', high),
  );
  return scene;
};
/** Two converging trendlines through A–C and B–D, shaded up to their apex. */
const trianglePattern = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, SHADED_SETTINGS),
    [a, b, cc, dd] = k.points;
  const scene: DrawingPrimitive[] = [];
  if (dd) {
    const hit = intersect(a, cc, b, dd),
      span = Math.max(Math.abs(cc.x - a.x), Math.abs(dd.x - b.x), 1);
    // A far or backwards apex would shade half the chart, so the lines then stop at the last bar.
    if (hit && hit.t > 1 && hit.u > 1 && Math.abs(hit.at.x - a.x) < span * 6) {
      scene.push(...k.area(a, hit.at, b), path([a, hit.at], { width: 1 }), path([b, hit.at], { width: 1 }));
    } else {
      const reach = Math.max(cc.x, dd.x);
      const extend = (p: DrawingPoint, q: DrawingPoint) =>
        q.x !== p.x ? { x: reach, y: p.y + ((q.y - p.y) * (reach - p.x)) / (q.x - p.x) } : q;
      const top = extend(a, cc),
        bottom = extend(b, dd);
      scene.push(...k.area(a, top, bottom, b), path([a, top], { width: 1 }), path([b, bottom], { width: 1 }));
    }
  }
  return [...scene, ...k.zigzag(), ...['A', 'B', 'C', 'D'].flatMap((name, i) => k.label(i, name))];
};
const DRIVES_SETTINGS = patternSettings(false, true);
/** Start, drive 1, A, drive 2, B, drive 3, reversal. Drives extend the prior correction; A and B retrace. */
const threeDrives = (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
  const k = patternKit(d, c, DRIVES_SETTINGS);
  return [
    ...k.zigzag(),
    ...k.connector(0, 2, ratio(leg(d, 1, 2), leg(d, 0, 1))),
    ...k.connector(1, 3, ratio(leg(d, 2, 3), leg(d, 1, 2))),
    ...k.connector(2, 4, ratio(leg(d, 3, 4), leg(d, 2, 3))),
    ...k.connector(3, 5, ratio(leg(d, 4, 5), leg(d, 3, 4))),
    ...k.label(1, 'Drive 1'),
    ...k.label(2, 'A'),
    ...k.label(3, 'Drive 2'),
    ...k.label(4, 'B'),
    ...k.label(5, 'Drive 3'),
  ];
};

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
/** Formats a wave name such as `3` or `B` in a degree's notation, like (3), III, ⓘ or ((B)). */
export function elliottLabel(name: string, degree: string): { text: string; circle: boolean } {
  const notation = DEGREES.find(d => d.value === degree) ?? DEGREES[4],
    digit = /^\d$/.test(name);
  let value = digit && notation.numbers !== 'digits' && name !== '0' ? (ROMAN[Number(name)] ?? name) : name;
  if (notation.numbers === 'small-roman') value = value.toLowerCase();
  if (notation.wrap === 'paren') value = `(${value})`;
  if (notation.wrap === 'double') value = `((${value}))`;
  return { text: value, circle: notation.wrap === 'circle' };
}
export const elliottDegreeColor = (degree: string): string =>
  (DEGREES.find(d => d.value === degree) ?? DEGREES[4]).color;

function ellipse(at: DrawingPoint, rx: number, ry: number, color: string): DrawingPrimitive {
  return path(
    Array.from({ length: 24 }, (_, i) => ({
      x: at.x + rx * Math.cos((i / 24) * Math.PI * 2),
      y: at.y + ry * Math.sin((i / 24) * Math.PI * 2),
    })),
    { closed: true, color, width: 1, dash: [] },
  );
}
const elliott =
  (names: readonly string[]) =>
  (d: Drawing, c: DrawingContext): DrawingPrimitive[] => {
    const points = screen(d, c),
      degree = option<string>(d, 'degree', elliottSettings),
      color = option<string>(d, 'labelColor', elliottSettings) || elliottDegreeColor(degree),
      size = d.style.fontSize,
      font = `${size}px ${c.theme?.typography.annotationFamily ?? 'monospace'}`;
    const scene: DrawingPrimitive[] =
      option(d, 'showWave', elliottSettings) && points.length > 1 ? [path(points)] : [];
    points.forEach((p, i) => {
      const label = elliottLabel(names[i] ?? '', degree);
      if (!label.text) return;
      const width = c.measureText?.(label.text, font) ?? label.text.length * size * 0.62,
        radius = Math.max(size * 0.72, width / 2 + 3),
        at = labelAt(p, isHigh(points, i), label.circle ? radius * 2 : size, label.circle ? 6 : 8);
      scene.push(text(at, label.text, { color, plain: true, align: 'center', middle: true, bold: true }));
      if (label.circle) scene.push(ellipse(at, radius, size * 0.72, color));
    });
    return scene;
  };

const tool = (
  type: string,
  label: string,
  section: string,
  points: number,
  hint: string,
  project: DrawingToolDefinition['project'],
  settings: readonly DrawingSetting[],
): DrawingToolDefinition => ({ type, label, group: 'Patterns', section, points, hint, project, settings });

/** Chart patterns. */
export const patternTools: readonly DrawingToolDefinition[] = [
  tool('xabcd', 'XABCD pattern', 'Chart patterns', 5, 'Click X, A, B, C and D.', xabcd, XABCD_SETTINGS),
  tool('cypher', 'Cypher pattern', 'Chart patterns', 5, 'Click X, A, B, C and D.', cypher, XABCD_SETTINGS),
  tool(
    'head-and-shoulders',
    'Head and shoulders',
    'Chart patterns',
    7,
    'Click the start, left shoulder, trough, head, trough, right shoulder and end.',
    headAndShoulders,
    SHADED_SETTINGS,
  ),
  tool('abcd', 'ABCD pattern', 'Chart patterns', 4, 'Click A, B, C and D.', abcd, ABCD_SETTINGS),
  tool(
    'triangle-pattern',
    'Triangle pattern',
    'Chart patterns',
    4,
    'Click A, B, C and D on alternating sides.',
    trianglePattern,
    SHADED_SETTINGS,
  ),
  tool(
    'three-drives',
    'Three drives pattern',
    'Chart patterns',
    7,
    'Click the start, then each drive and correction, then the reversal.',
    threeDrives,
    DRIVES_SETTINGS,
  ),
];
const wave = (type: string, label: string, names: readonly string[]) =>
  tool(
    type,
    label,
    'Elliott waves',
    names.length,
    `Click waves ${names.join(', ')}.`,
    elliott(names),
    elliottSettings,
  );
/** Elliott waves. */
export const elliottTools: readonly DrawingToolDefinition[] = [
  wave('elliott-impulse', 'Elliott impulse wave (12345)', ['0', '1', '2', '3', '4', '5']),
  wave('elliott-correction', 'Elliott correction wave (ABC)', ['0', 'A', 'B', 'C']),
  wave('elliott-triangle', 'Elliott triangle wave (ABCDE)', ['0', 'A', 'B', 'C', 'D', 'E']),
  wave('elliott-double-combo', 'Elliott double combo wave (WXY)', ['0', 'W', 'X', 'Y']),
  wave('elliott-triple-combo', 'Elliott triple combo wave (WXYXZ)', ['0', 'W', 'X', 'Y', 'X', 'Z']),
];
/** 24-unit SVG paths keyed by tool type. The XABCD icon already lives in ui-icons.ts as the family icon. */
export const patternsIcons: Readonly<Record<string, string>> = {
  cypher: '<path d="m3 17 5-12 4 7 6-9 3 14"/><path d="M3 17h18M3 17 18 3" stroke-dasharray="2 2"/>',
  'head-and-shoulders':
    '<path d="m2 18 4-8 3 4 3-10 3 10 3-4 4 8"/><path d="M4 14h16" stroke-dasharray="2 2"/>',
  abcd: '<path d="m4 19 5-12 5 7 6-10"/><path d="M4 19 14 14M9 7l11-3" stroke-dasharray="2 2"/>',
  'triangle-pattern':
    '<path d="m3 5 4 13 4-10 4 7 3-4"/><path d="m3 5 18 8M7 18l14-5" stroke-dasharray="2 2"/>',
  'three-drives': '<path d="m2 20 4-8 3 3 5-8 3 3 5-8"/><path d="M6 12 14 7l8-5" stroke-dasharray="2 2"/>',
  'elliott-impulse':
    '<path d="m3 19 4-7 3 3 5-11 3 6 3-4"/><circle cx="7" cy="12" r="1"/><circle cx="15" cy="4" r="1"/><circle cx="21" cy="6" r="1"/>',
  'elliott-correction':
    '<path d="m3 5 6 10 4-5 8 9"/><circle cx="9" cy="15" r="1"/><circle cx="13" cy="10" r="1"/>',
  'elliott-triangle':
    '<path d="m3 4 4 15 3-11 3 8 3-5 2 3 3-2"/><path d="m3 4 18 8M7 19l14-7" stroke-dasharray="1 2"/>',
  'elliott-double-combo': '<path d="m3 5 4 7 3-3 4 8 3-4 4 7"/><circle cx="10" cy="9" r="1"/>',
  'elliott-triple-combo':
    '<path d="m2 4 3 6 3-3 3 7 3-3 3 7 3-3 2 5"/><circle cx="8" cy="7" r="1"/><circle cx="14" cy="11" r="1"/>',
};
