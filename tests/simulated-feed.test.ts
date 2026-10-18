import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { Candle, FeedEvent } from '../src/types.ts';

function latestCandle(events: readonly FeedEvent[]): Candle {
  const event = events.filter(event => event.type === 'candle').at(-1);
  assert.ok(event, 'Expected a streamed candle');
  return event.candle;
}

test('simulated intervals aggregate the same minute history', t => {
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
      const { buyVolume, footprint, deltaRange, ...ohlcv } = bar;
      // Order flow splits the same volume: buckets sum to it and buyers take part of it.
      const flow = footprint!.reduce((sum, [, buy, sell]) => sum + buy + sell, 0);
      assert.ok(Math.abs(flow - bar.volume) < 1e-6 * Math.max(1, bar.volume));
      assert.ok(buyVolume! > 0 && buyVolume! < bar.volume);
      assert.ok(deltaRange![0] <= 0 && deltaRange![1] >= 0);
      assert.ok(footprint!.every((level, i) => !i || level[0] > footprint![i - 1][0]));
      assert.deepEqual(ohlcv, {
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
    ['candle'],
  );
  assert.deepEqual(latestCandle(events), beforePause);

  t.mock.timers.tick(250);
  assert.equal(latestCandle(events).timeMs, startMs + 300_000);
  assert.equal(latestCandle(events).open, beforePause.close);
  connection.dispose();
  connection.dispose();
  const disposedCount = events.length;
  t.mock.timers.tick(15_000);
  assert.equal(events.length, disposedCount);
});

test('trade mode prints irregular, seeded trades in real time and keeps order flow consistent', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const run = () => {
    const events: FeedEvent[] = [];
    const connection = createSimulatedFeed({ seed: 9, interval: '1m', trades: true }).connect(event =>
      events.push(event),
    );
    t.after(() => connection.dispose());
    const history = events.find(event => event.type === 'candles.history')!;
    const startMs = history.candles.at(-1)!.timeMs;
    const perSecond: number[] = [];
    for (let second = 0; second < 90; second++) {
      const before = events.filter(event => event.type === 'candle').length;
      for (let step = 0; step < 20; step++) t.mock.timers.tick(50);
      perSecond.push(events.filter(event => event.type === 'candle').length - before);
    }
    connection.dispose();
    return { events, startMs, perSecond };
  };
  const first = run(),
    second = run();
  const candles = first.events.filter(event => event.type === 'candle').map(event => event.candle);
  assert.deepEqual(
    candles,
    second.events.filter(event => event.type === 'candle').map(event => event.candle),
    'the same seed prints the same tape',
  );
  // 90 real seconds at 1x cross exactly one 1m boundary after the history.
  assert.deepEqual([...new Set(candles.map(c => c.timeMs))], [first.startMs, first.startMs + 60_000]);
  assert.ok(new Set(first.perSecond).size > 3, `arrivals vary from second to second: ${first.perSecond}`);
  for (const bar of candles) {
    const flow = bar.footprint!.reduce((sum, [, buy, sell]) => sum + buy + sell, 0);
    assert.ok(Math.abs(flow - bar.volume) < 1e-6 * Math.max(1, bar.volume));
    assert.ok(bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close));
  }
  assert.throws(() => createSimulatedFeed({ trades: true, speed: 0 }), /speed/);
});
