import assert from 'node:assert/strict';
import { test } from 'node:test';
import { niceStep, priceTicks, timeTicks, valueTicks, zoneOffsets, TICK_RANK } from '../src/axis-ticks.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { createTimeScale } from '../src/time-scale.ts';
import { createTimeFormats } from '../src/time-format.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR;
const label = (v: number) => v.toFixed(2);

test('nice steps are 1, 2, 2.5 or 5 times a power of ten', () => {
  assert.equal(niceStep(1000, 5), 200);
  assert.equal(niceStep(0.9, 10), 0.1);
  assert.equal(niceStep(23, 10), 2.5);
  assert.equal(niceStep(70, 10), 10);
  assert.equal(niceStep(0.003, 6), 0.0005);
});

test('price ticks sit on round values and move with the range', () => {
  const at = (minPrice: number, maxPrice: number) =>
    priceTicks(geometryForRanges({ fromMs: 0, toMs: HOUR, minPrice, maxPrice }, 800, 600), label);
  const ticks = at(67_213, 68_091);
  assert.ok(ticks.length >= 5);
  assert.ok(
    ticks.every(t => t.value % 100 === 0),
    ticks.map(t => t.value).join(),
  );
  // Shifting the range moves the same values instead of relabelling fixed rows.
  const shifted = at(67_263, 68_141);
  const common = ticks.find(t => shifted.some(s => s.value === t.value))!;
  const moved = shifted.find(s => s.value === common.value)!;
  assert.ok(moved.position > common.position, 'a higher range moves a price lower on screen');
  assert.ok(
    valueTicks(0.1, 0.4, 600, v => v, String).every(t => !String(t.value).includes('0000')),
    'no floating-point noise',
  );
});

test('wide log ranges use 1, 2 and 5 per decade', () => {
  const g = geometryForRanges(
    { fromMs: 0, toMs: HOUR, minPrice: 3, maxPrice: 4000 },
    800,
    600,
    undefined,
    undefined,
    {
      log: true,
    },
  );
  const values = priceTicks(g, label).map(t => t.value);
  assert.ok(
    values.every(v => /^[125]0*$/.test(String(v))),
    values.join(),
  );
  assert.ok(values.includes(10) && values.includes(1000));
});

const minutes = (count: number, start = Date.UTC(2026, 9, 9, 22)): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    timeMs: start + i * MINUTE,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));

function ticksFor(candles: Candle[], intervalMs: number, timeZone = 'UTC', gaps = false, width = 1200) {
  const scale = createTimeScale(candles, intervalMs, gaps);
  const fromMs = candles[0].timeMs,
    toMs = scale.time(scale.logical(candles.at(-1)!.timeMs) + 1);
  const g = geometryForRanges({ fromMs, toMs, minPrice: 0.5, maxPrice: 1.5 }, width, 600, undefined, scale);
  const formats = createTimeFormats(intervalMs, timeZone);
  return timeTicks(g, {
    candles,
    intervalMs,
    offset: zoneOffsets(timeZone),
    label: (time, rank) => formats.tick(time, rank),
    spacing: 60,
  });
}

test('intraday ticks land on round clock times, and midnight shows the date', () => {
  const ticks = ticksFor(minutes(240), MINUTE);
  assert.ok(ticks.length >= 6);
  for (const tick of ticks) assert.equal(new Date(tick.value).getUTCMinutes() % 15, 0, tick.label);
  const midnight = ticks.find(t => t.value === Date.UTC(2026, 9, 10))!;
  assert.equal(midnight.rank, TICK_RANK.day);
  assert.equal(midnight.label, '10');
  assert.ok(ticks.some(t => t.label === '23:00'));
});

test('ticks follow the label time zone', () => {
  const ticks = ticksFor(minutes(240, Date.UTC(2026, 9, 10, 2)), MINUTE, 'America/New_York');
  const midnight = ticks.find(t => t.rank === TICK_RANK.day)!;
  // Midnight in New York (EDT, UTC-4) is 04:00 UTC.
  assert.equal(midnight.value, Date.UTC(2026, 9, 10, 4));
});

test('daily bars with weekend gaps tick on trading days and mark months and years', () => {
  const bars: Candle[] = [];
  for (let t = Date.UTC(2025, 9, 1); bars.length < 320; t += DAY) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) bars.push({ timeMs: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  }
  const ticks = ticksFor(bars, DAY, 'UTC', true);
  const traded = new Set(bars.map(b => b.timeMs));
  assert.ok(ticks.filter(t => t.value <= bars.at(-1)!.timeMs).every(t => traded.has(t.value)));
  assert.ok(ticks.some(t => t.label === '2026' && t.rank === TICK_RANK.year));
  assert.ok(ticks.some(t => t.rank === TICK_RANK.month));
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].position - ticks[i - 1].position >= 60);
});
