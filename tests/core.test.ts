import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrderBook } from '../src/order-book.ts';
import { binBook, HeatmapStore } from '../src/heatmap.ts';
import { sma } from '../src/indicators.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createGeometry } from '../src/geometry.ts';
import { dragPriceScale, dragTimeScale, panPriceScale, panTimeScale } from '../src/scales.ts';
import type { Candle, DepthSnapshot, FeedAdapter, FeedEvent, FeedDescriptor } from '../src/types.ts';

const minute = 60000;
const grid = { minPrice: 90, binSize: 5, rows: 8, intervalMs: minute };
const snapshot = (sequence = 10): DepthSnapshot => ({
  sequence,
  bids: [
    [99, 2],
    [98, 3],
  ],
  asks: [
    [101, 4],
    [102, 5],
  ],
});
const bar = (index: number, close = 100): Candle => ({
  timeMs: index * minute,
  open: 100,
  high: Math.max(101, close),
  low: Math.min(99, close),
  close,
  volume: 10,
});
const column = (index: number, valid = true) => ({
  timeMs: index * minute,
  values: new Float32Array(8).fill(index),
  valid,
});

test('axis drag scales expand and compress with fixed anchors and bounded ranges', () => {
  const time = (dx: number) => dragTimeScale(0, 180 * minute, dx, 600, minute);
  assert.ok(time(100).fromMs > 0);
  assert.ok(time(-100).fromMs < 0);
  assert.equal(time(100).toMs, 180 * minute);
  assert.equal(time(1e6).toMs - time(1e6).fromMs, 25 * minute);
  assert.equal(time(-1e6).toMs - time(-1e6).fromMs, 2200 * minute);
  const price = (dy: number) => dragPriceScale(90, 110, dy, 300, 0.01);
  assert.ok(price(-100).maxPrice - price(-100).minPrice < 20);
  assert.ok(price(100).maxPrice - price(100).minPrice > 20);
  assert.equal((price(-100).maxPrice + price(-100).minPrice) / 2, 100);
  assert.ok(price(1e6).minPrice > 0);
  assert.ok(price(-1e6).maxPrice - price(-1e6).minPrice >= 0.01);
});

test('time panning stays reversible at zoom levels wider than the loaded history', () => {
  const firstMs = Date.UTC(2026, 9, 2, 6);
  const history = { firstMs, lastMs: firstMs + 359 * minute, intervalMs: minute };
  for (const bars of [25, 180, 360, 449, 450, 1000, 2200]) {
    const span = bars * minute;
    const fromMs = firstMs + 180 * minute - span / 2;
    for (const dx of [-50, 50]) {
      const moved = panTimeScale(fromMs, fromMs + span, dx, 1000, history);
      assert.equal(moved.fromMs, fromMs - (dx / 1000) * span, `pan at ${bars} bars`);
      assert.equal(moved.toMs - moved.fromMs, span);
      assert.equal(moved.clamped, false);
      const reversed = panTimeScale(moved.fromMs, moved.toMs, -dx, 1000, history);
      assert.equal(reversed.fromMs, fromMs);
    }
  }
  // The reported failure: 2,200 visible bars, candles against the left edge.
  const fromMs = firstMs - 30 * minute,
    toMs = fromMs + 2200 * minute;
  assert.ok(panTimeScale(fromMs, toMs, 50, 1000, history).fromMs < fromMs);
  assert.ok(panTimeScale(fromMs, toMs, -50, 1000, history).fromMs > fromMs);
});

test('time pan edges retain data and allow immediate reversal without snapping outlying views', () => {
  const history = { firstMs: 0, lastMs: 359 * minute, intervalMs: minute };
  const left = panTimeScale(0, 2200 * minute, 1e6, 1000, history);
  const right = panTimeScale(0, 2200 * minute, -1e6, 1000, history);
  assert.equal(left.toMs, 5 * minute);
  assert.equal(right.fromMs, 355 * minute);
  assert.equal(left.clamped, true);
  assert.equal(right.clamped, true);
  // Each clamped pointer event becomes the next origin in the chart handler.
  assert.ok(panTimeScale(left.fromMs, left.toMs, -1, 1000, history).fromMs > left.fromMs);
  assert.ok(panTimeScale(right.fromMs, right.toMs, 1, 1000, history).fromMs < right.fromMs);
  const outlyingFrom = 1000 * minute,
    outlyingTo = 1180 * minute;
  assert.equal(panTimeScale(outlyingFrom, outlyingTo, 0, 1000, history).fromMs, outlyingFrom);
  assert.equal(panTimeScale(outlyingFrom, outlyingTo, 10, 1000, history).fromMs, outlyingFrom - 1.8 * minute);
});

test('book applies absolute quantities, deletions and duplicate messages without double counting', () => {
  const book = new OrderBook();
  book.snapshot(snapshot());
  const delta = {
    sequence: 11,
    previousSequence: 10,
    bids: [
      [99, 7],
      [98, 0],
    ] as const,
    asks: [],
  };
  assert.equal(book.delta(delta), 'applied');
  assert.deepEqual(book.inspect().bids, [[99, 7]]);
  assert.equal(book.delta(delta), 'duplicate');
  assert.deepEqual(book.inspect().bids, [[99, 7]]);
});

test('a sequence gap blocks later deltas until a current snapshot arrives', () => {
  const book = new OrderBook();
  book.snapshot(snapshot());
  assert.equal(book.delta({ sequence: 12, previousSequence: 11, bids: [[99, 20]], asks: [] }), 'gap');
  assert.equal(book.inspect().status, 'stale');
  assert.equal(book.delta({ sequence: 11, previousSequence: 10, bids: [], asks: [] }), 'gap');
  assert.equal(book.snapshot(snapshot(9)), false);
  assert.equal(book.inspect().status, 'stale');
  book.snapshot(snapshot(14));
  assert.equal(book.delta({ sequence: 15, previousSequence: 14, bids: [], asks: [] }), 'applied');
  assert.equal(book.inspect().status, 'live');
});

test('crossed and malformed book updates preserve the last valid data and mark it stale', () => {
  for (const bids of [
    [[105, 2]],
    [[99, -2]],
    [
      [99, 2],
      [99, 3],
    ],
  ] as const) {
    const book = new OrderBook();
    book.snapshot(snapshot());
    assert.throws(() => book.delta({ sequence: 11, previousSequence: 10, bids, asks: [] }));
    assert.deepEqual(book.inspect(), { ...snapshot(), status: 'stale' });
  }
});

test('heatmap ring wraps in chronological order and remains bounded', () => {
  const heatmap = new HeatmapStore(grid, 3);
  for (let i = 0; i < 8; i++) heatmap.append(column(i));
  assert.equal(heatmap.count, 3);
  assert.equal(heatmap.firstTimeMs, 5 * minute);
  assert.deepEqual(
    Array.from({ length: 3 }, (_, i) => heatmap.columns[(heatmap.startSlot + i) % 3]!.timeMs),
    [5, 6, 7].map(n => n * minute),
  );
});

test('depth gaps remain unknown after recovery within the same interval', () => {
  const heatmap = new HeatmapStore(grid, 4);
  heatmap.append(column(0));
  heatmap.append(column(2, false));
  heatmap.append(column(2, true));
  assert.equal(heatmap.columns[1]!.valid, false);
  assert.equal(heatmap.columns[2]!.valid, false);
  heatmap.append(column(3));
  assert.equal(heatmap.columns[3]!.valid, true);
  assert.throws(() => heatmap.append(column(1)), /OUT_OF_ORDER/);
});

test('large feed gaps discard expired columns and reject invalid depth values', () => {
  const heatmap = new HeatmapStore(grid, 4);
  heatmap.append(column(0));
  heatmap.append(column(1000));
  assert.equal(heatmap.count, 4);
  assert.equal(heatmap.firstTimeMs, 997 * minute);
  assert.throws(() => heatmap.append({ ...column(1001), timeMs: NaN }), /INVALID_HEATMAP_COLUMN/);
  assert.throws(() => new HeatmapStore({ ...grid, intervalMs: 0 }), /INVALID_HEATMAP_GRID/);
});

test('heatmap sums price bins and never represents a stale book as valid liquidity', () => {
  const book = new OrderBook();
  book.snapshot(snapshot());
  const binned = binBook(book.inspect(), grid, 0);
  assert.equal(binned.values[1], 5);
  assert.equal(binned.values[2], 9);
  assert.equal(binned.valid, true);
  const missing = binBook({ ...book.inspect(), status: 'stale' }, grid, 0);
  assert.equal(missing.valid, false);
  assert.equal(
    missing.values.reduce((a, b) => a + b),
    0,
  );
});

test('incremental SMA matches an independent rolling calculation after last-bar and historical corrections', () => {
  const candles = Array.from({ length: 10 }, (_, i) => bar(i, 100 + i));
  const plugin = sma(3);
  let values = plugin.calculate(candles, [], 0);
  for (const [index, close] of [
    [9, 120],
    [9, 115],
    [2, 130],
  ]) {
    candles[index] = bar(index, close);
    values = plugin.calculate(candles, values, index);
    const expected = candles.map((_, i) =>
      i < 2 ? NaN : candles.slice(i - 2, i + 1).reduce((sum, c) => sum + c.close, 0) / 3,
    );
    assert.deepEqual(values, expected);
  }
});

function descriptor(symbol = 'TEST/USD', interval: FeedDescriptor['interval'] = '1m'): FeedDescriptor {
  return {
    id: 'test',
    label: 'Test feed',
    simulated: true,
    interval,
    intervalMs: interval === '5m' ? 5 * minute : minute,
    instrument: {
      symbol,
      name: symbol,
      base: symbol.split('/')[0],
      quote: 'USD',
      tickSize: 0.01,
      pricePrecision: 2,
      quantityPrecision: 3,
    },
    depth: { kind: 'sequenced', levels: 80 },
  };
}

function harness(historyLength = 3, heatmap = true) {
  let emit: (event: FeedEvent) => void = () => {};
  const counts = { snapshots: 0, disposed: 0, paused: false, connects: 0 };
  const feed: FeedAdapter = {
    descriptor: descriptor(),
    connect(listener) {
      counts.connects++;
      emit = listener;
      emit({ type: 'candles.history', candles: Array.from({ length: historyLength }, (_, i) => bar(i)) });
      emit({ type: 'depth.snapshot', book: snapshot() });
      emit({ type: 'heatmap.history', grid, columns: [column(0), column(1), column(2)] });
      return {
        requestSnapshot() {
          counts.snapshots++;
        },
        setPaused(paused) {
          counts.paused = paused;
        },
        dispose() {
          counts.disposed++;
        },
      };
    },
  };
  const runtime = new ChartRuntime(feed, [sma(2)], { heatmap });
  runtime.start();
  return { runtime, counts, emit: (event: FeedEvent) => emit(event) };
}

test('runtime resynchronizes sequence gaps and preserves their heatmap marker', () => {
  const { runtime, counts, emit } = harness();
  emit({ type: 'candle', candle: bar(2, 101) });
  emit({ type: 'depth.delta', book: { ...snapshot(12), previousSequence: 11 } });
  assert.equal(counts.snapshots, 1);
  assert.equal(runtime.inspect().book.status, 'stale');
  emit({ type: 'depth.snapshot', book: snapshot(14) });
  emit({ type: 'candle', candle: bar(2, 102) });
  emit({ type: 'depth.delta', book: { ...snapshot(15), previousSequence: 14 } });
  assert.equal(runtime.inspect().book.status, 'live');
  assert.equal(runtime.heatmap!.columns[2]!.valid, false);
  assert.equal(runtime.inspect().indicators[0].value, 101);
  runtime.dispose();
});

test('document commands validate atomically and reject stale agent revisions', () => {
  const { runtime } = harness();
  const original = runtime.exportDocument();
  assert.throws(() => runtime.execute({ type: 'heatmap.intensity', value: NaN }), /INVALID_INTENSITY/);
  assert.deepEqual(runtime.exportDocument(), original);
  runtime.execute({ type: 'layer.set', layer: 'heatmap', visible: false }, 0);
  assert.throws(() => runtime.execute({ type: 'drawing.clear' }, 0), /REVISION_CONFLICT/);
  assert.throws(() => runtime.restoreDocument({ ...original, symbol: 'OTHER' }), /SYMBOL_MISMATCH/);
  assert.equal(runtime.inspect().documentRevision, 1);
  runtime.dispose();
});

test('layout round-trips independently of feed data and undo preserves streamed prices', () => {
  const { runtime, emit } = harness();
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'line-1', start: { timeMs: 0, price: 100 }, end: { timeMs: minute, price: 110 } },
  });
  const saved = JSON.parse(JSON.stringify(runtime.exportDocument()));
  emit({ type: 'candle', candle: bar(3, 105) });
  const liveViewport = runtime.exportDocument().viewport;
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.inspect().latestCandle!.close, 105);
  assert.deepEqual(runtime.exportDocument().viewport, liveViewport);
  assert.equal(runtime.exportDocument().drawings.length, 0);
  runtime.restoreDocument(saved);
  assert.deepEqual(runtime.exportDocument(), saved);
  saved.drawings[0].points[0].price = 999;
  assert.equal(runtime.exportDocument().drawings[0].points[0].price, 100);
  runtime.dispose();
});

test('pause delegates to the feed and disposal is idempotent, stopping future publications', () => {
  const { runtime, counts, emit } = harness();
  runtime.start();
  assert.equal(counts.connects, 1);
  runtime.execute({ type: 'feed.pause', paused: true });
  assert.equal(counts.paused, true);
  let publications = 0;
  runtime.subscribe(() => publications++);
  runtime.dispose();
  runtime.dispose();
  emit({ type: 'depth.snapshot', book: snapshot(20) });
  assert.equal(counts.disposed, 1);
  assert.equal(publications, 1);
  assert.throws(() => runtime.execute({ type: 'drawing.clear' }), /DISPOSED/);
});

test('initial and streaming candle retention share the same bound', () => {
  const { runtime, emit } = harness(2005);
  assert.equal(runtime.inspect().candleCount, 2000);
  assert.equal(runtime.state().candles[0].timeMs, 5 * minute);
  emit({ type: 'candle', candle: bar(2005, 106) });
  assert.equal(runtime.inspect().candleCount, 2000);
  assert.equal(runtime.state().candles[0].timeMs, 6 * minute);
  assert.equal(runtime.inspect().indicators[0].value, 103);
  runtime.execute({
    type: 'viewport.set',
    fromMs: runtime.state().candles[0].timeMs,
    toMs: bar(2017).timeMs,
  });
  assert.equal(runtime.exportDocument().viewport.toMs, bar(2017).timeMs);
  runtime.dispose();
});

function controlledFeed(symbol = 'TEST/USD', interval: FeedDescriptor['interval'] = '1m') {
  let publish: (event: FeedEvent) => void = () => {};
  const counts = { connects: 0, disposed: 0 };
  const feed: FeedAdapter = {
    descriptor: descriptor(symbol, interval),
    connect(emit) {
      counts.connects++;
      publish = emit;
      return {
        dispose() {
          counts.disposed++;
        },
        requestSnapshot() {},
        setPaused() {},
      };
    },
  };
  return { feed, counts, emit: (event: FeedEvent) => publish(event) };
}

test('switching markets rejects late old-generation data and clears stale chart state before loading', () => {
  const old = controlledFeed(),
    next = controlledFeed('NEXT/USD', '5m');
  const runtime = new ChartRuntime(old.feed);
  runtime.start();
  old.emit({ type: 'candles.history', candles: [bar(0), bar(1)] });
  old.emit({ type: 'depth.snapshot', book: snapshot() });
  runtime.execute({ type: 'priceScale.set', minPrice: 95, maxPrice: 105 });
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'old', start: { timeMs: 0, price: 100 }, end: { timeMs: minute, price: 102 } },
  });
  const revision = runtime.inspect().documentRevision;
  runtime.replaceFeed(next.feed, revision);
  assert.equal(old.counts.disposed, 1);
  assert.equal(runtime.inspect().candleCount, 0);
  assert.equal(runtime.inspect().book.sequence, -1);
  assert.equal(runtime.inspect().document.drawings.length, 0);
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'auto' });
  old.emit({ type: 'candles.history', candles: [bar(0, 999)] });
  old.emit({ type: 'depth.snapshot', book: snapshot(999) });
  assert.equal(runtime.inspect().candleCount, 0);
  assert.equal(runtime.inspect().book.sequence, -1);
  next.emit({ type: 'candles.history', candles: [bar(0, 200), bar(5, 201)] });
  assert.equal(runtime.inspect().latestCandle!.close, 201);
  assert.ok(createGeometry(runtime.state(), 800, 500).maxPrice > 201);
  assert.equal(
    runtime.exportDocument().viewport.toMs - runtime.exportDocument().viewport.fromMs,
    180 * 5 * minute,
  );
  assert.throws(() => runtime.replaceFeed(old.feed, revision), /REVISION_CONFLICT/);
  runtime.dispose();
});

test('paused market changes defer connecting and ignore incoming data until resumed', () => {
  const old = controlledFeed(),
    next = controlledFeed('NEXT/USD');
  const runtime = new ChartRuntime(old.feed);
  runtime.start();
  old.emit({ type: 'candles.history', candles: [bar(0)] });
  runtime.execute({ type: 'feed.pause', paused: true });
  old.emit({ type: 'candle', candle: bar(1, 123) });
  assert.equal(runtime.inspect().latestCandle!.timeMs, 0);
  runtime.replaceFeed(next.feed);
  assert.equal(next.counts.connects, 0);
  assert.equal(runtime.inspect().streams.candles.status, 'paused');
  runtime.execute({ type: 'feed.pause', paused: false });
  assert.equal(next.counts.connects, 1);
  next.emit({ type: 'candles.history', candles: [bar(0, 202)] });
  assert.equal(runtime.inspect().latestCandle!.close, 202);
  runtime.dispose();
});

test('depth health and updates are independent of candles and indicator calculation', () => {
  const feed = controlledFeed();
  let calculations = 0;
  const plugin = sma(2),
    calculate = plugin.calculate;
  plugin.calculate = (...args) => {
    calculations++;
    return calculate(...args);
  };
  const runtime = new ChartRuntime(feed.feed, [plugin]);
  runtime.start();
  feed.emit({ type: 'candles.history', candles: [bar(0), bar(1)] });
  feed.emit({ type: 'depth.snapshot', book: snapshot() });
  feed.emit({ type: 'depth.snapshot', book: snapshot(200) });
  assert.equal(calculations, 1);
  assert.equal(runtime.inspect().book.status, 'live');
  feed.emit({ type: 'stream.status', stream: 'depth', status: 'error', message: 'Depth unavailable' });
  feed.emit({ type: 'candle', candle: bar(2, 110) });
  assert.equal(runtime.inspect().streams.candles.status, 'live');
  assert.equal(runtime.inspect().streams.depth.status, 'error');
  assert.equal(runtime.inspect().book.status, 'stale');
  assert.match(runtime.inspect().error!, /Depth unavailable/);
  runtime.dispose();
});

test('disabled heatmaps allocate no history and cannot return through restore or commands', () => {
  const { runtime } = harness(3, false);
  assert.equal(runtime.heatmap, undefined);
  assert.equal(runtime.inspect().heatmap, null);
  const document = runtime.exportDocument();
  document.layers.heatmap = true;
  runtime.restoreDocument(document);
  assert.equal(runtime.exportDocument().layers.heatmap, false);
  assert.throws(
    () => runtime.execute({ type: 'layer.set', layer: 'heatmap', visible: true }),
    /HEATMAP_DISABLED/,
  );
  assert.throws(() => runtime.restoreDocument({ ...document, interval: '5m' }), /MARKET_MISMATCH/);
  runtime.dispose();
});

test('interval changes preserve time-price drawings but isolate undo and saved layouts', () => {
  const old = controlledFeed(),
    next = controlledFeed('TEST/USD', '5m');
  const runtime = new ChartRuntime(old.feed);
  runtime.start();
  const drawing = { id: 'line', start: { timeMs: 0, price: 100 }, end: { timeMs: minute, price: 102 } };
  runtime.execute({ type: 'drawing.add', drawing });
  const saved = runtime.exportDocument();
  runtime.replaceFeed(next.feed);
  assert.deepEqual(runtime.exportDocument().drawings, saved.drawings);
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(runtime.exportDocument().drawings, saved.drawings);
  assert.throws(() => runtime.restoreDocument(saved), /MARKET_MISMATCH/);
  runtime.dispose();
});

test('legacy layouts migrate only for the original market and retain the disabled heatmap policy', () => {
  const feed = controlledFeed('BTC/USD');
  const runtime = new ChartRuntime(feed.feed);
  runtime.start();
  const { feedId: _id, interval: _interval, ...document } = runtime.exportDocument();
  runtime.restoreDocument({ ...document, version: 1, layers: { ...document.layers, heatmap: true } });
  assert.equal(runtime.exportDocument().version, 3);
  assert.equal(runtime.exportDocument().layers.heatmap, false);
  runtime.dispose();
});

test('manual price scale survives ticks, horizontal zoom, persistence and content undo', () => {
  const { runtime, emit } = harness();
  const viewport = runtime.exportDocument().viewport;
  runtime.execute({ type: 'priceScale.set', minPrice: 95, maxPrice: 105 });
  assert.deepEqual(runtime.exportDocument().viewport, viewport);
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'scale-test', start: { timeMs: 0, price: 100 }, end: { timeMs: minute, price: 101 } },
  });
  runtime.execute({ type: 'priceScale.set', minPrice: 98, maxPrice: 102 });
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().drawings.length, 0);
  emit({ type: 'candle', candle: bar(3, 120) });
  runtime.execute({ type: 'viewport.set', fromMs: 0, toMs: 30 * minute });
  const geometry = createGeometry(runtime.state(), 800, 500);
  assert.deepEqual([geometry.minPrice, geometry.maxPrice], [98, 102]);
  assert.ok(geometry.y(120) < geometry.top);
  const document = JSON.parse(JSON.stringify(runtime.exportDocument()));
  runtime.execute({ type: 'priceScale.reset' });
  assert.ok(createGeometry(runtime.state(), 800, 500).maxPrice > 120);
  runtime.restoreDocument(document);
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'manual', minPrice: 98, maxPrice: 102 });
  runtime.execute({ type: 'viewport.reset' });
  assert.deepEqual(runtime.exportDocument().priceScale, document.priceScale);
  runtime.dispose();
});

test('plot panning follows the pointer in both axes without resizing or partial viewport updates', () => {
  const { runtime } = harness(360);
  const start = createGeometry(runtime.state(), 800, 500);
  const point = { timeMs: minute, price: 100 };
  let publications = 0;
  const unsubscribe = runtime.subscribe(() => {
    publications++;
  });
  for (const [dx, dy] of [
    [0, 100],
    [0, -100],
    [120, 80],
    [-120, -80],
    [0, 0],
  ]) {
    const { fromMs, toMs } = panTimeScale(start.fromMs, start.toMs, dx, start.plotWidth, {
      firstMs: 0,
      lastMs: 359 * minute,
      intervalMs: minute,
    });
    const scale = panPriceScale(start.minPrice, start.maxPrice, dy, start.plotHeight, 0.01);
    publications = 0;
    runtime.execute({ type: 'viewport.set', fromMs, toMs, priceScale: { mode: 'manual', ...scale } });
    const after = createGeometry(runtime.state(), 800, 500);
    assert.ok(Math.abs(after.x(point.timeMs) - start.x(point.timeMs) - dx) < 1e-8);
    assert.ok(Math.abs(after.y(point.price) - start.y(point.price) - dy) < 1e-8);
    assert.ok(Math.abs(after.maxPrice - after.minPrice - (start.maxPrice - start.minPrice)) < 1e-8);
    assert.equal(after.toMs - after.fromMs, start.toMs - start.fromMs);
    assert.equal(publications, 1);
  }
  const beforeInvalid = runtime.exportDocument();
  assert.throws(
    () =>
      runtime.execute({
        type: 'viewport.set',
        fromMs: 0,
        toMs: 30 * minute,
        priceScale: { mode: 'manual', minPrice: 100, maxPrice: 99 },
      }),
    /INVALID_PRICE_SCALE/,
  );
  assert.deepEqual(runtime.exportDocument(), beforeInvalid);
  const floor = panPriceScale(10, 30, -1e6, 300, 0.01);
  assert.equal(floor.minPrice, 0.01);
  assert.equal(floor.maxPrice - floor.minPrice, 20);
  unsubscribe();
  runtime.dispose();
});

test('invalid price ranges are rejected atomically and older layouts default to automatic scale', () => {
  const { runtime } = harness();
  const before = runtime.exportDocument();
  for (const [minPrice, maxPrice] of [
    [0, 100],
    [110, 90],
    [100, Infinity],
    [NaN, 100],
    [100, 100.001],
  ]) {
    assert.throws(
      () => runtime.execute({ type: 'priceScale.set', minPrice, maxPrice }),
      /INVALID_PRICE_SCALE/,
    );
    assert.deepEqual(runtime.exportDocument(), before);
  }
  const { priceScale: _scale, ...older } = before;
  runtime.restoreDocument(older);
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'auto' });
  runtime.dispose();
});
