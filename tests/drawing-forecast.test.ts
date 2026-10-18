import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingRegistry, translateDrawing } from '../src/drawing-tools.ts';
import {
  anchoredVwap,
  forecastIcons,
  forecastOutcome,
  ghostCandles,
  projectionTools,
  volumeTools,
} from '../src/drawing-tools-forecast.ts';
import { drawingTemplateValue } from '../src/drawing-templates.ts';
import { geometryForRanges } from '../src/geometry.ts';
import type { Candle } from '../src/types.ts';
import type { Drawing, DrawingContext, DrawingPrimitive } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const point = (timeMs: number, price: number) => ({ timeMs, price });
/** Ten-unit bars from 0 to 100: a rise from 120 to 170, then a fall back to 150. */
const candles: Candle[] = Array.from({ length: 11 }, (_, i) => {
  const close = i <= 5 ? 120 + i * 10 : 170 - (i - 5) * 4;
  return { timeMs: i * 10, open: close - 2, high: close + 3, low: close - 5, close, volume: 10 + i };
});
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  tickSize: 0.5,
  candles,
  formatPrice: price => price.toFixed(2),
};
const drawing = (type: string, points: { timeMs: number; price: number }[], extras: Partial<Drawing> = {}) =>
  registry.normalize({ id: 'test', type, points, ...extras });
const paths = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) => primitives.filter(p => p.kind === 'text');
const allFinite = (primitives: DrawingPrimitive[]) =>
  primitives.every(p =>
    (p.kind === 'path' ? p.points : p.kind === 'text' ? [p.at] : []).every(
      q => Number.isFinite(q.x) && Number.isFinite(q.y),
    ),
  );

test('forecasting tools register in their sections with icons', () => {
  const types = [...projectionTools, ...volumeTools].map(tool => tool.type);
  assert.deepEqual(types, [
    'forecast',
    'bars-pattern',
    'ghost-feed',
    'projection',
    'anchored-vwap',
    'fixed-range-volume-profile',
  ]);
  for (const tool of projectionTools) assert.equal(tool.section, 'Projection');
  for (const tool of volumeTools) assert.equal(tool.section, 'Volume-based');
  for (const type of types) {
    assert.equal(registry.get(type)?.group, 'Forecasting', type);
    assert.match(forecastIcons[type], /<path|<rect|<circle/, type);
  }
  assert.equal(registry.get('ghost-feed')?.points, 'path');
  assert.equal(registry.get('projection')?.points, 3);
  assert.equal(registry.get('anchored-vwap')?.points, 1);
});

test('forecast succeeds when bars reach the target in time and fails when they miss it', () => {
  // The rise reaches 160 (high 163) at bar 40.
  assert.deepEqual(forecastOutcome([point(0, 120), point(60, 160)], candles), {
    state: 'success',
    timeMs: 40,
    price: 160,
  });
  // 190 is never reached; the last bar at or before the target time closes at 170.
  assert.deepEqual(forecastOutcome([point(0, 120), point(50, 190)], candles), {
    state: 'failure',
    timeMs: 50,
    price: 170,
  });
  // The target time lies past the loaded bars, so the forecast is still open.
  assert.equal(forecastOutcome([point(0, 120), point(200, 190)], candles).state, 'pending');
  // Downward targets need a low at or under the price.
  assert.equal(forecastOutcome([point(50, 170), point(100, 146)], candles).state, 'success');
  assert.equal(forecastOutcome([point(50, 170), point(100, 140)], candles).state, 'failure');
  // A target left of the source is never judged.
  assert.equal(forecastOutcome([point(50, 170), point(20, 140)], candles).state, 'pending');

  const labels = (points: { timeMs: number; price: number }[], c = context) =>
    texts(registry.project(drawing('forecast', points), c)).map(t => (t.kind === 'text' ? t.text : ''));
  const [source, target] = labels([point(0, 120), point(60, 160)]);
  assert.equal(source, '120.00');
  assert.equal(target, 'Success\n160.00\n+40.00 (+33.33%)\n6 bars, 0m');
  assert.match(labels([point(0, 120), point(50, 190)])[1], /^Failure\n190\.00\n\+70\.00/);
  assert.doesNotMatch(labels([point(0, 120), point(200, 190)])[1], /Success|Failure/);
  assert.doesNotMatch(
    labels([point(0, 120), point(60, 160)], { ...context, candles: undefined })[1],
    /Success/,
  );
});

test('bars pattern keeps its source bars when the copy moves', () => {
  const placed = drawing('bars-pattern', [point(0, 120), point(50, 170)]);
  assert.deepEqual(placed.options, { sourceFrom: 0, sourceTo: 50, sourcePrice: 120 });
  const hl = paths(registry.project(placed, context));
  // HL mode: one high-low stroke per source bar, drawn over the originals right after placement.
  assert.equal(hl.length, 6);
  assert.deepEqual(hl[0].kind === 'path' && hl[0].points.map(p => p.y), [
    context.geometry.y(123),
    context.geometry.y(115),
  ]);

  // Moving the copy 40 units later and 10 higher shifts the drawing, not the source.
  const moved = registry.normalize(translateDrawing(placed, 40, 10, 0.5));
  assert.deepEqual(moved.options, placed.options);
  const shifted = paths(registry.project(moved, context));
  assert.equal(shifted.length, 6);
  assert.ok(shifted[0].kind === 'path');
  assert.equal(shifted[0].points[0].x, context.geometry.x(40));
  assert.equal(shifted[0].points[0].y, context.geometry.y(133));

  // Flipped mirrors prices around the first anchor; mirrored reverses time.
  const flipped = registry.normalize({ ...moved, options: { ...moved.options, flipped: true } });
  const first = paths(registry.project(flipped, context))[0];
  assert.ok(first.kind === 'path');
  assert.equal(first.points[0].y, context.geometry.y(2 * 130 - 133));
  const mirrored = registry.normalize({ ...moved, options: { ...moved.options, mirrored: true } });
  const reversed = paths(registry.project(mirrored, context))[0];
  assert.ok(reversed.kind === 'path');
  assert.equal(reversed.points[0].x, context.geometry.x(90));

  // OHLC adds two ticks per bar, line modes a single path.
  const ohlc = registry.normalize({ ...placed, options: { ...placed.options, mode: 'ohlc' } });
  assert.equal(paths(registry.project(ohlc, context)).length, 18);
  const close = registry.normalize({ ...placed, options: { ...placed.options, mode: 'close' } });
  const series = paths(registry.project(close, context));
  assert.equal(series.length, 1);
  assert.ok(series[0].kind === 'path' && series[0].points.length === 6);

  // Templates take settings only, so another pattern never inherits this source range.
  assert.deepEqual(drawingTemplateValue(ohlc, registry.get('bars-pattern')).options, { mode: 'ohlc' });
});

test('ghost feed draws deterministic candles that close on each click', () => {
  const clicks = [point(100, 150), point(150, 170), point(180, 160)];
  const ghosts = ghostCandles(clicks, 10, 4, 0.5, 'seed');
  assert.deepEqual(ghostCandles(clicks, 10, 4, 0.5, 'seed'), ghosts);
  assert.equal(ghosts.length, 8);
  assert.deepEqual(
    ghosts.map(g => g.timeMs),
    [110, 120, 130, 140, 150, 160, 170, 180],
  );
  assert.equal(ghosts[4].close, 170);
  assert.equal(ghosts.at(-1)!.close, 160);
  for (let i = 1; i < ghosts.length; i++) assert.equal(ghosts[i].open, ghosts[i - 1].close);
  for (const g of ghosts)
    assert.ok(g.high >= Math.max(g.open, g.close) && g.low <= Math.min(g.open, g.close));
  // No variance keeps closes on the straight segment.
  const flat = ghostCandles([point(0, 100), point(40, 140)], 10, 4, 0, 'seed');
  assert.deepEqual(
    flat.map(g => g.close),
    [110, 120, 130, 140],
  );
  assert.equal(ghostCandles(clicks, 10, 4, 0.5, 'seed', 3).length, 3);

  const scene = registry.project(drawing('ghost-feed', [point(50, 150), point(100, 170)]), context);
  // A dashed guide, then a wick and a body per visible candle.
  assert.equal(paths(scene).length, 1 + 5 * 2);
  assert.ok(allFinite(scene));
});

test('projection fills the sweep between its legs and labels the projected price', () => {
  const d = drawing('projection', [point(20, 120), point(60, 160), point(60, 120)]);
  const scene = registry.project(d, context);
  assert.equal(paths(scene).filter(p => p.kind === 'path' && p.fill).length, 2);
  const label = texts(scene)[0];
  assert.ok(label.kind === 'text');
  assert.match(label.text, /^1 \(\d+\.\d{2}\)$/);
  const plain = registry.normalize({ ...d, options: { background: false, trendLine: false } });
  assert.equal(paths(registry.project(plain, context)).filter(p => p.kind === 'path' && p.fill).length, 0);
});

test('anchored VWAP weights the source price by volume from the anchor bar', () => {
  const series = anchoredVwap(candles, 30, 10, 'close');
  assert.equal(series.start, 3);
  let pv = 0,
    v = 0;
  for (let i = 3; i < candles.length; i++) {
    pv += candles[i].close * candles[i].volume;
    v += candles[i].volume;
    const mean = pv / v;
    assert.ok(Math.abs(series.vwap[i - 3] - mean) < 1e-9, `bar ${i}`);
  }
  assert.equal(series.deviation[0], 0);
  assert.ok(series.deviation.at(-1)! > 0);
  // The anchor bar is the one containing the anchor time.
  assert.equal(anchoredVwap(candles, 34, 10).start, 3);
  assert.equal(anchoredVwap(candles, 36, 10).start, 4);

  const tool = registry.get('anchored-vwap')!;
  const [snapped] = tool.create!(point(31, 199), context);
  assert.deepEqual(snapped, { timeMs: 30, price: (153 + 145 + 150) / 3 });
  const d = drawing('anchored-vwap', [snapped]);
  const line = registry.project(d, context);
  assert.equal(paths(line).length, 1);
  assert.ok(line.some(p => p.kind === 'axis' && p.axis === 'price'));
  const banded = registry.normalize({ ...d, options: { band1: true, band2: true } });
  // Two bands, each a fill and two edges, then the VWAP line.
  assert.equal(paths(registry.project(banded, context)).length, 7);
  const [handle] = tool.handles!(d, context);
  assert.equal(handle.at.y, context.geometry.y(anchoredVwap(candles, 30, 10).vwap[0]));
  assert.deepEqual(tool.moveHandle!(d, 'anchor', point(52, 100), context), [point(50, 170 + 1 / 3 - 1)]);
});

test('fixed range volume profile marks the point of control and the value area', () => {
  const d = drawing('fixed-range-volume-profile', [point(0, 150), point(100, 150)]);
  const scene = registry.project(d, context);
  assert.ok(allFinite(scene));
  const fills = paths(scene).filter(p => p.kind === 'path' && p.fill);
  const poc = paths(scene).find(p => p.kind === 'path' && p.color === '#ff0000');
  assert.ok(poc && poc.kind === 'path');
  assert.equal(poc.points[0].x, context.geometry.x(0));
  assert.equal(poc.points[1].x, context.geometry.x(100));
  // Bars start at the left edge and never pass 30% of the range.
  const left = context.geometry.x(0),
    limit = left + (context.geometry.x(100) - left) * 0.3 + 1e-6;
  const rows = fills.slice(1);
  assert.ok(rows.length > 10);
  for (const row of rows)
    assert.ok(row.kind === 'path' && row.points.every(p => p.x >= left && p.x <= limit));
  const inside = rows.filter(p => p.kind === 'path' && p.opacity === 0.7).length;
  assert.ok(inside > 0 && inside < rows.length);

  const right = registry.normalize({
    ...d,
    options: { placement: 'right', volume: 'total', showPoc: false },
  });
  const mirrored = paths(registry.project(right, context)).filter(p => p.kind === 'path' && p.fill);
  assert.equal(mirrored.length, rows.length / 2 + 1);
  const edge = context.geometry.x(100);
  assert.ok(
    mirrored.slice(1).every(p => p.kind === 'path' && p.points.some(q => Math.abs(q.x - edge) < 1e-6)),
  );
  assert.ok(!paths(registry.project(right, context)).some(p => p.kind === 'path' && p.color === '#ff0000'));
});

test('forecasting tools tolerate previews with candles and none', () => {
  for (const tool of [...projectionTools, ...volumeTools])
    for (const c of [context, { ...context, candles: [] }, { ...context, candles: undefined }])
      for (const count of [1, 2, 3]) {
        const preview: Drawing = {
          ...drawing('trendline', [point(20, 120), point(80, 180)]),
          type: tool.type,
          points: Array.from({ length: count }, (_, i) => point(50 + (count > 1 ? i : 0), 150)),
        };
        assert.ok(allFinite(registry.project(preview, c)), `${tool.type} with ${count} points`);
      }
});

test('bars pattern and volume profile handles stay on the drawn shape', () => {
  const pattern = drawing('bars-pattern', [point(0, 120), point(50, 190)]);
  const tool = registry.get('bars-pattern')!;
  const [start, end] = tool.handles!(pattern, context);
  assert.deepEqual(start.at, { x: context.geometry.x(0), y: context.geometry.y(120) });
  assert.deepEqual(end.at, { x: context.geometry.x(50), y: context.geometry.y(120) });
  assert.equal(end.cursor, 'ew-resize');
  assert.deepEqual(tool.moveHandle!(pattern, 'end', point(70, 100), context), [
    point(0, 120),
    point(70, 190),
  ]);
  assert.deepEqual(tool.moveHandle!(pattern, 'start', point(10, 130), context), [
    point(10, 130),
    point(50, 190),
  ]);

  const profile = drawing('fixed-range-volume-profile', [point(0, 199), point(100, 101)]);
  const range = registry.get('fixed-range-volume-profile')!;
  const handles = range.handles!(profile, context);
  assert.ok(handles.every(h => h.cursor === 'ew-resize'));
  // Both sit halfway between the lowest low (115) and the highest high (173) of the range.
  const middle = context.geometry.y(144);
  assert.ok(handles.every(h => Math.abs(h.at.y - middle) < context.geometry.plotHeight / 20));
  assert.deepEqual(range.moveHandle!(profile, 'start', point(20, 150), context), [
    point(20, 199),
    point(100, 101),
  ]);
});
