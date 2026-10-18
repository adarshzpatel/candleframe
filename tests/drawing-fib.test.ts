import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingRegistry, usesDrawingLevels } from '../src/drawing-tools.ts';
import { fibIcons, fibLevelDefaults, fibTools, gannTools, pitchforkTools } from '../src/drawing-tools-fib.ts';
import { geometryForRanges } from '../src/geometry.ts';
import type { Drawing, DrawingContext, DrawingPoint, DrawingPrimitive } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const g = context.geometry;
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, points = [point(20, 120), point(60, 170)], extras: Partial<Drawing> = {}) =>
  registry.normalize({ id: 'test', type, points, ...extras });
const project = (d: Drawing) => registry.project(d, context);
type Path = Extract<DrawingPrimitive, { kind: 'path' }>;
type Text = Extract<DrawingPrimitive, { kind: 'text' }>;
const strokes = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Path => p.kind === 'path' && !p.fill);
const fills = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Path => p.kind === 'path' && !!p.fill);
const labels = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Text => p.kind === 'text').map(p => p.text);
const screenOf = (p: { timeMs: number; price: number }) => ({ x: g.x(p.timeMs), y: g.y(p.price) });
const distance = (a: DrawingPoint, b: DrawingPoint) => Math.hypot(b.x - a.x, b.y - a.y);
/** Shortest distance from `p` to any segment of the path. */
const near = (path: Path, p: DrawingPoint) =>
  Math.min(
    ...path.points.slice(1).map((b, i) => {
      const a = path.points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        t =
          dx || dy
            ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
            : 0;
      return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    }),
  );
const passesThrough = (primitives: DrawingPrimitive[], p: DrawingPoint, tolerance = 1.5) =>
  strokes(primitives).some(path => near(path, p) <= tolerance);

test('Fib, Gann and pitchfork tools register in their families with icons', () => {
  const expected = {
    'fib-trend-time': ['Fib & Gann', 'Fibonacci', 3],
    'fib-arcs': ['Fib & Gann', 'Fibonacci', 2],
    'fib-circles': ['Fib & Gann', 'Fibonacci', 2],
    'fib-spiral': ['Fib & Gann', 'Fibonacci', 2],
    'fib-wedge': ['Fib & Gann', 'Fibonacci', 3],
    pitchfan: ['Fib & Gann', 'Fibonacci', 3],
    'gann-box': ['Fib & Gann', 'Gann', 2],
    'gann-square-fixed': ['Fib & Gann', 'Gann', 2],
    'gann-square': ['Fib & Gann', 'Gann', 2],
    'gann-fan': ['Fib & Gann', 'Gann', 2],
    'modified-schiff-pitchfork': ['Lines', 'Pitchforks', 3],
    'inside-pitchfork': ['Lines', 'Pitchforks', 3],
  };
  assert.deepEqual(
    [...fibTools, ...gannTools, ...pitchforkTools].map(t => t.type).sort(),
    Object.keys(expected).sort(),
  );
  for (const [type, [group, section, points]] of Object.entries(expected)) {
    const tool = registry.get(type);
    assert.deepEqual([tool?.group, tool?.section, tool?.points], [group, section, points], type);
    assert.ok(fibIcons[type], `${type} icon`);
  }
});

test('level defaults come from the tool, and saved levels override them', () => {
  assert.deepEqual(drawing('fib-arcs').levels, fibLevelDefaults['fib-arcs']);
  assert.deepEqual(drawing('gann-box').levels, [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
  assert.deepEqual(drawing('fib-spiral').levels, []);
  assert.ok(usesDrawingLevels('pitchfan') && usesDrawingLevels('gann-square'));
  assert.ok(
    !usesDrawingLevels('fib-spiral') && !usesDrawingLevels('gann-fan') && !usesDrawingLevels('trendline'),
  );
  assert.deepEqual(labels(project(drawing('fib-circles', undefined, { levels: [0.5, 2] }))), ['0.5', '2']);
  // Levels cleared in the settings panel fall back to the built-in set.
  assert.equal(
    labels(project({ ...drawing('fib-wedge', [point(20, 120), point(60, 170), point(60, 130)]), levels: [] }))
      .length,
    6,
  );
});

test('trend-based fib time repeats the first interval from the third point', () => {
  const d = drawing('fib-trend-time', [point(20, 120), point(30, 170), point(40, 150)], {
    levels: [0, 1, 2],
  });
  const xs = strokes(project(d))
    .filter(p => p.points.length === 2 && p.points[0].x === p.points[1].x)
    .map(p => p.points[0].x);
  const unit = g.x(30) - g.x(20);
  assert.deepEqual(
    xs.map(x => Math.round(x)),
    [0, 1, 2].map(level => Math.round(g.x(40) + unit * level)),
  );
  assert.equal(fills(project(d)).length, 0, 'no background by default');
  assert.equal(fills(project({ ...d, options: { background: true } })).length, 2);
});

test('speed resistance arcs centre on the first point and level 1 passes through the second', () => {
  const d = drawing('fib-arcs', undefined, { levels: [0.5, 1] });
  const [a, b] = d.points.map(screenOf);
  assert.ok(passesThrough(project(d), b));
  const half = strokes(project(d)).find(p => p.points.length > 8)!;
  // The second point is above the first, so the half circles open upwards.
  assert.ok(half.points.every(p => p.y <= a.y + 0.001));
  assert.ok(Math.abs(Math.max(...half.points.map(p => distance(a, p))) - distance(a, b) / 2) < 0.01);
  const full = strokes(project({ ...d, options: { fullCircles: true } })).find(p => p.points.length > 8)!;
  assert.ok(full.points.some(p => p.y > a.y + 1));
});

test('fib circles centre on the midpoint with level 1 through both points', () => {
  const d = drawing('fib-circles', undefined, { levels: [1] });
  const [a, b] = d.points.map(screenOf);
  assert.ok(passesThrough(project(d), a) && passesThrough(project(d), b));
});

test('the fib spiral passes through its second point and grows by phi each quarter turn', () => {
  const d = drawing('fib-spiral');
  const [a, b] = d.points.map(screenOf);
  const curve = strokes(project(d))[0];
  assert.ok(near(curve, b) < 1);
  const radii = curve.points.map(p => distance(a, p));
  assert.ok(
    radii.every((r, i) => !i || r >= radii[i - 1]),
    'radius only grows',
  );
  const counter = strokes(project({ ...d, options: { counterclockwise: true } }))[0];
  assert.notDeepEqual(counter.points[counter.points.length - 1], curve.points[curve.points.length - 1]);
  assert.ok(near(counter, b) < 1);
});

test('fib wedge arcs stay between the two rays from the apex', () => {
  const d = drawing('fib-wedge', [point(20, 150), point(60, 180), point(60, 120)], { levels: [0.5, 1] });
  const [a, b, c] = d.points.map(screenOf);
  const angles = [b, c].map(p => Math.atan2(p.y - a.y, p.x - a.x));
  const arcs = strokes(project(d)).filter(p => p.points.length > 8);
  assert.equal(arcs.length, 2);
  for (const arc of arcs)
    for (const p of arc.points) {
      const t = Math.atan2(p.y - a.y, p.x - a.x);
      assert.ok(t >= Math.min(...angles) - 1e-6 && t <= Math.max(...angles) + 1e-6);
    }
  assert.ok(passesThrough(project(d), b));
});

test('pitchfan rays run from the origin through the median and both fork anchors', () => {
  const d = drawing('pitchfan', [point(10, 150), point(50, 180), point(50, 120)], { levels: [0, 1] });
  const [, b, c] = d.points.map(screenOf),
    primitives = project(d);
  for (const p of [b, c, { x: b.x, y: (b.y + c.y) / 2 }]) assert.ok(passesThrough(primitives, p));
  assert.deepEqual(labels(primitives), ['0', '1', '1']);
});

test('gann fan lines run at the Gann ratios with 1x1 through the second point', () => {
  const d = drawing('gann-fan');
  const [a, b] = d.points.map(screenOf),
    primitives = project(d);
  assert.deepEqual(labels(primitives), ['1x8', '1x4', '1x3', '1x2', '1x1', '2x1', '3x1', '4x1', '8x1']);
  assert.ok(passesThrough(primitives, b));
  assert.ok(passesThrough(primitives, { x: b.x, y: a.y + (b.y - a.y) / 2 }), '1x2');
  assert.ok(passesThrough(primitives, { x: a.x + (b.x - a.x) / 2, y: b.y }), '2x1');
  assert.equal(fills(primitives).length, 8);
  const plain = project({ ...d, options: { levelColors: false, background: false } });
  assert.ok(strokes(plain).every(p => p.color === d.style.color) && !fills(plain).length);
});

test('gann box draws price and time levels with labels and optional angles', () => {
  const d = drawing('gann-box', undefined, { levels: [0, 0.5, 1] });
  const [a, b] = d.points.map(screenOf),
    primitives = project(d);
  const horizontal = strokes(primitives).filter(p => p.points[0].y === p.points[1].y);
  assert.deepEqual(
    horizontal.map(p => p.points[0].y),
    [a.y, (a.y + b.y) / 2, b.y],
  );
  assert.equal(fills(primitives).length, 4, 'price and time bands');
  assert.deepEqual(labels(primitives), ['0', '0', '0.5', '0.5', '1', '1']);
  const reversed = strokes(project({ ...d, options: { reverse: true } })).filter(
    p => p.points[0].y === p.points[1].y,
  );
  assert.equal(reversed[0].points[0].y, b.y);
  assert.equal(strokes(project({ ...d, options: { angles: true } })).length, strokes(primitives).length + 2);
});

test('gann squares draw a level grid, fans from the origin and arcs', () => {
  const square = project(drawing('gann-square'));
  const [a, b] = drawing('gann-square').points.map(screenOf);
  assert.ok(passesThrough(square, b), '1x1 fan reaches the far corner');
  assert.ok(labels(square).includes('0.618'));
  const fixed = project(drawing('gann-square-fixed'));
  assert.deepEqual([...new Set(labels(fixed))], ['0', '1', '2', '3', '4', '5']);
  assert.ok(passesThrough(fixed, { x: a.x + (b.x - a.x) / 5, y: b.y }), 'the 5x1 fan');
  const bare = project(
    drawing('gann-square', undefined, { options: { fans: false, arcs: false, background: false } }),
  );
  assert.ok(strokes(bare).length < strokes(square).length && !fills(bare).length);
});

test('the fixed Gann square keeps its price-per-time ratio when a corner moves', () => {
  const tool = registry.get('gann-square-fixed')!,
    d = drawing('gann-square-fixed', [point(20, 120), point(40, 160)]);
  assert.deepEqual(
    tool.handles!(d, context).map(h => h.id),
    ['origin', 'corner'],
  );
  assert.deepEqual(tool.moveHandle!(d, 'corner', point(60, 130), context), [point(20, 120), point(60, 200)]);
  assert.deepEqual(tool.moveHandle!(d, 'corner', point(30, 110), context), [point(20, 120), point(30, 100)]);
  assert.deepEqual(tool.moveHandle!(d, 'origin', point(30, 999), context), [point(30, 140), point(40, 160)]);
  // A flat square has no ratio to keep, so the corner moves freely.
  const flat = drawing('gann-square-fixed', [point(20, 120), point(20, 160)]);
  assert.deepEqual(tool.moveHandle!(flat, 'corner', point(50, 130), context), [
    point(20, 120),
    point(50, 130),
  ]);
});

test('modified Schiff and inside pitchforks start halfway between the first two points', () => {
  const points = [point(10, 120), point(30, 180), point(50, 140)];
  const [p1, p2, p3] = points.map(screenOf),
    origin = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const modified = project(drawing('modified-schiff-pitchfork', points));
  assert.ok(passesThrough(modified, origin) && passesThrough(modified, p2) && passesThrough(modified, p3));
  assert.ok(passesThrough(modified, { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }));
  const inside = project(drawing('inside-pitchfork', points));
  // The median aims at the third point; the tines pass through the second point and its mirror.
  const median = strokes(inside).find(p => near(p, origin) < 1 && near(p, p3) < 1);
  assert.ok(median, 'median through the third point');
  assert.ok(passesThrough(inside, p2));
  const background = fills(inside)[0];
  assert.ok(
    background && near({ ...background, points: [...background.points, background.points[0]] }, p2) < 1,
  );
  assert.equal(
    fills(project(drawing('inside-pitchfork', points, { options: { background: false } }))).length,
    0,
  );
});
