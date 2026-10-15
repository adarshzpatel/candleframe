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
  assert.equal(outputs.length, 8);
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
