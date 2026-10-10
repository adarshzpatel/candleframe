import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartRuntime, parseDocument } from '../src/runtime.ts';
import type { ChartCommand, FeedAdapter, FeedEvent } from '../src/types.ts';
import type { DrawingInput, DrawingToolDefinition } from '../src/drawing-types.ts';

const minute = 60_000;
const anchor = (price: number, timeMs = 0) => ({ timeMs, price });
const line = (id = 'line'): DrawingInput => ({
  id,
  type: 'trendline',
  points: [anchor(100), anchor(110, minute)],
});

function harness(drawingTools: readonly DrawingToolDefinition[] = []) {
  let send: (event: FeedEvent) => void = () => {};
  const feed: FeedAdapter = {
    descriptor: {
      id: 'test',
      label: 'Test',
      simulated: true,
      interval: '1m',
      intervalMs: minute,
      instrument: {
        symbol: 'BTC/USD',
        name: 'Bitcoin',
        base: 'BTC',
        quote: 'USD',
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 3,
      },
      depth: { kind: 'snapshots', levels: 20 },
    },
    connect(emit) {
      send = emit;
      emit({
        type: 'candles.history',
        candles: [{ timeMs: 0, open: 100, high: 111, low: 99, close: 110, volume: 10 }],
      });
      return { dispose() {}, setPaused() {}, requestSnapshot() {} };
    },
  };
  const runtime = new ChartRuntime(feed, [], { drawingTools });
  runtime.start();
  return { runtime, feed, emit: (event: FeedEvent) => send(event) };
}

test('v1/v2 documents and legacy drawing commands migrate to owned v3 drawing records', () => {
  const { runtime, feed } = harness();
  const legacy = { id: 'legacy', start: anchor(100), end: anchor(110, minute) };
  runtime.execute({ type: 'drawing.add', drawing: legacy });
  legacy.start.price = 999;
  const saved = runtime.exportDocument();
  assert.equal(saved.version, 4);
  assert.equal(saved.drawings[0].type, 'trendline');
  assert.deepEqual(saved.drawings[0].points, [anchor(100), anchor(110, minute)]);
  const old = { ...saved, version: 2, drawings: [{ id: 'old', start: anchor(90), end: anchor(95, minute) }] };
  const migrated = parseDocument(old, feed.descriptor);
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.drawings[0].points, [anchor(90), anchor(95, minute)]);
  const { feedId: _feedId, interval: _interval, ...v1 } = old;
  assert.equal(parseDocument({ ...v1, version: 1 }, feed.descriptor).version, 4);
  assert.throws(
    () => parseDocument({ ...v1, version: 1 }, { ...feed.descriptor, simulated: false }),
    /LEGACY_MARKET_MISMATCH/,
  );
  runtime.restoreDocument(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(runtime.exportDocument(), migrated);
  runtime.dispose();
});

test('drawing commands merge styles, enforce locks, copy shapes, and order objects without mutating inputs', () => {
  const { runtime } = harness();
  const source = line();
  runtime.execute({ type: 'drawing.add', drawing: source });
  const originalStyle = runtime.exportDocument().drawings[0].style;
  runtime.execute({
    type: 'drawing.update',
    id: source.id,
    patch: { style: { width: 4 }, locked: true, visible: false, text: 'Support' },
  });
  let drawing = runtime.exportDocument().drawings[0];
  assert.deepEqual(drawing.style, { ...originalStyle, width: 4 });
  assert.equal(source.locked, undefined);
  const beforeRejected = runtime.inspect();
  assert.throws(
    () =>
      runtime.execute({
        type: 'drawing.update',
        id: source.id,
        patch: { points: [anchor(120), anchor(130)] },
      }),
    /DRAWING_LOCKED/,
  );
  assert.deepEqual(runtime.inspect(), beforeRejected);
  runtime.execute({
    type: 'drawing.duplicate',
    id: source.id,
    newId: 'copy',
    offset: { timeMs: minute, price: -1000 },
  });
  drawing = runtime.exportDocument().drawings[1];
  assert.equal(drawing.locked, false);
  assert.equal(drawing.visible, true);
  assert.ok(Math.abs(drawing.points[0].price - 0.01) < 1e-10);
  assert.equal(drawing.points[1].price - drawing.points[0].price, 10);
  assert.deepEqual(
    drawing.points.map(p => p.timeMs),
    [minute, 2 * minute],
  );
  runtime.execute({ type: 'drawing.order', id: 'copy', where: 'back' });
  assert.deepEqual(
    runtime.exportDocument().drawings.map(d => d.id),
    ['copy', 'line'],
  );
  runtime.execute({ type: 'drawing.order', id: 'copy', where: 'front' });
  assert.deepEqual(
    runtime.exportDocument().drawings.map(d => d.id),
    ['line', 'copy'],
  );
  runtime.execute({ type: 'drawing.lockAll', locked: true });
  assert.ok(runtime.exportDocument().drawings.every(d => d.locked));
  runtime.execute({ type: 'drawing.remove', id: 'line' });
  assert.deepEqual(
    runtime.exportDocument().drawings.map(d => d.id),
    ['copy'],
  );
  runtime.execute({ type: 'drawing.lockAll', locked: false });
  runtime.execute({ type: 'drawing.update', id: 'copy', patch: { points: [anchor(120), anchor(130)] } });
  runtime.execute({ type: 'drawing.clear' });
  assert.deepEqual(runtime.exportDocument().drawings, []);
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(runtime.exportDocument().drawings[0].points, [anchor(120), anchor(130)]);
  runtime.dispose();
});

test('undo and redo retain live prices and current navigation, while fresh content edits branch history', () => {
  const { runtime, emit } = harness();
  runtime.execute({ type: 'drawing.add', drawing: line() });
  runtime.execute({ type: 'drawing.update', id: 'line', patch: { style: { width: 5 } } });
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(runtime.inspect().history, { canUndo: true, canRedo: true });
  emit({
    type: 'candle',
    candle: { timeMs: minute, open: 110, high: 125, low: 105, close: 120, volume: 20 },
  });
  runtime.execute({ type: 'viewport.set', fromMs: 0, toMs: 30 * minute });
  runtime.execute({ type: 'priceScale.set', minPrice: 90, maxPrice: 130 });
  const { viewport, priceScale } = runtime.exportDocument();
  runtime.execute({ type: 'history.redo' });
  assert.equal(runtime.exportDocument().drawings[0].style.width, 5);
  assert.deepEqual(runtime.exportDocument().viewport, viewport);
  assert.deepEqual(runtime.exportDocument().priceScale, priceScale);
  assert.equal(runtime.inspect().latestCandle?.close, 120);
  assert.deepEqual(runtime.state().history, { canUndo: true, canRedo: false });
  runtime.execute({ type: 'history.undo' });
  runtime.execute({ type: 'drawing.update', id: 'line', patch: { text: 'new branch' } });
  assert.equal(runtime.inspect().history.canRedo, false);
  const current = runtime.exportDocument();
  runtime.execute({ type: 'history.redo' });
  assert.deepEqual(runtime.exportDocument(), current);
  runtime.dispose();
});

test('invalid drawing mutations leave document, revision and both history stacks unchanged', () => {
  const { runtime } = harness();
  runtime.execute({ type: 'drawing.add', drawing: line() });
  runtime.execute({ type: 'drawing.update', id: 'line', patch: { text: 'edit' } });
  runtime.execute({ type: 'history.undo' });
  const invalid: unknown[] = [
    { type: 'drawing.add', drawing: line() },
    { type: 'drawing.update', id: 'line', patch: { id: 'renamed' } },
    { type: 'drawing.update', id: 'line', patch: { points: [anchor(1)] } },
    { type: 'drawing.update', id: 'line', patch: { points: [anchor(-1), anchor(100)] } },
    { type: 'drawing.update', id: 'line', patch: { style: { width: NaN } } },
    { type: 'drawing.update', id: 'line', patch: { style: null } },
    { type: 'drawing.remove', id: 'missing' },
    { type: 'drawing.duplicate', id: 'line', newId: 'line' },
    { type: 'drawing.duplicate', id: 'line', newId: 'copy', offset: { timeMs: Infinity, price: 0 } },
    { type: 'drawing.order', id: 'line', where: 'middle' },
    { type: 'drawing.lockAll', locked: 'yes' },
  ];
  for (const command of invalid) {
    const before = runtime.inspect();
    assert.throws(() => runtime.execute(command as ChartCommand), JSON.stringify(command));
    assert.deepEqual(runtime.inspect(), before);
  }
  const before = runtime.inspect();
  assert.throws(
    () => runtime.execute({ type: 'drawing.remove', id: 'line' }, before.documentRevision - 1),
    /REVISION_CONFLICT/,
  );
  assert.throws(
    () => runtime.restoreDocument(before.document, before.documentRevision - 1),
    /REVISION_CONFLICT/,
  );
  assert.deepEqual(runtime.inspect(), before);
  runtime.dispose();
});

test('unavailable drawing plugins survive round trips and become usable when registered', () => {
  const { runtime } = harness();
  const custom = {
    id: 'event',
    type: 'example-event',
    points: [anchor(105)],
    text: 'Earnings',
    style: { color: '#ff0000' },
  };
  runtime.execute({ type: 'drawing.add', drawing: custom });
  assert.deepEqual(runtime.inspect().unsupportedDrawingTypes, ['example-event']);
  const document = runtime.exportDocument();
  runtime.restoreDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(runtime.exportDocument(), document);
  const definition: DrawingToolDefinition = {
    type: 'example-event',
    label: 'Event',
    group: 'Custom',
    points: 1,
    hint: 'Click an event location',
    project: () => [],
    validate(drawing) {
      if (!drawing.text) throw new Error('EVENT_TEXT_REQUIRED');
    },
  };
  const registered = harness([definition]);
  registered.runtime.restoreDocument(document);
  assert.deepEqual(registered.runtime.inspect().unsupportedDrawingTypes, []);
  assert.deepEqual(registered.runtime.exportDocument(), document);
  assert.throws(
    () => registered.runtime.execute({ type: 'drawing.update', id: 'event', patch: { text: '' } }),
    /EVENT_TEXT_REQUIRED/,
  );
  assert.deepEqual(registered.runtime.exportDocument(), document);
  runtime.dispose();
  registered.runtime.dispose();
});

test('history is bounded and a market generation discards undo and redo', () => {
  const { runtime, feed } = harness();
  runtime.execute({ type: 'drawing.add', drawing: line() });
  for (let i = 1; i <= 50; i++)
    runtime.execute({ type: 'drawing.update', id: 'line', patch: { text: `edit ${i}` } });
  for (let i = 0; i < 50; i++) runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().drawings[0].text, 'edit 10');
  assert.deepEqual(runtime.inspect().history, { canUndo: false, canRedo: true });
  for (let i = 0; i < 50; i++) runtime.execute({ type: 'history.redo' });
  assert.equal(runtime.exportDocument().drawings[0].text, 'edit 50');
  runtime.execute({ type: 'history.undo' });
  runtime.replaceFeed({ ...feed });
  assert.deepEqual(runtime.inspect().history, { canUndo: false, canRedo: false });
  assert.equal(runtime.exportDocument().drawings[0].text, 'edit 49');
  runtime.dispose();
});

test('navigation reuses validated drawings without invoking plugins and rejects ranges atomically', () => {
  let validations = 0;
  const definition: DrawingToolDefinition = {
    type: 'example-counted',
    label: 'Counted',
    group: 'Custom',
    points: 1,
    hint: 'Click',
    project: () => [],
    validate() {
      validations++;
    },
  };
  const { runtime } = harness([definition]);
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'one', type: definition.type, points: [anchor(100)] },
  });
  const drawings = runtime.state().document.drawings,
    validationCount = validations;
  const navigation: ChartCommand[] = [
    { type: 'viewport.set', fromMs: 0, toMs: 60 * minute },
    {
      type: 'viewport.set',
      fromMs: minute,
      toMs: 61 * minute,
      priceScale: { mode: 'manual', minPrice: 90, maxPrice: 130 },
    },
    { type: 'priceScale.set', minPrice: 80, maxPrice: 140 },
    { type: 'priceScale.reset' },
    { type: 'viewport.reset' },
  ];
  for (const command of navigation) {
    runtime.execute(command);
    assert.equal(runtime.state().document.drawings, drawings);
    assert.equal(validations, validationCount);
  }
  const before = runtime.inspect();
  assert.throws(() => runtime.execute({ type: 'viewport.set', fromMs: 0, toMs: 1 }), /INVALID_VIEWPORT/);
  assert.throws(
    () =>
      runtime.execute({
        type: 'viewport.set',
        fromMs: 0,
        toMs: 60 * minute,
        priceScale: { mode: 'manual', minPrice: 130, maxPrice: 90 },
      }),
    /INVALID_PRICE_SCALE/,
  );
  assert.throws(
    () => runtime.execute({ type: 'priceScale.set', minPrice: NaN, maxPrice: 140 }),
    /INVALID_PRICE_SCALE/,
  );
  assert.deepEqual(runtime.inspect(), before);
  assert.equal(runtime.state().document.drawings, drawings);
  assert.equal(validations, validationCount);
  const exported = runtime.exportDocument();
  exported.drawings[0].points[0].price = 999;
  assert.equal(drawings[0].points[0].price, 100);
  runtime.dispose();
});

test('drawing count, point count and serialized payload are bounded before restore commits', () => {
  const { runtime } = harness();
  const original = runtime.inspect();
  assert.throws(
    () =>
      runtime.restoreDocument({
        ...original.document,
        drawings: Array.from({ length: 101 }, (_, i) => line(`line-${i}`)),
      }),
    /INVALID_DRAWINGS/,
  );
  const manyPoints = Array.from({ length: 1000 }, (_, i) => anchor(100 + i / 100, i * minute));
  assert.throws(
    () =>
      runtime.restoreDocument({
        ...original.document,
        drawings: Array.from({ length: 9 }, (_, i) => ({
          id: `path-${i}`,
          type: 'brush',
          points: manyPoints,
        })),
      }),
    /DRAWING_LIMIT_EXCEEDED/,
  );
  const largePoints = Array.from({ length: 1000 }, (_, i) =>
    anchor(1234567890.123456 + i, 1790928000123 + i),
  );
  assert.throws(
    () =>
      runtime.restoreDocument({
        ...original.document,
        drawings: Array.from({ length: 8 }, (_, i) => ({
          id: `path-${i}`,
          type: 'brush',
          points: largePoints,
        })),
      }),
    /DRAWING_LIMIT_EXCEEDED/,
  );
  assert.deepEqual(runtime.inspect(), original);
  runtime.dispose();
});
