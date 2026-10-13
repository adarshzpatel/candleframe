import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignTime, intervalToMs, isInterval } from '../src/intervals.ts';
import { createTimeScale } from '../src/time-scale.ts';
import { createTimeFormats } from '../src/time-format.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import { createBinanceFeed } from '../src/binance-feed.ts';
import type { Candle, FeedAdapter, FeedEvent, Interval } from '../src/types.ts';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR;

test('intervals parse counts and units, and reject calendar months', () => {
  assert.equal(intervalToMs('1s'), 1000);
  assert.equal(intervalToMs('4h'), 4 * HOUR);
  assert.equal(intervalToMs('1d'), DAY);
  assert.equal(intervalToMs('2w'), 14 * DAY);
  for (const bad of ['1M', '0m', '1y', 'm', '1.5h', 5, null])
    assert.equal(isInterval(bad), false, String(bad));
  assert.throws(() => intervalToMs('1M'), { code: 'UNSUPPORTED_INTERVAL', path: 'interval' });
});

test('weekly candles align to Monday 00:00 UTC; shorter ones to the epoch', () => {
  const friday = Date.UTC(2026, 9, 9, 15);
  assert.equal(alignTime(friday, 7 * DAY), Date.UTC(2026, 9, 5));
  assert.equal(new Date(alignTime(friday, 7 * DAY)).getUTCDay(), 1);
  assert.equal(alignTime(friday, DAY), Date.UTC(2026, 9, 9));
  assert.equal(alignTime(friday + 17 * MINUTE, 5 * MINUTE), friday + 15 * MINUTE);
});

/** Weekday daily bars: Monday to Friday, skipping weekends. */
function weekdays(count: number, start = Date.UTC(2026, 0, 5)): Candle[] {
  const bars: Candle[] = [];
  for (let t = start; bars.length < count; t += DAY) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    const close = 100 + bars.length;
    bars.push({ timeMs: t, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 10 });
  }
  return bars;
}

test('a gapped time scale gives each bar one slot and collapses weekends', () => {
  const bars = weekdays(10);
  const scale = createTimeScale(bars, DAY, true);
  assert.equal(scale.linear, false);
  bars.forEach((bar, i) => assert.equal(scale.logical(bar.timeMs), i));
  // Friday is bar 4, Monday is bar 5. Saturday and Sunday map to the Monday slot.
  assert.equal(scale.logical(bars[4].timeMs + DAY), 5);
  assert.equal(scale.logical(bars[4].timeMs + 2 * DAY), 5);
  assert.equal(scale.logical(bars[4].timeMs + DAY / 2), 4.5);
  assert.equal(scale.time(4.5), bars[4].timeMs + DAY / 2);
  assert.equal(scale.time(-2), bars[0].timeMs - 2 * DAY);
  assert.equal(scale.time(12), bars[9].timeMs + 3 * DAY);
  assert.equal(scale.bars(bars[0].timeMs, bars[9].timeMs), 9);
  const continuous = createTimeScale(bars, DAY, false);
  assert.equal(continuous.linear, true);
  assert.equal(continuous.bars(bars[0].timeMs, bars[9].timeMs), 11, 'two weekends add two empty days');
});

function gappedFeed(history: Candle[]) {
  let emit!: (event: FeedEvent) => void;
  const feed: FeedAdapter = {
    descriptor: {
      id: 'stocks',
      label: 'Stocks',
      instrument: {
        symbol: 'DEMO',
        name: 'Demo Corp',
        base: 'DEMO',
        quote: 'USD',
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 0,
      },
      interval: '1d',
      intervalMs: DAY,
      simulated: false,
      gaps: true,
      depth: { kind: 'none', levels: 0 },
    },
    connect(callback) {
      emit = callback;
      callback({ type: 'candles.history', candles: history });
      return { setPaused() {}, requestSnapshot() {}, dispose() {} };
    },
  };
  return { feed, emit: (event: FeedEvent) => emit(event) };
}

test('gapped feeds accept weekend-skipping history and live bars after a gap', () => {
  const bars = weekdays(200);
  const { feed, emit } = gappedFeed(bars);
  const runtime = new ChartRuntime(feed);
  runtime.start();
  const state = runtime.inspect();
  assert.equal(state.streams.candles.status, 'live');
  assert.equal(state.candleCount, 200);
  const scale = runtime.timeScale();
  const { fromMs, toMs } = state.document.viewport;
  assert.ok(Math.abs(scale.bars(fromMs, toMs) - 180) < 1e-9, 'the default view is 180 bars wide');
  // Friday's bar is followed by Monday's.
  const last = bars.at(-1)!;
  const next = weekdays(1, last.timeMs + DAY)[0];
  assert.ok(next.timeMs - last.timeMs >= DAY);
  emit({ type: 'candle', candle: { ...next, timeMs: next.timeMs } });
  const after = runtime.inspect();
  assert.equal(after.streams.candles.status, 'live');
  assert.equal(after.candleCount, 201);
  const view = after.document.viewport;
  assert.ok(
    Math.abs(runtime.timeScale().bars(view.fromMs, view.toMs) - 180) < 1e-9,
    'following keeps 180 bars',
  );
  runtime.dispose();
});

test('gapped viewports are limited in bars, not milliseconds', () => {
  const bars = weekdays(400);
  const { feed } = gappedFeed(bars);
  const runtime = new ChartRuntime(feed);
  runtime.start();
  // 300 weekday bars span about 420 calendar days. That is valid as 300 bars.
  runtime.execute({ type: 'viewport.set', fromMs: bars[50].timeMs, toMs: bars[350].timeMs });
  assert.throws(
    () => runtime.execute({ type: 'viewport.set', fromMs: bars[0].timeMs, toMs: bars[1].timeMs }),
    { code: 'INVALID_VIEWPORT' },
  );
  runtime.dispose();
});

test('continuous feeds still reject a live bar that skips intervals', () => {
  const bars = weekdays(30);
  const { feed, emit } = gappedFeed(bars);
  const runtime = new ChartRuntime({ ...feed, descriptor: { ...feed.descriptor, gaps: false } });
  runtime.start();
  assert.equal(runtime.inspect().streams.candles.status, 'live');
  const monday = weekdays(1, bars.at(-1)!.timeMs + 3 * DAY)[0];
  emit({ type: 'candle', candle: monday });
  const state = runtime.inspect();
  assert.equal(state.streams.candles.status, 'error');
  assert.match(state.streams.candles.message ?? '', /CANDLE_GAP/);
  runtime.dispose();
});

test('simulated and Binance feeds accept the wider interval set', () => {
  for (const interval of ['4h', '1d', '1w'] as Interval[]) {
    let history: readonly Candle[] = [];
    const feed = createSimulatedFeed({ interval });
    const connection = feed.connect(event => {
      if (event.type === 'candles.history') history = event.candles;
    });
    connection.dispose();
    const ms = intervalToMs(interval);
    assert.ok(history.length >= 300, `${interval} has ${history.length} bars`);
    assert.ok(history.every(bar => alignTime(bar.timeMs, ms) === bar.timeMs));
    const runtime = new ChartRuntime(feed);
    runtime.start();
    runtime.execute({ type: 'feed.pause', paused: true });
    assert.equal(runtime.inspect().streams.candles.status, 'paused');
    assert.ok(runtime.inspect().candleCount >= 300);
    runtime.dispose();
  }
  assert.equal(createBinanceFeed({ interval: '4h' }).descriptor.intervalMs, 4 * HOUR);
  assert.throws(() => createBinanceFeed({ interval: '7m' }), { code: 'UNSUPPORTED_MARKET' });
});

test('time labels drop the clock for daily bars and honor the time zone', () => {
  const t = Date.UTC(2026, 9, 9, 14, 30);
  assert.equal(createTimeFormats(MINUTE).axis(t, HOUR), '14:30');
  assert.equal(createTimeFormats(MINUTE, 'America/New_York').axis(t, HOUR), '10:30');
  assert.equal(createTimeFormats(DAY).axis(t, 30 * DAY), '9 Oct');
  assert.equal(createTimeFormats(DAY).axis(t, 400 * DAY), 'Oct 2026');
  assert.ok(!createTimeFormats(DAY).full(t).includes('14:30'));
  assert.equal(createTimeFormats(MINUTE).zone, 'UTC');
  assert.throws(() => createTimeFormats(MINUTE, 'Mars/Olympus'), { code: 'INVALID_TIME_ZONE' });
});

test('tick and range intervals parse alongside time intervals', async () => {
  const { parseInterval, isTimeInterval, intervalLabel, TRADE_BAR_SLOT_MS } =
    await import('../src/intervals.ts');
  assert.deepEqual(parseInterval('500t'), { kind: 'tick', count: 500 });
  assert.deepEqual(parseInterval('10r'), { kind: 'range', ticks: 10 });
  assert.deepEqual(parseInterval('5m'), { kind: 'time', ms: 5 * MINUTE });
  assert.equal(intervalToMs('500t'), TRADE_BAR_SLOT_MS);
  assert.ok(isInterval('2000t') && isInterval('8r'));
  assert.ok(!isTimeInterval('500t') && isTimeInterval('1h'));
  for (const bad of ['0t', '1234567t', '10R', 't', '5x']) assert.ok(!isInterval(bad), bad);
  assert.equal(intervalLabel('500t'), '500 ticks');
  assert.equal(intervalLabel('10r'), '10 range');
  assert.equal(intervalLabel('15m'), '15m');
});

function tradeBarFeed(interval: Interval, history: Candle[], gaps = true) {
  let emit!: (event: FeedEvent) => void;
  const feed: FeedAdapter = {
    descriptor: {
      ...gappedFeed([]).feed.descriptor,
      id: 'trades',
      interval,
      intervalMs: intervalToMs(interval),
      gaps,
    },
    connect(callback) {
      emit = callback;
      callback({ type: 'candles.history', candles: history });
      return { setPaused() {}, requestSnapshot() {}, dispose() {} };
    },
  };
  return { feed, emit: (event: FeedEvent) => emit(event) };
}

test('tick bars a millisecond apart load and update on a gapped axis', () => {
  const t0 = Date.UTC(2026, 9, 13, 14, 30);
  // Busy then quiet: bars 1 ms apart, then seconds apart.
  const times = [0, 1, 2, 3, 900, 4_000, 4_001, 12_000].map(d => t0 + d);
  const bars = times.map((timeMs, i) => ({
    timeMs,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10,
  }));
  const { feed, emit } = tradeBarFeed('500t', bars);
  const runtime = new ChartRuntime(feed);
  runtime.start();
  assert.equal(runtime.inspect().candleCount, bars.length);
  const scale = runtime.timeScale();
  assert.equal(scale.logical(times[3]), 3);
  assert.equal(scale.logical(times[7]), 7);
  const next = { timeMs: times[7] + 1, open: 120, high: 120, low: 120, close: 120, volume: 1 };
  emit({ type: 'candle', candle: next });
  emit({ type: 'candle', candle: { ...next, high: 121, close: 121, volume: 2 } });
  const state = runtime.inspect();
  assert.equal(state.candleCount, bars.length + 1);
  assert.equal(state.streams.candles.status, 'live');
  runtime.dispose();
});

test('tick and range feeds must declare gaps', () => {
  const { feed } = tradeBarFeed('10r', [], false);
  assert.throws(() => new ChartRuntime(feed), { code: 'INVALID_FEED' });
});

test('momentum range intervals parse and label', async () => {
  const { parseInterval, intervalLabel } = await import('../src/intervals.ts');
  assert.deepEqual(parseInterval('10mr'), { kind: 'momentum', ticks: 10 });
  assert.equal(intervalLabel('10mr'), '10 momentum');
  assert.equal(intervalToMs('10mr'), 1);
});
