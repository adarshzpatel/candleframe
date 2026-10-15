import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cvd, priceDelta, volumeProfile, IndicatorRegistry } from '../src/indicators.ts';
import { buildProfile, currentSession, profileStep, sessionRanges } from '../src/profiles.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { Candle } from '../src/types.ts';

const bar = (timeMs: number, low: number, high: number, volume: number, buyVolume?: number): Candle => ({
  timeMs,
  open: low,
  high,
  low,
  close: high,
  volume,
  ...(buyVolume === undefined ? {} : { buyVolume }),
});

test('profile steps snap to 1, 2, 2.5 and 5 times a power of ten', () => {
  assert.equal(profileStep(0.7), 1);
  assert.equal(profileStep(1.3), 2);
  assert.equal(profileStep(2.2), 2.5);
  assert.equal(profileStep(31), 50);
  assert.equal(profileStep(0.004), 0.005);
});

test('bars without a footprint spread volume evenly over their range, split by buy volume', () => {
  const profile = buildProfile([bar(0, 100, 110, 10, 7)], 0, 1, 2);
  const total = profile.rows.reduce((sum, row) => sum + row.buy + row.sell, 0);
  assert.ok(Math.abs(total - 10) < 1e-9);
  assert.ok(Math.abs(profile.buy - 7) < 1e-9);
  assert.equal(profile.rows[0].low, 100);
  assert.ok(
    profile.rows.every(row => row.low % 2 === 0),
    'rows sit on multiples of the step',
  );
});

test('footprints land in their buckets; the POC and value area cover the heaviest rows', () => {
  const candle: Candle = {
    ...bar(0, 100, 104, 20),
    footprint: [
      [100, 1, 1],
      [101, 2, 1],
      [102, 6, 4],
      [103, 1, 3],
    ],
  };
  const profile = buildProfile([candle], 0, 1, 1, 0.7);
  assert.equal(profile.rows[profile.poc].low, 102);
  assert.equal(profile.maxVolume, 10);
  // 10 of 20 is short of 70%; the heavier neighbour (103, volume 4) joins first.
  assert.deepEqual(profile.valueArea, { low: 2, high: 3 });
  assert.equal(profile.maxDelta, 2);
});

test('an empty range returns no rows and no point of control', () => {
  const profile = buildProfile([bar(0, 100, 110, 10)], 1, 1, 1);
  assert.equal(profile.poc, -1);
  assert.equal(profile.valueArea, null);
});

test('CVD candles open at the running total, close after the bar delta and wick to its swing', () => {
  const plugin = cvd();
  const bars = [
    { ...bar(0, 1, 2, 10, 7), deltaRange: [-1, 6] as const },
    bar(60_000, 1, 2, 4, 1),
    bar(120_000, 1, 2, 6, 3),
  ];
  const [open, high, low, close] = plugin.calculateOutputs!(bars, [], 0);
  assert.deepEqual(open, [0, 4, 2]);
  assert.deepEqual(close, [4, 2, 2]);
  assert.deepEqual(high, [6, 4, 2], 'without a swing the wick ends at the body');
  assert.deepEqual(low, [-1, 2, 2]);
  const updated = plugin.calculateOutputs!(
    [...bars.slice(0, 2), bar(120_000, 1, 2, 8, 8)],
    [open, high, low, close],
    2,
  );
  assert.deepEqual(updated[3], [4, 2, 10]);
  assert.ok(plugin.calculateOutputs!([bar(0, 1, 2, 10)], [], 0)[3].every(Number.isNaN));
});

test('profile indicators validate inputs and register as price-axis kinds', () => {
  assert.throws(() => volumeProfile(1), /row height/);
  assert.throws(() => priceDelta(6, 0.9), /width/);
  const registry = new IndicatorRegistry();
  assert.equal(registry.get('vp')?.pane, 'profile');
  assert.equal(registry.get('price-delta')?.pane, 'profile');
  assert.equal(registry.get('cvd')?.pane, 'separate');
  assert.deepEqual(registry.create('vp', {}, 'vp-1').profile, {
    volume: true,
    delta: true,
    rowHeight: 5,
    width: 0.2,
    valueArea: 0.7,
    range: 'visible',
    sessions: 0,
  });
  // Range options: 0 current session, 1 today, 2 visible.
  const today = registry.create('vp', { range: 1, sessions: 1, delta: 0 }, 'vp-2');
  assert.equal(today.name, "Today's volume profile");
  assert.deepEqual(
    [today.profile?.range, today.profile?.sessions, today.profile?.delta],
    ['today', 10, false],
  );
  assert.equal(registry.create('vp', { range: 0 }, 'vp-3').profile?.range, 'session');
  assert.equal(registry.create('vp', {}, 'vp-4').inputs?.range, 2);
  assert.throws(() => registry.inputs('vp', { range: 3 }), /range must be/);
  // Price delta is merged into the volume profile: old layouts load, the add list skips it.
  assert.equal(registry.get('price-delta')?.hidden, true);
  assert.deepEqual(registry.create('price-delta', {}, 'pd').profile, {
    volume: false,
    delta: true,
    rowHeight: 5,
    width: 0.1,
  });
});

test('session ranges split bars by calendar day in the chart time zone', () => {
  const hour = 3_600_000;
  // Hourly bars from 2026-01-01 00:00 UTC over three days.
  const candles = Array.from({ length: 72 }, (_, i) => bar(Date.UTC(2026, 0, 1) + i * hour, 1, 2, 1));
  assert.deepEqual(sessionRanges(candles, 10), [
    { start: 0, end: 24 },
    { start: 24, end: 48 },
    { start: 48, end: 72 },
  ]);
  assert.deepEqual(sessionRanges(candles, 2), [
    { start: 24, end: 48 },
    { start: 48, end: 72 },
  ]);
  // New York is five hours behind UTC in January, so its days start at 05:00 UTC.
  assert.deepEqual(sessionRanges(candles, 1, 'America/New_York'), [{ start: 53, end: 72 }]);
});

test('the current session starts after the last trading gap, or at midnight UTC without one', () => {
  const hour = 3_600_000;
  const day0 = Date.UTC(2026, 0, 1);
  const continuous = Array.from({ length: 30 }, (_, i) => bar(day0 + i * hour, 1, 2, 1));
  assert.deepEqual(currentSession(continuous, hour), { start: 24, end: 30 });
  // 09:00 to 16:00 on two days: the session is the second day's bars.
  const gapped = [0, 1].flatMap(d =>
    Array.from({ length: 7 }, (_, i) => bar(day0 + d * 24 * hour + (9 + i) * hour, 1, 2, 1)),
  );
  assert.deepEqual(currentSession(gapped, hour), { start: 7, end: 14 });
  assert.equal(currentSession([], hour), null);
});

test('the runtime publishes profile indicators without series and CVD from simulated flow', t => {
  const runtime = new ChartRuntime(createSimulatedFeed({ seed: 7 }));
  t.after(() => runtime.dispose());
  runtime.start();
  runtime.execute({ type: 'feed.pause', paused: true });
  runtime.execute([
    { type: 'indicator.add', indicator: { kind: 'vp' } },
    { type: 'indicator.add', indicator: { kind: 'price-delta' } },
    { type: 'indicator.add', indicator: { kind: 'cvd' } },
  ]);
  const state = runtime.state();
  assert.deepEqual(
    state.indicators.map(i => [i.plugin.kind, i.series.length]),
    [
      ['vp', 0],
      ['price-delta', 0],
      ['cvd', 4],
    ],
  );
  assert.ok(Number.isFinite(state.indicators[2].series[3].at(-1)));
  assert.ok(state.candles.every(c => !c.volume || c.deltaRange![0] <= 0));
  assert.ok(state.candles.every(c => !c.volume || (c.footprint?.length && c.buyVolume! <= c.volume)));
});
