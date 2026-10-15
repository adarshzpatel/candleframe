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
const OUT = {
  candles: 8,
  pivotHigh: 9,
  pivotLow: 10,
  bullPullback: 11,
  bearPullback: 12,
  entry: 13,
  stop: 14,
  target: 15,
};
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
  assert.equal(outputs.length, 16);
  const states = classifyTrend(bars(closes), 8, 21, 0.1, 0.3, 3);
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

const finite = (values: number[]) => values.flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
/** A steady climb, a three-bar dip to the fast EMA, then the climb again. */
const dip = [...range(120, i => 100 + 2 * i), 334, 333, 332, ...range(20, i => 336 + 2 * i)];

test('a pullback dot marks the first bar of an uptrend that dips to the fast EMA', () => {
  const outputs = tideline(8, 21, 50).calculateOutputs!(moving(dip), [], 0);
  const dots = finite(outputs[OUT.bullPullback]);
  assert.ok(dots.length >= 1 && dots[0] >= 120 && dots[0] <= 122, `dots at ${dots}`);
  assert.ok(outputs[OUT.bearPullback].every(Number.isNaN));
});

test('the trend entry gap and hold bars cut ribbon flips in chop', () => {
  const wave = bars(range(300, i => 100 + 3 * Math.sin(i / 3) + 2 * Math.sin(i / 7)));
  const flips = (states: (string | null)[]) => states.filter((s, i) => i > 0 && s !== states[i - 1]).length;
  const plain = classifyTrend(wave, 8, 21, 0.1),
    held = classifyTrend(wave, 8, 21, 0.1, 0.3, 3);
  assert.ok(flips(held) < flips(plain), `${flips(held)} vs ${flips(plain)}`);
  let run = 0;
  for (let i = 1; i < held.length; i++) {
    if (held[i] !== held[i - 1] && held[i - 1] !== null) assert.ok(run >= 3, `bar ${i}`);
    run = held[i] === held[i - 1] ? run + 1 : 1;
  }
});

test('pullbacks only fire with the trend EMA, and the regime gate only removes them', () => {
  const wave = moving(range(600, i => 100 + i / 4 + 8 * Math.sin(i / 9)));
  const closes = wave.map(c => c.close);
  const open = tideline(8, 21, 50, 10, { regime: false }).calculateOutputs!(wave, [], 0);
  const gated = tideline(8, 21, 50).calculateOutputs!(wave, [], 0);
  const bulls = finite(open[OUT.bullPullback]);
  assert.ok(bulls.length > 0);
  const trend = open[6].map((v, i) => (Number.isFinite(v) ? v : open[7][i]));
  for (const i of bulls) assert.ok(closes[i] > trend[i], `bar ${i} closes under the trend EMA`);
  assert.ok(finite(open[OUT.bearPullback]).length === 0, 'no bear dots in a rising market');
  for (const i of finite(gated[OUT.bullPullback])) assert.ok(bulls.includes(i), `gated dot ${i}`);
});

test('a pullback projects entry, stop and a 2R target until one is hit', () => {
  const candles = moving(dip);
  const outputs = tideline(8, 21, 50).calculateOutputs!(candles, [], 0);
  const signal = finite(outputs[OUT.bullPullback])[0];
  const span = finite(outputs[OUT.entry]);
  assert.equal(span[0], signal - 1);
  const entry = outputs[OUT.entry][signal],
    stop = outputs[OUT.stop][signal],
    target = outputs[OUT.target][signal];
  assert.equal(entry, candles[signal].high);
  assert.ok(stop < candles[signal].low);
  assert.ok(Math.abs(target - entry - 2 * (entry - stop)) < 1e-9);
  const end = span.at(-1)!;
  assert.ok(candles[end].high >= target || candles[end].low <= stop || end === candles.length - 1);
  for (let k = signal + 1; k < end; k++)
    assert.ok(candles[k].high < target && candles[k].low > stop, `bar ${k}`);
  const off = tideline(8, 21, 50, 10, { targets: false }).calculateOutputs!(candles, [], 0);
  assert.ok(off[OUT.entry].every(Number.isNaN));
});

test('a stop entry that never triggers drops the projection', () => {
  // After the dip the market drifts down without retaking the signal bar's high.
  const candles = moving([...range(120, i => 100 + 2 * i), 334, 333, 332, ...range(20, i => 331 - 0.2 * i)]);
  const outputs = tideline(8, 21, 50).calculateOutputs!(candles, [], 0);
  assert.ok(finite(outputs[OUT.bullPullback]).length >= 1);
  assert.ok(outputs[OUT.entry].every(Number.isNaN));
});
