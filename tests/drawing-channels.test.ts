import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelTools, channelsIcons, cycleTools, regression } from '../src/drawing-tools-channels.ts';
import { DrawingRegistry } from '../src/drawing-tools.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { themeTokenDefaults } from '../src/theme-tokens.ts';
import { createTimeScale } from '../src/time-scale.ts';
import type { Candle } from '../src/types.ts';
import type { Drawing, DrawingContext, DrawingPrimitive } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const g = context.geometry;
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, points = [point(20, 120), point(80, 180)], extras: Partial<Drawing> = {}) =>
  registry.normalize({ id: 'test', type, points, ...extras });
const paths = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'text');
const candle = (timeMs: number, close: number, spread = 0): Candle => ({
  timeMs,
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume: 1,
});
const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≈ ${expected}`);

test('channel and cycle tools register in their families with icons', () => {
  for (const tool of channelTools) {
    assert.equal(tool.group, 'Lines');
    assert.equal(tool.section, 'Channels');
  }
  for (const tool of cycleTools) {
    assert.equal(tool.group, 'Patterns');
    assert.equal(tool.section, 'Cycles');
  }
  const points = Object.fromEntries([...channelTools, ...cycleTools].map(t => [t.type, t.points]));
  assert.deepEqual(points, {
    'regression-trend': 2,
    'flat-top-bottom': 3,
    'disjoint-channel': 3,
    'cyclic-lines': 2,
    'time-cycles': 2,
    'sine-line': 2,
  });
  for (const type of Object.keys(points)) {
    assert.ok(registry.get(type), type);
    assert.match(channelsIcons[type], /^<path /, type);
  }
});

test('regression fits the source on bar index between the anchors', () => {
  const candles = Array.from({ length: 11 }, (_, i) => candle(i * 10, 100 + 2 * i, 1));
  const fit = regression(candles, 75, 25)!;
  assert.deepEqual([fit.first, fit.last], [3, 7]);
  near(fit.intercept, 106);
  near(fit.slope, 2);
  near(fit.deviation, 0);
  near(fit.pearson, 1);
  near(regression(candles, 25, 75, 'high')!.intercept, 107);
  near(regression(candles, 25, 75, 'hl2')!.intercept, 106);
  assert.equal(regression(candles, 21, 29), null);
  assert.equal(regression(candles, 30, 30), null);
  assert.equal(regression([], 0, 100), null);

  // Residuals of ±1 around a flat line: deviation 1 and no correlation.
  const zigzag = [101, 99, 101, 99].map((close, i) => candle(i * 10, close));
  const flat = regression(zigzag, 0, 30)!;
  near(flat.slope, -0.4);
  near(flat.deviation, Math.sqrt([0.4, -1.2, 1.2, -0.4].reduce((s, r) => s + r * r, 0) / 4));
  assert.ok(flat.pearson < 0 && flat.pearson > -1);
  near(regression([candle(0, 5), candle(10, 5)], 0, 10)!.pearson, 0);
});

test('regression ignores session gaps and draws through the end candles', () => {
  // Three bars, a long close, three more: one bar apart in index, far apart in time.
  const candles = [0, 10, 20, 1000, 1010, 1020].map((t, i) => candle(t, 100 + 2 * i));
  const fit = regression(candles, 0, 1020)!;
  near(fit.slope, 2);
  near(fit.deviation, 0);
  near(fit.pearson, 1);
  const timeScale = createTimeScale(candles, 10, true);
  const gapped: DrawingContext = {
    ...context,
    candles,
    geometry: geometryForRanges(
      { fromMs: 0, toMs: 1020, minPrice: 90, maxPrice: 120 },
      1092,
      1112,
      themeTokenDefaults.chart,
      timeScale,
    ),
  };
  const d = drawing('regression-trend', [point(0, 100), point(1020, 100)]);
  const base = paths(registry.project(d, gapped)).find(p => p.dash)!;
  const geo = gapped.geometry;
  near(base.points[0].x, geo.x(0));
  near(base.points[0].y, geo.y(100));
  near(base.points.at(-1)!.x, geo.x(1020));
  near(base.points.at(-1)!.y, geo.y(110));
});

test('regression trend draws a channel, Pearson label and extension from settings', () => {
  const candles = Array.from({ length: 11 }, (_, i) => candle(i * 10, 140 + (i % 2 ? 3 : -3) + i));
  const withCandles = { ...context, candles };
  const d = drawing('regression-trend', [point(20, 130), point(80, 190)]);
  const scene = registry.project(d, withCandles);
  const fit = regression(candles, 20, 80)!;
  const lines = paths(scene).filter(p => !p.fill);
  assert.equal(lines.length, 3);
  assert.equal(paths(scene).filter(p => p.fill).length, 2);
  const [upper, lower, base] = lines;
  assert.equal(base.color, '#f23645');
  assert.deepEqual(base.dash, [6, 4]);
  near(base.points[0].x, g.x(20));
  near(base.points[1].x, g.x(80));
  near(base.points[0].y, g.y(fit.intercept));
  near(upper.points[0].y, g.y(fit.intercept + 2 * fit.deviation));
  near(lower.points[1].y, g.y(fit.intercept + fit.slope * 6 - 2 * fit.deviation));
  assert.equal(texts(scene)[0].kind === 'text' && texts(scene)[0].text, fit.pearson.toFixed(4));

  const custom = drawing('regression-trend', d.points, {
    options: { extendRight: true, pearson: false, background: false, upperDeviation: 1, lowerDeviation: -3 },
  });
  const customScene = registry.project(custom, withCandles);
  assert.equal(texts(customScene).length, 0);
  assert.equal(paths(customScene).filter(p => p.fill).length, 0);
  const [up, down, middle] = paths(customScene);
  near(middle.points.at(-1)!.x, g.left + g.plotWidth);
  near(up.points[0].y, g.y(fit.intercept + fit.deviation));
  near(down.points[0].y, g.y(fit.intercept - 3 * fit.deviation));
});

test('regression without candles in range draws a plain segment', () => {
  const d = drawing('regression-trend');
  const plain = [point(20, 120), point(80, 180)].map(p => ({ x: g.x(p.timeMs), y: g.y(p.price) }));
  const segment = (scene: DrawingPrimitive[]) => {
    assert.equal(scene.length, 1);
    paths(scene)[0].points.forEach((p, i) => {
      near(p.x, plain[i].x);
      near(p.y, plain[i].y);
    });
  };
  segment(registry.project(d, context));
  segment(registry.project(d, { ...context, candles: [candle(300, 150), candle(310, 151)] }));
});

test('regression handles sit on the base line and drag in time only', () => {
  const candles = Array.from({ length: 11 }, (_, i) => candle(i * 10, 100 + 5 * i));
  const tool = registry.get('regression-trend')!;
  const d = drawing('regression-trend', [point(80, 190), point(20, 110)]);
  const handles = tool.handles!(d, { ...context, candles });
  assert.deepEqual(
    handles.map(h => [h.id, h.cursor]),
    [
      ['0', 'ew-resize'],
      ['1', 'ew-resize'],
    ],
  );
  near(handles[0].at.x, g.x(80));
  near(handles[0].at.y, g.y(140));
  near(handles[1].at.y, g.y(110));
  assert.deepEqual(tool.moveHandle!(d, '1', point(30, 175), context), [point(80, 190), point(30, 110)]);
});

test('flat top/bottom spans the trend range at the third price', () => {
  const d = drawing('flat-top-bottom', [point(20, 120), point(60, 160), point(90, 180)]);
  const [area, trend, flat] = paths(registry.project(d, context));
  assert.ok(area.fill);
  assert.deepEqual(trend.points, [
    { x: g.x(20), y: g.y(120) },
    { x: g.x(60), y: g.y(160) },
  ]);
  assert.deepEqual(flat.points, [
    { x: g.x(20), y: g.y(180) },
    { x: g.x(60), y: g.y(180) },
  ]);
  const extended = drawing('flat-top-bottom', [point(20, 130), point(60, 150), point(90, 180)], {
    options: { extendLeft: true, extendRight: true, background: false },
  });
  const [line, level] = paths(registry.project(extended, context));
  assert.equal(paths(registry.project(extended, context)).length, 2);
  near(level.points[0].x, g.left);
  near(level.points[1].x, g.left + g.plotWidth);
  near(line.points[0].x, g.left);

  const tool = registry.get('flat-top-bottom')!;
  const handles = tool.handles!(d, context);
  assert.deepEqual(
    handles.map(h => h.id),
    [0, 1, 'line-0', 'line-1'],
  );
  assert.deepEqual(handles[3].at, { x: g.x(60), y: g.y(180) });
  assert.deepEqual(tool.moveHandle!(d, 'line-1', point(40, 150), context), [
    point(20, 120),
    point(60, 160),
    point(90, 150),
  ]);
});

test('disjoint channel mirrors the trend slope through the third anchor', () => {
  const d = drawing('disjoint-channel', [point(20, 120), point(60, 160), point(40, 130)]);
  const [, trend, mirror] = paths(registry.project(d, context));
  const slope = (p: { points: { x: number; y: number }[] }) =>
    (p.points[1].y - p.points[0].y) / (p.points[1].x - p.points[0].x);
  near(slope(mirror), -slope(trend));
  near(mirror.points[0].x, g.x(20));
  // Passes through the third anchor, halfway along the trend.
  near((mirror.points[0].y + mirror.points[1].y) / 2, g.y(130));

  const tool = registry.get('disjoint-channel')!;
  const moved = tool.moveHandle!(d, 'line-0', point(33, 110), context);
  assert.deepEqual(moved[2], point(20, 110));
});

test('cyclic lines repeat the anchor spacing to the plot edge', () => {
  const xs = (d: Drawing) =>
    paths(registry.project(d, context))
      .filter(p => !p.dash)
      .map(p => p.points[0].x);
  const forward = xs(drawing('cyclic-lines', [point(10, 150), point(30, 150)]));
  const round = (values: number[]) => values.map(x => Math.round(x * 1000));
  assert.deepEqual(round(forward), round([10, 30, 50, 70, 90].map(t => g.x(t))));
  const backward = xs(drawing('cyclic-lines', [point(70, 150), point(50, 150)]));
  assert.deepEqual(round(backward), round([70, 50, 30, 10].map(t => g.x(t))));
  // Repeats that start offscreen are skipped, not drawn.
  const offscreen = xs(drawing('cyclic-lines', [point(-1005, 150), point(-985, 150)]));
  assert.deepEqual(round(offscreen), round([15, 35, 55, 75, 95].map(t => g.x(t))));
});

test('time cycles draw half circles along the first price', () => {
  const d = drawing('time-cycles', [point(25, 150), point(45, 190)]);
  const arcs = paths(registry.project(d, context)).filter(p => !p.fill);
  assert.equal(arcs.length, 4);
  const radius = (g.x(45) - g.x(25)) / 2;
  const first = arcs[0].points;
  near(first[0].x, g.x(25));
  near(first.at(-1)!.x, g.x(45));
  near(first[0].y, g.y(150));
  near(Math.min(...first.map(p => p.y)), g.y(150) - radius);
  assert.equal(
    registry.project(drawing('time-cycles', d.points, { options: { background: false } }), context).length,
    4,
  );
  const tool = registry.get('time-cycles')!;
  assert.deepEqual(tool.handles!(d, context)[1].at, { x: g.x(45), y: g.y(150) });
  assert.deepEqual(tool.moveHandle!(d, '1', point(50, 120), context), [point(25, 150), point(50, 190)]);
});

test('sine line crosses both anchors with a half period of their spacing', () => {
  const d = drawing('sine-line', [point(30, 180), point(50, 120)]);
  const [wave] = paths(registry.project(d, context));
  const at = (x: number) =>
    wave.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
  assert.ok(Math.abs(at(g.x(30)).y - g.y(180)) < 1);
  assert.ok(Math.abs(at(g.x(50)).y - g.y(120)) < 1);
  assert.ok(Math.abs(at(g.x(70)).y - g.y(180)) < 1);
  near(wave.points[0].x, g.left);
  assert.ok(wave.points.at(-1)!.x >= g.left + g.plotWidth);
  assert.ok(Math.min(...wave.points.map(p => p.y)) >= g.y(180) - 1e-6);
});

test('channel and cycle previews stay finite with partial and coincident points', () => {
  const candles = Array.from({ length: 11 }, (_, i) => candle(i * 10, 150));
  for (const tool of [...channelTools, ...cycleTools])
    for (const count of [1, 2, 3])
      for (const candlesInView of [undefined, candles]) {
        const preview = {
          ...drawing('trendline'),
          type: tool.type,
          points: Array.from({ length: count }, () => point(50, 150)),
        };
        const c = { ...context, candles: candlesInView };
        for (const primitive of [
          ...tool.project(preview, c),
          ...(tool.handles?.(preview, c).map(h => ({ kind: 'text' as const, at: h.at, text: '' })) ?? []),
        ]) {
          const coordinates =
            primitive.kind === 'path' ? primitive.points : primitive.kind === 'text' ? [primitive.at] : [];
          for (const p of coordinates) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), tool.type);
        }
      }
});
