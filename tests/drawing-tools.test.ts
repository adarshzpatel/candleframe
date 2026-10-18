import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingRegistry, builtInDrawingTools, translateDrawing } from '../src/drawing-tools.ts';
import { geometryForRanges } from '../src/geometry.ts';
import {
  createPosition,
  movePositionHandle,
  positionMetrics,
  positionOutcome,
} from '../src/position-drawing.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingPrimitive,
  DrawingToolDefinition,
} from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, points = [point(20, 120), point(80, 180)], extras: Partial<Drawing> = {}) =>
  registry.normalize({ id: 'test', type, points, ...extras });
const paths = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'text');

test('drawing catalog provides usable tools with unique IDs and discoverable gestures', () => {
  assert.equal(new Set(registry.list().map(tool => tool.type)).size, builtInDrawingTools.length);
  assert.ok(builtInDrawingTools.length >= 32);
  assert.equal(registry.get('polyline')?.points, 'path');
  assert.equal(registry.get('brush')?.points, 'freehand');
  assert.equal(registry.get('fib-extension')?.points, 3);
  for (const tool of registry.list()) assert.ok(tool.label && tool.group && tool.hint);
});

test('drawing normalization migrates trend lines, owns inputs and preserves unknown tool payloads', () => {
  const original = { id: 'legacy', start: point(10, 120), end: point(30, 140) };
  const migrated = registry.normalize(original);
  original.start.price = 999;
  assert.equal(migrated.type, 'trendline');
  assert.deepEqual(migrated.points, [point(10, 120), point(30, 140)]);
  assert.equal(migrated.visible, true);
  assert.equal(migrated.locked, false);
  const opaque = registry.normalize({
    id: 'custom',
    type: 'vendor:cone',
    points: [point(1, 100)],
    text: 'Preserved',
    levels: [2],
    style: { color: '#abcdef', width: 3 },
  });
  assert.deepEqual(registry.normalize(JSON.parse(JSON.stringify(opaque))), opaque);
  assert.deepEqual(registry.project(opaque, context), []);
  const one = drawing('trendline'),
    two = drawing('trendline');
  one.style.width = 8;
  one.points[0].price = 900;
  assert.equal(two.style.width, 2);
  assert.equal(two.points[0].price, 120);
});

test('drawing boundary rejects malformed fields and calls custom tool validation', () => {
  const base = { id: 'x', type: 'trendline', points: [point(20, 120), point(80, 180)] };
  const bad = [
    { id: '' },
    { type: '__bad' },
    { points: [] },
    { points: [point(1, 0), point(2, 3)] },
    { points: [point(NaN, 100), point(2, 3)] },
    { points: [point(0, Infinity), point(1, 100)] },
    { points: [point(20, 120)] },
    { locked: 'yes' },
    { visible: 1 },
    { text: 'a'.repeat(2001) },
    { levels: null },
    { levels: [Infinity] },
    { levels: Array(25).fill(1) },
    { levels: [1001] },
    { style: { color: 'red' } },
    { style: { width: 0 } },
    { style: { width: 9 } },
    { style: { fillOpacity: 1.01 } },
    { style: { fontSize: 9 } },
    { style: { lineStyle: 'random' } },
  ];
  for (const patch of bad)
    assert.throws(() => registry.normalize({ ...base, ...patch }), Error, JSON.stringify(patch));
  assert.throws(
    () =>
      registry.normalize({
        ...base,
        type: 'brush',
        points: Array.from({ length: 1025 }, () => point(10, 100)),
      }),
    /INVALID_DRAWING_POINTS/,
  );
  const custom: DrawingToolDefinition = {
    type: 'custom-marker',
    label: 'Custom marker',
    group: 'Custom',
    points: 1,
    hint: 'Click once.',
    validate(d) {
      if (!d.text) throw new Error('NEEDS_LABEL');
    },
    project(d, c) {
      return [
        {
          kind: 'text',
          at: { x: c.geometry.x(d.points[0].timeMs), y: c.geometry.y(d.points[0].price) },
          text: d.text,
        },
      ];
    },
  };
  const customRegistry = new DrawingRegistry([custom]);
  assert.throws(
    () => customRegistry.normalize({ id: 'm', type: custom.type, points: [point(5, 120)] }),
    /NEEDS_LABEL/,
  );
  const valid = customRegistry.normalize({
    id: 'm',
    type: custom.type,
    points: [point(5, 120)],
    text: 'Host code',
  });
  assert.equal(texts(customRegistry.project(valid, context))[0].text, 'Host code');
  assert.throws(() => new DrawingRegistry([custom, custom]), /DUPLICATE_DRAWING_TOOL/);
});

test('rays clip to the correct plot edge in both directions and extended lines cross from offscreen', () => {
  const forward = paths(registry.project(drawing('ray', [point(20, 120), point(60, 160)]), context));
  assert.deepEqual(forward[0].points, [
    { x: 214, y: 816 },
    { x: 1014, y: 16 },
  ]);
  const reverse = paths(registry.project(drawing('ray', [point(60, 160), point(20, 120)]), context));
  assert.deepEqual(reverse[0].points, [
    { x: 614, y: 416 },
    { x: 14, y: 1016 },
  ]);
  const vertical = paths(registry.project(drawing('ray', [point(50, 120), point(50, 160)]), context));
  assert.deepEqual(vertical[0].points, [
    { x: 514, y: 816 },
    { x: 514, y: 16 },
  ]);
  const outside = paths(registry.project(drawing('horizontal-ray', [point(110, 150)]), context));
  assert.deepEqual(outside, [], 'a right-facing ray wholly to the right cannot point back into the chart');
  const extended = paths(
    registry.project(drawing('extended-line', [point(-20, 80), point(-10, 90)]), context),
  );
  assert.deepEqual(extended[0].points, [
    { x: 14, y: 1016 },
    { x: 1014, y: 16 },
  ]);
});

const levelLines = (primitives: DrawingPrimitive[]) => paths(primitives).filter(p => !p.fill && !p.dash);

test('Fibonacci prices are derived from anchors, including a separate extension origin', () => {
  // Like familiar charting apps, a retracement counts from the second anchor (0) back to the first (1).
  const retracement = registry.project(
    drawing('fib-retracement', undefined, { levels: [0, 0.5, 1] }),
    context,
  );
  assert.deepEqual(
    levelLines(retracement).map(p => p.points),
    [816, 516, 216].map(y => [
      { x: 214, y },
      { x: 814, y },
    ]),
  );
  assert.deepEqual(
    texts(retracement).map(p => p.text),
    ['1 (120.00)', '0.5 (150.00)', '0 (180.00)'],
  );
  assert.equal(paths(retracement).filter(p => p.fill).length, 2, 'one background band between each level');
  const reversed = registry.project(
    drawing('fib-retracement', undefined, { levels: [0, 1], options: { reverse: true } }),
    context,
  );
  assert.deepEqual(
    texts(reversed).map(p => p.text),
    ['0 (120.00)', '1 (180.00)'],
  );
  const extension = registry.project(
    drawing('fib-extension', [point(10, 120), point(30, 140), point(50, 110)], { levels: [0, 1, 1.5] }),
    context,
  );
  assert.deepEqual(
    texts(extension).map(p => p.text),
    ['0 (110.00)', '1 (130.00)', '1.5 (140.00)'],
  );
  assert.deepEqual(
    levelLines(extension).map(p => p.points[0].y),
    [916, 716, 616],
  );
  const preview = drawing('fib-retracement', undefined, { levels: [] });
  assert.equal(
    levelLines(registry.project(preview, context)).length,
    7,
    'empty preview levels use the tool defaults',
  );
});

test('drawing options validate against tool settings and keep only non-default values', () => {
  const ray = drawing('trendline', undefined, { options: { extendRight: true, extendLeft: false } });
  assert.deepEqual(ray.options, { extendRight: true });
  assert.equal(drawing('trendline', undefined, { options: { extendLeft: false } }).options, undefined);
  assert.throws(
    () => drawing('trendline', undefined, { options: { extendRight: 'yes' } }),
    /INVALID_DRAWING_OPTIONS/,
  );
  assert.throws(
    () => drawing('trendline', undefined, { options: { rightEnd: 'circle' } }),
    /INVALID_DRAWING_OPTIONS/,
  );
  const extended = paths(registry.project(ray, context));
  assert.equal(extended[0].points[1].x, 1014, 'extend right reaches the plot edge');
  const arrows = paths(
    registry.project(drawing('trendline', undefined, { options: { rightEnd: 'arrow' } }), context),
  );
  assert.equal(arrows.length, 2, 'an arrow end adds a head');
  const info = texts(registry.project(drawing('info-line'), { ...context, tickSize: 0.5 }));
  assert.match(info[0].text, /^\+60\.00 \(\+50\.00%\), 120 ticks\n/);
  const stats = drawing('trendline', undefined, { options: { stats: 'selected' } });
  assert.equal(texts(registry.project(stats, context)).length, 0);
  assert.equal(texts(registry.project(stats, { ...context, selected: true })).length, 1);
  const level = registry.project(drawing('horizontal-line', [point(50, 150)]), context);
  assert.deepEqual(
    level.filter(p => p.kind === 'axis'),
    [{ kind: 'axis', axis: 'price', value: 150, color: '#a9c4ff' }],
  );
});

test('parallel channels keep baseline times fixed and place the third anchor on the opposite rail', () => {
  const channel = drawing('parallel-channel', [point(20, 130), point(60, 150), point(40, 170)]);
  const rails = paths(registry.project(channel, context)).filter(p => !p.fill);
  assert.deepEqual(rails[0].points, [
    { x: 214, y: 716 },
    { x: 614, y: 516 },
  ]);
  assert.deepEqual(rails[1].points, [
    { x: 214, y: 416 },
    { x: 614, y: 216 },
  ]);
  assert.equal((rails[1].points[0].y + rails[1].points[1].y) / 2, context.geometry.y(170));
  const vertical = paths(
    registry.project(drawing('parallel-channel', [point(50, 120), point(50, 160), point(60, 140)]), context),
  ).filter(p => !p.fill);
  assert.deepEqual(
    vertical.slice(0, 2).map(p => p.points.map(v => v.x)),
    [
      [514, 514],
      [614, 614],
    ],
  );
});

test('pitchfork median passes through the midpoint of its two fork anchors', () => {
  const fork = drawing('pitchfork', [point(20, 120), point(40, 180), point(80, 160)]);
  const lines = paths(registry.project(fork, context)).filter(p => !p.fill);
  const [start, end] = lines[0].points,
    midpointX = 614,
    midpointY = 316;
  const cross = (end.x - start.x) * (midpointY - start.y) - (end.y - start.y) * (midpointX - start.x);
  assert.equal(cross, 0);
  assert.equal(lines.length, 4);
  const normal = lines[0].points[0],
    schiff = paths(registry.project({ ...fork, type: 'schiff-pitchfork' }, context)).filter(p => !p.fill)[0]
      .points[0];
  assert.deepEqual(normal, { x: 214, y: 816 });
  assert.deepEqual(schiff, { x: 214, y: 516 });
});

test('position plans require ordered prices and display independently computed risk/reward', () => {
  const long = drawing('long-position', [point(20, 140), point(60, 180), point(60, 120)]);
  const scene = registry.project(long, context);
  assert.ok(texts(scene).some(p => p.text === 'LONG 140.00  ·  R/R 2.00'));
  assert.equal(paths(scene).filter(p => p.fill).length, 2);
  const short = drawing('short-position', [point(20, 160), point(60, 130), point(60, 170)]);
  assert.ok(texts(registry.project(short, context)).some(p => p.text === 'SHORT 160.00  ·  R/R 3.00'));
  assert.throws(() => drawing('long-position', short.points), /INVALID_POSITION_PRICES/);
  assert.throws(() => drawing('short-position', long.points), /INVALID_POSITION_PRICES/);
  assert.throws(
    () => drawing('long-position', [point(20, 140), point(60, 180), point(60, 140)]),
    /INVALID_POSITION_PRICES/,
  );
});

test('position labels show distance, percent and ticks for each level', () => {
  const long = drawing('long-position', [point(20, 140), point(60, 180), point(60, 120)]);
  const labels = texts(registry.project(long, { ...context, tickSize: 0.25 })).map(p => p.text);
  assert.ok(labels.includes('Target 180.00  ·  +40.00 (28.57%)  ·  160 ticks'));
  assert.ok(labels.includes('Stop 120.00  ·  −20.00 (14.29%)  ·  80 ticks'));
});

test('position outcomes replay candles from fill to the first level reached', () => {
  const candle = (timeMs: number, low: number, high: number, close = (low + high) / 2) => ({
    timeMs,
    open: close,
    high,
    low,
    close,
    volume: 1,
  });
  const long = drawing('long-position', [point(20, 140), point(60, 180), point(60, 120)]);
  assert.deepEqual(positionOutcome(long, [candle(10, 130, 150), candle(30, 145, 160)]), { state: 'pending' });
  const open = positionOutcome(long, [candle(20, 138, 142), candle(30, 141, 160, 155), candle(70, 100, 300)]);
  assert.deepEqual(open, { state: 'open', fillMs: 20, exitMs: 30, exitPrice: 155, pnl: 15 });
  assert.equal(positionOutcome(long, [candle(20, 138, 142), candle(40, 150, 185)]).state, 'target');
  // One bar through both levels cannot be ordered, so it counts against the plan.
  assert.equal(positionOutcome(long, [candle(20, 110, 190)]).state, 'stop');
  const short = drawing('short-position', [point(20, 160), point(60, 130), point(60, 170)]);
  assert.deepEqual(positionOutcome(short, [candle(20, 158, 162), candle(30, 125, 150)]), {
    state: 'target',
    fillMs: 20,
    exitMs: 30,
    exitPrice: 130,
    pnl: 30,
  });
  const scene = registry.project(long, {
    ...context,
    candles: [candle(20, 138, 142), candle(30, 141, 160, 155)],
  });
  assert.ok(texts(scene).some(p => p.text.endsWith('\nOpen P&L +15.00 (+10.71%)')));
  assert.equal(paths(scene).filter(p => p.fill).length, 3);
});

test('positions remain editable near the price floor and when their time extent runs backwards', () => {
  const ctx = { ...context, tickSize: 0.01 };
  for (const type of ['long-position', 'short-position']) {
    const created = drawing(type, createPosition(type, { timeMs: 99, price: 0.01 }, ctx));
    assert.ok(
      created.points[1].timeMs < created.points[0].timeMs,
      'placement near the right edge extends into visible space',
    );
    assert.ok(positionMetrics(created).risk > 0 && positionMetrics(created).reward > 0);
    for (const handle of ['entry', 'target', 'stop', 'extent']) {
      const moved = drawing(type, movePositionHandle(created, handle, { timeMs: 200, price: 0.01 }, ctx));
      assert.ok(positionMetrics(moved).risk > 0 && positionMetrics(moved).reward > 0);
      assert.ok(moved.points[1].timeMs < moved.points[0].timeMs);
    }
  }
  const legacy = drawing('long-position', [point(20, 0.011), point(60, 0.012), point(60, 0.01)]);
  assert.doesNotThrow(() => drawing(legacy.type, movePositionHandle(legacy, 'entry', point(20, 100), ctx)));
});

test('measurements use the selected candle interval and body translation preserves shape at the price floor', () => {
  const measurement = registry.project(drawing('date-range', [point(0, 120), point(30, 150)]), context);
  assert.ok(texts(measurement).some(p => p.text.startsWith('3 bars')));
  const original = drawing('triangle', [point(20, 120), point(60, 180), point(80, 150)]);
  const translated = translateDrawing(original, 7, -1000, 0.5);
  assert.deepEqual(translated.points, [point(27, 0.5), point(67, 60.5), point(87, 30.5)]);
  assert.deepEqual(original.points, [point(20, 120), point(60, 180), point(80, 150)]);
  assert.throws(() => translateDrawing(original, NaN, 0, 0.5), /INVALID_DRAWING_TRANSLATION/);
});

test('measurement tools connect the actual anchors with a dashed diagonal and retain their range labels', () => {
  const anchors = [point(80, 120), point(20, 180)];
  const projected = anchors.map(anchor => ({
    x: context.geometry.x(anchor.timeMs),
    y: context.geometry.y(anchor.price),
  }));
  const priceLabel = '+60.00 (50.00%)',
    dateLabel = '6 bars · 0.00 min';
  for (const [type, label] of [
    ['price-range', priceLabel],
    ['date-range', dateLabel],
    ['date-price-range', `${priceLabel}\n${dateLabel}`],
  ]) {
    const scene = registry.project(drawing(type, anchors), context);
    const dashed = paths(scene).filter(primitive => primitive.dash?.length);
    assert.equal(dashed.length, 1, type);
    assert.deepEqual(
      dashed[0].points,
      projected,
      `${type} must connect anchors in their original order, not bracket midpoints`,
    );
    assert.deepEqual(dashed[0].dash, [5, 4], type);
    assert.deepEqual(
      texts(scene).map(primitive => primitive.text),
      [label],
      type,
    );
    const remaining = paths(scene).filter(primitive => !primitive.dash);
    if (type === 'date-price-range') {
      assert.equal(remaining.length, 2);
      assert.ok(remaining[0].closed && remaining[0].fill, 'the filled range remains behind the connector');
      assert.ok(remaining[1].closed, 'the range outline remains visible');
    } else {
      assert.equal(remaining.length, 3, `${type} retains its bracket and two end caps`);
    }
  }
});

test('measurement diagonals tolerate zero-duration, zero-price and coincident anchors', () => {
  for (const type of ['price-range', 'date-range', 'date-price-range']) {
    for (const end of [point(0, 180), point(60, 120), point(0, 120)]) {
      const anchors = [point(0, 120), end];
      const scene = registry.project(drawing(type, anchors), context);
      const diagonal = paths(scene).find(primitive => primitive.dash?.length)!;
      assert.deepEqual(
        diagonal.points,
        anchors.map(anchor => ({
          x: context.geometry.x(anchor.timeMs),
          y: context.geometry.y(anchor.price),
        })),
        type,
      );
      assert.ok(
        diagonal.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
        type,
      );
      assert.ok(
        texts(scene).every(primitive => !/NaN|Infinity/.test(primitive.text)),
        type,
      );
    }
  }
});

test('all built-ins tolerate partial and coincident previews without nonfinite geometry', () => {
  for (const tool of registry.list()) {
    for (const count of [1, 2, 3]) {
      const preview: Drawing = {
        ...drawing('trendline'),
        type: tool.type,
        points: Array.from({ length: count }, () => point(50, 150)),
        levels: [],
      };
      for (const primitive of registry.project(preview, context)) {
        const coordinates =
          primitive.kind === 'path' ? primitive.points : primitive.kind === 'text' ? [primitive.at] : [];
        for (const p of coordinates)
          assert.ok(
            Number.isFinite(p.x) && Number.isFinite(p.y),
            `${tool.type} with ${count} coincident points`,
          );
      }
    }
  }
  assert.deepEqual(registry.project({ ...drawing('trendline'), visible: false }, context), []);
});
