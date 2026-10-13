import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChartGroup } from '../src/chart-group.ts';
import type { GroupChart } from '../src/chart-group.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import type { Candle, Interval } from '../src/types.ts';

const MINUTE = 60_000;
const series = (count: number, stepMs: number): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    timeMs: i * stepMs,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }));

/** A runtime with the crosshair half of ChartApi recorded instead of drawn. */
function linkedChart(interval: Interval, stepMs: number, count = 3000) {
  const feed = createStaticFeed({ candles: series(count, stepMs), interval, instrument: 'T' });
  const runtime = new ChartRuntime(feed);
  runtime.start();
  const listeners = new Set<(timeMs: number | null) => void>();
  const shown: (number | null)[] = [];
  const chart: GroupChart = {
    subscribe: listener => runtime.subscribe(listener),
    execute: (command, revision, options) => runtime.execute(command, revision, options),
    setCrosshair: timeMs => void shown.push(timeMs),
    subscribeCrosshair: listener => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const hover = (timeMs: number | null) => listeners.forEach(listener => listener(timeMs));
  return { runtime, feed, chart, shown, hover, viewport: () => runtime.inspect().document.viewport };
}

test('time sync aligns the right edge and keeps each chart zoom without undo steps', () => {
  const a = linkedChart('1m', MINUTE),
    b = linkedChart('1m', MINUTE);
  b.runtime.execute({ type: 'viewport.set', fromMs: 2000 * MINUTE, toMs: 2060 * MINUTE });
  const group = createChartGroup([a.chart, b.chart], { time: true });
  a.runtime.execute({ type: 'viewport.set', fromMs: 1000 * MINUTE, toMs: 1200 * MINUTE });
  assert.equal(b.viewport().toMs, 1200 * MINUTE);
  assert.equal(b.viewport().toMs - b.viewport().fromMs, 60 * MINUTE);
  assert.equal(b.runtime.inspect().history.canUndo, false);
  group.dispose();
  a.runtime.execute({ type: 'viewport.set', fromMs: 500 * MINUTE, toMs: 700 * MINUTE });
  assert.equal(b.viewport().toMs, 1200 * MINUTE);
});

test('date range sync copies the range and clamps it to the bar limits of each interval', () => {
  const minute = linkedChart('1m', MINUTE),
    hour = linkedChart('1h', 60 * MINUTE);
  createChartGroup([minute.chart, hour.chart], { dateRange: true });
  minute.runtime.execute({ type: 'viewport.set', fromMs: 1000 * MINUTE, toMs: 1120 * MINUTE });
  // 120 minutes is 2 hourly bars, below the 3-bar minimum.
  assert.equal(hour.viewport().toMs, 1120 * MINUTE);
  assert.equal(hour.viewport().toMs - hour.viewport().fromMs, 3 * 60 * MINUTE);
  hour.runtime.execute({ type: 'viewport.set', fromMs: 100 * 60 * MINUTE, toMs: 2000 * 60 * MINUTE });
  // 1,900 hours is 114,000 minute bars; the minute chart keeps the 2,200-bar maximum.
  assert.equal(minute.viewport().toMs, 2000 * 60 * MINUTE);
  assert.equal(minute.viewport().toMs - minute.viewport().fromMs, 2200 * MINUTE);
});

test('following live links as a mode', () => {
  const a = linkedChart('1m', MINUTE),
    b = linkedChart('1m', MINUTE);
  createChartGroup([a.chart, b.chart]);
  a.runtime.execute({ type: 'viewport.set', fromMs: 1000 * MINUTE, toMs: 1200 * MINUTE });
  assert.equal(b.viewport().following, false);
  b.runtime.execute({ type: 'viewport.reset' });
  assert.equal(a.viewport().following, true);
});

test('a live bar scrolling a following chart does not move a panned one', () => {
  const panned = linkedChart('1m', MINUTE),
    live = linkedChart('1m', MINUTE);
  panned.runtime.execute({ type: 'viewport.set', fromMs: 900 * MINUTE, toMs: 1100 * MINUTE });
  createChartGroup([panned.chart, live.chart]);
  const before = live.viewport();
  live.feed.update({ ...series(1, MINUTE)[0], timeMs: 3000 * MINUTE });
  assert.ok(live.viewport().toMs > before.toMs);
  assert.equal(live.viewport().following, true);
  assert.deepEqual(panned.viewport(), { fromMs: 900 * MINUTE, toMs: 1100 * MINUTE, following: false });
});

test('crosshair sync mirrors hover to the other charts and stops when disabled', () => {
  const a = linkedChart('1m', MINUTE),
    b = linkedChart('5m', 5 * MINUTE),
    c = linkedChart('1h', 60 * MINUTE);
  const group = createChartGroup([a.chart, b.chart, c.chart]);
  a.hover(42 * MINUTE);
  a.hover(null);
  assert.deepEqual(b.shown, [42 * MINUTE, null]);
  assert.deepEqual(c.shown, [42 * MINUTE, null]);
  assert.deepEqual(a.shown, []);
  group.setSync({ crosshair: false });
  a.hover(43 * MINUTE);
  assert.equal(b.shown.at(-1), null);
  group.remove(c.chart);
  group.setSync({ crosshair: true });
  a.hover(44 * MINUTE);
  assert.equal(b.shown.at(-1), 44 * MINUTE);
  assert.notEqual(c.shown.at(-1), 44 * MINUTE);
});

test('align pushes one chart position to the others on demand', () => {
  const a = linkedChart('1m', MINUTE),
    b = linkedChart('1m', MINUTE);
  a.runtime.execute({ type: 'viewport.set', fromMs: 300 * MINUTE, toMs: 400 * MINUTE });
  const group = createChartGroup([a.chart, b.chart], { time: false });
  assert.equal(b.viewport().following, true);
  group.align(a.chart);
  assert.equal(b.viewport().following, true);
  group.setSync({ time: true });
  group.align(a.chart);
  assert.equal(b.viewport().toMs, 400 * MINUTE);
});
