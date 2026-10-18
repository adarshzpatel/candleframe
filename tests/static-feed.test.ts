import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartRuntime } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import { sma } from '../src/indicators.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000;
const series = (count: number, start = 0): Candle[] =>
  Array.from({ length: count }, (_, i) => {
    const close = Number((100 + Math.sin((start + i) / 10) * 5).toFixed(2));
    return {
      timeMs: (start + i) * MINUTE,
      open: Number((close - 0.25).toFixed(2)),
      high: Number((close + 1).toFixed(2)),
      low: Number((close - 1).toFixed(2)),
      close,
      volume: 3,
    };
  });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('a static feed charts an array with inferred instrument metadata', () => {
  const feed = createStaticFeed({ candles: series(50), interval: '1m', instrument: 'ACME' });
  assert.equal(feed.descriptor.instrument.pricePrecision, 2);
  assert.equal(feed.descriptor.instrument.tickSize, 0.01);
  const runtime = new ChartRuntime(feed, [sma(5)]);
  runtime.start();
  const state = runtime.inspect();
  assert.equal(state.candleCount, 50);
  assert.equal(state.stream.status, 'live');
  assert.equal(state.error, null);
  runtime.dispose();
});

test('static feeds reject unordered candles with the failing index', () => {
  const candles = series(5);
  [candles[2], candles[3]] = [candles[3], candles[2]];
  assert.throws(() => createStaticFeed({ candles, interval: '1m', instrument: 'ACME' }), {
    code: 'INVALID_HISTORY',
    path: 'candles.3.timeMs',
  });
});

test('host updates append, replace the last bar and correct loaded bars', () => {
  const feed = createStaticFeed({ candles: series(30), interval: '1m', instrument: 'ACME' });
  const runtime = new ChartRuntime(feed);
  runtime.start();
  const [next] = series(1, 30);
  feed.update(next);
  assert.equal(runtime.inspect().candleCount, 31);
  feed.update({ ...next, close: 200, high: 201 });
  assert.equal(runtime.inspect().latestCandle?.close, 200);
  assert.throws(() => feed.update({ ...next, timeMs: -MINUTE }), { code: 'UNKNOWN_CORRECTION' });
  runtime.dispose();
});

test('older history pages in until the data is exhausted', async () => {
  const feed = createStaticFeed({
    candles: series(2500),
    interval: '1m',
    instrument: 'ACME',
    initialBars: 1000,
    pageSize: 1000,
  });
  const runtime = new ChartRuntime(feed, [sma(20)]);
  runtime.start();
  assert.equal(runtime.inspect().olderHistory.status, 'idle');
  const viewport = runtime.inspect().document.viewport;
  assert.equal(runtime.loadOlderHistory(), true);
  assert.equal(runtime.inspect().olderHistory.status, 'loading');
  assert.equal(runtime.loadOlderHistory(), false, 'one request at a time');
  await flush();
  assert.equal(runtime.inspect().candleCount, 2000);
  assert.equal(runtime.inspect().firstCandleTimeMs, 500 * MINUTE);
  assert.deepEqual(runtime.inspect().document.viewport, viewport, 'paging does not move the view');
  runtime.loadOlderHistory();
  await flush();
  const state = runtime.inspect();
  assert.equal(state.candleCount, 2500);
  assert.equal(state.olderHistory.status, 'exhausted');
  assert.equal(runtime.loadOlderHistory(), false);
  // Indicators cover the paged bars: the 20th bar is the first with a value.
  const values = runtime.state().indicators[0].values;
  assert.ok(Number.isNaN(values[18]) && Number.isFinite(values[19]));
  runtime.dispose();
});

test('paging stops at maxCandles', async () => {
  const feed = createStaticFeed({
    candles: series(3000),
    interval: '1m',
    instrument: 'ACME',
    initialBars: 500,
  });
  const runtime = new ChartRuntime(feed, [], { maxCandles: 800 });
  runtime.start();
  runtime.loadOlderHistory();
  await flush();
  const state = runtime.inspect();
  assert.equal(state.candleCount, 800);
  assert.equal(state.olderHistory.status, 'exhausted');
  assert.equal(state.olderHistory.message, 'Reached maxCandles');
  assert.throws(() => new ChartRuntime(feed, [], { maxCandles: 5 }), { code: 'INVALID_OPTION' });
  runtime.dispose();
});

test('overlapping or failed pages report an error and allow a retry', async () => {
  const candles = series(100);
  const runtime = new ChartRuntime({
    descriptor: createStaticFeed({ candles, interval: '1m', instrument: 'ACME' }).descriptor,
    connect(emit) {
      emit({ type: 'candles.history', candles: candles.slice(50) });
      let calls = 0;
      return {
        setPaused() {},

        dispose() {},
        loadOlder() {
          calls++;
          queueMicrotask(() =>
            emit(
              calls === 1
                ? { type: 'candles.prepend', candles: candles.slice(40, 60) }
                : { type: 'candles.prepend', candles: [], error: 'HTTP 500' },
            ),
          );
        },
      };
    },
  });
  runtime.start();
  runtime.loadOlderHistory();
  await flush();
  assert.equal(runtime.inspect().olderHistory.status, 'error');
  assert.match(runtime.inspect().olderHistory.message ?? '', /overlap/);
  assert.equal(runtime.inspect().candleCount, 50);
  assert.equal(runtime.loadOlderHistory(), true, 'errors can be retried');
  await flush();
  assert.equal(runtime.inspect().olderHistory.message, 'HTTP 500');
  assert.equal(runtime.inspect().stream.status, 'live', 'the live stream is unaffected');
  runtime.dispose();
});

test('the simulation pages older bars deterministically', async () => {
  const runtime = new ChartRuntime(createSimulatedFeed({ seed: 7 }));
  runtime.start();
  runtime.execute({ type: 'feed.pause', paused: true });
  runtime.execute({ type: 'feed.pause', paused: false });
  const first = runtime.inspect().firstCandleTimeMs!;
  assert.equal(runtime.loadOlderHistory(), true);
  await flush();
  const state = runtime.inspect();
  assert.equal(state.firstCandleTimeMs, first - 360 * MINUTE);
  assert.equal(state.olderHistory.status, 'idle');
  runtime.dispose();
});
