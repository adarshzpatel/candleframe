import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingRegistry, builtInDrawingTools, translateDrawing } from '../src/drawing-tools.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { createPosition, movePositionHandle, positionMetrics } from '../src/position-drawing.ts';
import type { Drawing, DrawingContext, DrawingPrimitive, DrawingToolDefinition } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, points = [point(20, 120), point(80, 180)], extras: Partial<Drawing> = {}) => registry.normalize({ id: 'test', type, points, ...extras });
const paths = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'text');

test('drawing catalog provides thirty usable tools with unique IDs and discoverable gestures', () => {
  assert.equal(builtInDrawingTools.length, 30);
  assert.equal(new Set(registry.list().map(tool => tool.type)).size, 30);
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
  assert.equal(migrated.visible, true); assert.equal(migrated.locked, false);
  const opaque = registry.normalize({ id: 'custom', type: 'vendor:cone', points: [point(1, 100)], text: 'Preserved', levels: [2], style: { color: '#abcdef', width: 3 } });
  assert.deepEqual(registry.normalize(JSON.parse(JSON.stringify(opaque))), opaque);
  assert.deepEqual(registry.project(opaque, context), []);
  const one = drawing('trendline'), two = drawing('trendline');
  one.style.width = 8; one.points[0].price = 900;
  assert.equal(two.style.width, 2); assert.equal(two.points[0].price, 120);
});

test('drawing boundary rejects malformed fields and calls custom tool validation', () => {
  const base = { id: 'x', type: 'trendline', points: [point(20, 120), point(80, 180)] };
  const bad = [
    { id: '' }, { type: '__bad' }, { points: [] }, { points: [point(1, 0), point(2, 3)] },
    { points: [point(NaN, 100), point(2, 3)] }, { points: [point(0, Infinity), point(1, 100)] },
    { points: [point(20, 120)] }, { locked: 'yes' }, { visible: 1 }, { text: 'a'.repeat(2001) },
    { levels: null }, { levels: [Infinity] }, { levels: Array(25).fill(1) }, { levels: [1001] },
    { style: { color: 'red' } }, { style: { width: 0 } }, { style: { width: 9 } },
    { style: { fillOpacity: 1.01 } }, { style: { fontSize: 9 } }, { style: { lineStyle: 'random' } },
  ];
  for (const patch of bad) assert.throws(() => registry.normalize({ ...base, ...patch }), Error, JSON.stringify(patch));
  assert.throws(() => registry.normalize({ ...base, type: 'brush', points: Array.from({ length: 1025 }, () => point(10, 100)) }), /INVALID_DRAWING_POINTS/);
  const custom: DrawingToolDefinition = {
    type: 'custom-marker', label: 'Custom marker', group: 'Custom', points: 1, hint: 'Click once.',
    validate(d) { if (!d.text) throw new Error('NEEDS_LABEL'); },
    project(d, c) { return [{ kind: 'text', at: { x: c.geometry.x(d.points[0].timeMs), y: c.geometry.y(d.points[0].price) }, text: d.text }]; },
  };
  const customRegistry = new DrawingRegistry([custom]);
  assert.throws(() => customRegistry.normalize({ id: 'm', type: custom.type, points: [point(5, 120)] }), /NEEDS_LABEL/);
  const valid = customRegistry.normalize({ id: 'm', type: custom.type, points: [point(5, 120)], text: 'Host code' });
  assert.equal(texts(customRegistry.project(valid, context))[0].text, 'Host code');
  assert.throws(() => new DrawingRegistry([custom, custom]), /DUPLICATE_DRAWING_TOOL/);
});

test('rays clip to the correct plot edge in both directions and extended lines cross from offscreen', () => {
  const forward = paths(registry.project(drawing('ray', [point(20, 120), point(60, 160)]), context));
  assert.deepEqual(forward[0].points, [{ x: 214, y: 816 }, { x: 1014, y: 16 }]);
  const reverse = paths(registry.project(drawing('ray', [point(60, 160), point(20, 120)]), context));
  assert.deepEqual(reverse[0].points, [{ x: 614, y: 416 }, { x: 14, y: 1016 }]);
  const vertical = paths(registry.project(drawing('ray', [point(50, 120), point(50, 160)]), context));
  assert.deepEqual(vertical[0].points, [{ x: 514, y: 816 }, { x: 514, y: 16 }]);
  const outside = registry.project(drawing('horizontal-ray', [point(110, 150)]), context);
  assert.deepEqual(outside, [], 'a right-facing ray wholly to the right cannot point back into the chart');
  const extended = paths(registry.project(drawing('extended-line', [point(-20, 80), point(-10, 90)]), context));
  assert.deepEqual(extended[0].points, [{ x: 14, y: 1016 }, { x: 1014, y: 16 }]);
});

test('Fibonacci prices are derived from anchors, including a separate extension origin', () => {
  const retracement = registry.project(drawing('fib-retracement', undefined, { levels: [0, 0.5, 1] }), context);
  assert.deepEqual(paths(retracement).map(p => p.points), [816, 516, 216].map(y => [{ x: 214, y }, { x: 814, y }]));
  assert.deepEqual(texts(retracement).map(p => p.text), ['0.0%  120.00', '50.0%  150.00', '100.0%  180.00']);
  const extension = registry.project(drawing('fib-extension', [point(10, 120), point(30, 140), point(50, 110)], { levels: [0, 1, 1.5] }), context);
  assert.deepEqual(texts(extension).map(p => p.text), ['0.0%  110.00', '100.0%  130.00', '150.0%  140.00']);
  assert.deepEqual(paths(extension).map(p => p.points[0].y), [916, 716, 616]);
  const preview = drawing('fib-retracement', undefined, { levels: [] });
  assert.equal(paths(registry.project(preview, context)).length, 7, 'empty preview levels use the tool defaults');
});

test('parallel channels keep baseline times fixed and place the third anchor on the opposite rail', () => {
  const channel = drawing('parallel-channel', [point(20, 130), point(60, 150), point(40, 170)]);
  const rails = paths(registry.project(channel, context)).filter(p => !p.fill);
  assert.deepEqual(rails[0].points, [{ x: 214, y: 716 }, { x: 614, y: 516 }]);
  assert.deepEqual(rails[1].points, [{ x: 214, y: 416 }, { x: 614, y: 216 }]);
  assert.equal((rails[1].points[0].y + rails[1].points[1].y) / 2, context.geometry.y(170));
  const vertical = paths(registry.project(drawing('parallel-channel', [point(50, 120), point(50, 160), point(60, 140)]), context)).filter(p => !p.fill);
  assert.deepEqual(vertical.slice(0, 2).map(p => p.points.map(v => v.x)), [[514, 514], [614, 614]]);
});

test('pitchfork median passes through the midpoint of its two fork anchors', () => {
  const fork = drawing('pitchfork', [point(20, 120), point(40, 180), point(80, 160)]);
  const lines = paths(registry.project(fork, context));
  const [start, end] = lines[0].points, midpointX = 614, midpointY = 316;
  const cross = (end.x - start.x) * (midpointY - start.y) - (end.y - start.y) * (midpointX - start.x);
  assert.equal(cross, 0);
  assert.equal(lines.length, 4);
  const normal = lines[0].points[0], schiff = paths(registry.project({ ...fork, type: 'schiff-pitchfork' }, context))[0].points[0];
  assert.deepEqual(normal, { x: 214, y: 816 });
  assert.deepEqual(schiff, { x: 214, y: 516 });
});

test('position plans require ordered prices and display independently computed risk/reward', () => {
  const long = drawing('long-position', [point(20, 140), point(60, 180), point(60, 120)]);
  const scene = registry.project(long, context);
  assert.ok(texts(scene).some(p => p.text === 'LONG  ·  2.00R  ·  140.00'));
  assert.equal(paths(scene).filter(p => p.fill).length, 2);
  const short = drawing('short-position', [point(20, 160), point(60, 130), point(60, 170)]);
  assert.ok(texts(registry.project(short, context)).some(p => p.text === 'SHORT  ·  3.00R  ·  160.00'));
  assert.throws(() => drawing('long-position', short.points), /INVALID_POSITION_PRICES/);
  assert.throws(() => drawing('short-position', long.points), /INVALID_POSITION_PRICES/);
  assert.throws(() => drawing('long-position', [point(20, 140), point(60, 180), point(60, 140)]), /INVALID_POSITION_PRICES/);
});

test('positions remain editable near the price floor and when their time extent runs backwards', () => {
  const ctx = { ...context, tickSize: 0.01 };
  for (const type of ['long-position', 'short-position']) {
    const created = drawing(type, createPosition(type, { timeMs: 99, price: 0.01 }, ctx));
    assert.ok(created.points[1].timeMs < created.points[0].timeMs, 'placement near the right edge extends into visible space');
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
  const projected = anchors.map(anchor => ({ x: context.geometry.x(anchor.timeMs), y: context.geometry.y(anchor.price) }));
  const priceLabel = '+60.00 (50.00%)', dateLabel = '6 bars · 0.00 min';
  for (const [type, label] of [['price-range', priceLabel], ['date-range', dateLabel], ['date-price-range', `${priceLabel}\n${dateLabel}`]]) {
    const scene = registry.project(drawing(type, anchors), context);
    const dashed = paths(scene).filter(primitive => primitive.dash?.length);
    assert.equal(dashed.length, 1, type);
    assert.deepEqual(dashed[0].points, projected, `${type} must connect anchors in their original order, not bracket midpoints`);
    assert.deepEqual(dashed[0].dash, [5, 4], type);
    assert.deepEqual(texts(scene).map(primitive => primitive.text), [label], type);
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
      assert.deepEqual(diagonal.points, anchors.map(anchor => ({ x: context.geometry.x(anchor.timeMs), y: context.geometry.y(anchor.price) })), type);
      assert.ok(diagonal.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), type);
      assert.ok(texts(scene).every(primitive => !/NaN|Infinity/.test(primitive.text)), type);
    }
  }
});

test('all built-ins tolerate partial and coincident previews without nonfinite geometry', () => {
  for (const tool of registry.list()) {
    for (const count of [1, 2, 3]) {
      const preview: Drawing = { ...drawing('trendline'), type: tool.type, points: Array.from({ length: count }, () => point(50, 150)), levels: [] };
      for (const primitive of registry.project(preview, context)) {
        const coordinates = primitive.kind === 'path' ? primitive.points : [primitive.at];
        for (const p of coordinates) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${tool.type} with ${count} coincident points`);
      }
    }
  }
  assert.deepEqual(registry.project({ ...drawing('trendline'), visible: false }, context), []);
});
