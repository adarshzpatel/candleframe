import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrderBook } from '../src/order-book.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { Candle, FeedEvent } from '../src/types.ts';

function latestCandle(events: readonly FeedEvent[]): Candle {
  const event = events.filter(event => event.type === 'candle').at(-1);
  assert.ok(event, 'Expected a streamed candle');
  return event.candle;
}

test('simulated intervals aggregate the same minute history without enabling heatmap data', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
    const histories: Record<string, readonly Candle[]> = {};
    for (const interval of ['1m', '5m'] as const) {
      const events: FeedEvent[] = [];
      const feed = createSimulatedFeed({ seed: 42, symbol, interval });
      const connection = feed.connect(event => events.push(event));
      t.after(() => connection.dispose());
      const history = events.find(event => event.type === 'candles.history');
      assert.ok(history);
      assert.equal(history.candles.length, 360);
      assert.equal(
        events.some(event => event.type === 'heatmap.history'),
        false,
      );
      assert.ok(
        history.candles.every(
          (bar, i) =>
            bar.timeMs % feed.descriptor.intervalMs === 0 &&
            (!i || bar.timeMs > history.candles[i - 1].timeMs),
        ),
      );
      histories[interval] = history.candles;
      connection.dispose();
    }
    assert.equal(histories['1m'].at(-1)!.close, histories['5m'].at(-1)!.close);
    const overlapping = histories['5m'].filter(
      bar =>
        bar.timeMs >= histories['1m'][0].timeMs && bar.timeMs + 300_000 <= histories['1m'].at(-1)!.timeMs,
    );
    assert.ok(overlapping.length > 60, 'Compare a substantial overlapping history');
    for (const bar of overlapping) {
      const children = histories['1m'].filter(
        child => child.timeMs >= bar.timeMs && child.timeMs < bar.timeMs + 300_000,
      );
      assert.equal(children.length, 5);
      assert.deepEqual(bar, {
        timeMs: children[0].timeMs,
        open: children[0].open,
        high: Math.max(...children.map(child => child.high)),
        low: Math.min(...children.map(child => child.low)),
        close: children.at(-1)!.close,
        volume: children.reduce((sum, child) => sum + child.volume, 0),
      });
    }
  }
});

test('five-minute candles take 30 ticks, pause freezes the clock and disposal cancels pending work', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const events: FeedEvent[] = [];
  const connection = createSimulatedFeed({ interval: '5m' }).connect(event => events.push(event));
  t.after(() => connection.dispose());
  const history = events.find(event => event.type === 'candles.history');
  assert.ok(history);
  const startMs = history.candles.at(-1)!.timeMs;
  for (let tick = 0; tick < 29; tick++) t.mock.timers.tick(250);
  assert.equal(events.filter(event => event.type === 'candle').length, 29);
  assert.equal(latestCandle(events).timeMs, startMs);

  const beforePause = { ...latestCandle(events) };
  connection.setPaused(true);
  const pausedCount = events.length;
  t.mock.timers.tick(15_000);
  assert.equal(events.length, pausedCount);
  connection.setPaused(false);
  assert.deepEqual(
    events.slice(pausedCount).map(event => event.type),
    ['candle', 'depth.snapshot'],
  );
  assert.deepEqual(latestCandle(events), beforePause);

  t.mock.timers.tick(250);
  assert.equal(latestCandle(events).timeMs, startMs + 300_000);
  assert.equal(latestCandle(events).open, beforePause.close);
  connection.requestSnapshot();
  connection.dispose();
  connection.dispose();
  const disposedCount = events.length;
  t.mock.timers.tick(15_000);
  assert.equal(events.length, disposedCount);
});

test('a dropped depth sequence leaves candles streaming and repeated recovery requests share one snapshot', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const events: FeedEvent[] = [];
  const book = new OrderBook();
  const feed = createSimulatedFeed(42);
  const connection = feed.connect(event => {
    events.push(event);
    if (event.type === 'depth.snapshot') book.snapshot(event.book);
    if (event.type === 'depth.delta') book.delta(event.book);
  });
  t.after(() => connection.dispose());
  t.mock.timers.tick(250);
  const lastValidSequence = book.inspect().sequence;
  const beforeGap = events.length;
  feed.injectGap();
  t.mock.timers.tick(250);
  assert.deepEqual(
    events.slice(beforeGap).map(event => event.type),
    ['candle'],
  );
  t.mock.timers.tick(250);
  assert.equal(book.inspect().status, 'stale');
  assert.equal(book.inspect().sequence, lastValidSequence);
  assert.equal(events.slice(beforeGap).filter(event => event.type === 'candle').length, 2);

  const snapshotsBefore = events.filter(event => event.type === 'depth.snapshot').length;
  connection.requestSnapshot();
  connection.requestSnapshot();
  for (let tick = 0; tick < 4; tick++) t.mock.timers.tick(250);
  assert.equal(events.filter(event => event.type === 'depth.snapshot').length, snapshotsBefore);
  assert.equal(book.inspect().status, 'stale');
  t.mock.timers.tick(100);
  assert.equal(events.filter(event => event.type === 'depth.snapshot').length, snapshotsBefore + 1);
  assert.equal(book.inspect().status, 'live');
  assert.ok(book.inspect().sequence > lastValidSequence);
  t.mock.timers.tick(150);
  assert.equal(book.inspect().status, 'live');
});
