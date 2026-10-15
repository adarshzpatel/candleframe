import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IndicatorRegistry, classifyTrend, tideline } from '../src/indicators.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000;
const bars = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    timeMs: i * MINUTE,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }));
/** Bars that open at the prior close, so each one's direction follows the move. */
const moving = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = closes[i - 1] ?? close;
    return {
      timeMs: i * MINUTE,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1,
    };
  });
const OUT = { candles: 8, pivotHigh: 9, pivotLow: 10, bullPullback: 11, bearPullback: 12 };
const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

test('a rise is bull, a fall bear, and a flat line neutral', () => {
  assert.equal(classifyTrend(bars(range(60, i => 100 + i))).at(-1), 'bull');
  assert.equal(classifyTrend(bars(range(60, i => 200 - i))).at(-1), 'bear');
  assert.equal(classifyTrend(bars(range(60, () => 100))).at(-1), 'neutral');
  assert.equal(classifyTrend(bars(range(60, i => 100 + i)))[5], null);
});

test('each bar has exactly one ribbon state, joined to the bar before a change', () => {
  const closes = [...range(60, i => 100 + i), ...range(60, i => 160 - 2 * i)];
  const outputs = tideline(8, 21, 50).calculateOutputs!(bars(closes), [], 0);
  assert.equal(outputs.length, 13);
  const states = classifyTrend(bars(closes));
  for (let i = 30; i < closes.length; i++) {
    const active = [0, 2, 4].filter(k => Number.isFinite(outputs[k][i]));
    const own = { bull: 0, bear: 2, neutral: 4 }[states[i]!];
    assert.ok(active.includes(own), `bar ${i}`);
    if (states[i + 1] === states[i] || i === closes.length - 1) assert.equal(active.length, 1, `bar ${i}`);
  }
});

test('the trend line is green above and orange below', () => {
  const closes = [...range(80, i => 100 + i), ...range(80, i => 180 - 3 * i)];
  const [above, below] = tideline(8, 21, 50).calculateOutputs!(bars(closes), [], 0).slice(6);
  assert.ok(Number.isFinite(above[70]) && !Number.isFinite(below[70]));
  assert.ok(Number.isFinite(below[159]) && !Number.isFinite(above[159]));
});

test('the registry builds it with defaults and rejects a fast period above slow', () => {
  const registry = new IndicatorRegistry();
  assert.equal(registry.create('tideline', {}, 't').name, 'Tideline 8 21 200');
  assert.throws(() => registry.create('tideline', { fast: 30, slow: 21 }, 't'));
});

test('candles take the trend color, muted against the trend, and keep the theme when neutral', () => {
  const rise = range(60, i => 100 + i + (i % 4 === 3 ? -1.5 : 0));
  const tones = tideline().calculateOutputs!(moving(rise), [], 0)[OUT.candles];
  assert.equal(tones[58], 0);
  assert.equal(tones[55], 1);
  const fall = range(60, i => 200 - i + (i % 4 === 3 ? 1.5 : 0));
  const down = tideline().calculateOutputs!(moving(fall), [], 0)[OUT.candles];
  assert.equal(down[58], 2);
  assert.equal(down[55], 3);
  const flat = tideline().calculateOutputs!(moving(range(60, () => 100)), [], 0)[OUT.candles];
  assert.ok(Number.isNaN(flat[59]));
  const off = tideline(8, 21, 200, 10, { candles: false }).calculateOutputs!(moving(rise), [], 0);
  assert.ok(off[OUT.candles].every(Number.isNaN));
});

test('swing dots sit beyond a peak and a trough, confirmed after the pivot bars', () => {
  const wave = range(80, i => 100 + 10 * Math.sin((i * Math.PI) / 20));
  const outputs = tideline().calculateOutputs!(moving(wave), [], 0);
  const highs = outputs[OUT.pivotHigh].flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
  const lows = outputs[OUT.pivotLow].flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
  assert.deepEqual(highs, [50]);
  assert.deepEqual(lows, [30, 70]);
  assert.ok(outputs[OUT.pivotHigh][50] > moving(wave)[50].high);
  const none = tideline(8, 21, 200, 10, { pivotBars: 0 }).calculateOutputs!(moving(wave), [], 0);
  assert.ok(none[OUT.pivotHigh].every(Number.isNaN));
});

test('a pullback dot marks the first bar of an uptrend that dips to the fast EMA', () => {
  const closes = [...range(50, i => 100 + 2 * i), 194, 193, 192, ...range(10, i => 196 + 2 * i)];
  const outputs = tideline().calculateOutputs!(moving(closes), [], 0);
  const dots = outputs[OUT.bullPullback].flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
  assert.ok(dots.length >= 1 && dots[0] >= 50 && dots[0] <= 52, `dots at ${dots}`);
  assert.ok(outputs[OUT.bearPullback].every(Number.isNaN));
});
