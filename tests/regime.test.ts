import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IndicatorRegistry, classifyRegimes, regime, regimeBand } from '../src/indicators.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000;
/** Bars with the given closes and a high-low range of `spread` around each. */
const bars = (closes: number[], spread: number | ((i: number) => number)): Candle[] =>
  closes.map((close, i) => {
    const half = (typeof spread === 'number' ? spread : spread(i)) / 2;
    return { timeMs: i * MINUTE, open: close, high: close + half, low: close - half, close, volume: 1 };
  });
const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

test('a steady rise with normal volatility is long expansion, a steady fall short', () => {
  const up = classifyRegimes(
    bars(
      range(200, i => 100 + i),
      2,
    ),
  );
  assert.equal(up[19], null);
  assert.equal(up[199], 'long');
  const down = classifyRegimes(
    bars(
      range(200, i => 400 - i),
      2,
    ),
  );
  assert.equal(down[199], 'short');
});

test('a sideways chop with normal volatility is rotation', () => {
  const chop = classifyRegimes(
    bars(
      range(200, i => 100 + 5 * Math.sin(i / 2)),
      4,
    ),
  );
  assert.equal(chop[199], 'rotation');
});

test('ranges shrinking well below the slow average is compression', () => {
  const closes = range(200, i => 100 + (i < 150 ? 5 * Math.sin(i / 2) : 0.2 * Math.sin(i / 2)));
  const squeezed = classifyRegimes(bars(closes, i => (i < 150 ? 4 : 0.5)));
  assert.equal(squeezed[199], 'compression');
});

test('the plugin emits one column per regime with exactly one active per bar', () => {
  const plugin = regime();
  const outputs = plugin.calculateOutputs!(
    bars(
      range(200, i => 100 + i),
      2,
    ),
    [],
    0,
  );
  assert.equal(outputs.length, 4);
  assert.equal(outputs[2][199], 1);
  for (let i = 100; i < 200; i++) assert.equal(outputs.filter(values => values[i] === 1).length, 1);
  assert.throws(() => regime(20, 10));
});

test('the registry creates regime with defaults', () => {
  const plugin = new IndicatorRegistry().create('regime', {}, 'r');
  assert.deepEqual(plugin.inputs, { period: 20, slowPeriod: 100, entry: 65, hold: 35, squeeze: 80 });
});

test('a pause inside a trend keeps the trend', () => {
  const closes = range(200, i => 100 + i);
  closes[195] = closes[194];
  const regimes = classifyRegimes(bars(closes, 2));
  assert.ok(regimes.slice(150).every(r => r === 'long'));
});

test('a wide close beyond the range starts expansion on that bar', () => {
  const closes = range(200, i => 100 + 3 * Math.sin(i / 2));
  closes[199] = 120;
  const candles = bars(closes, i => (i === 199 ? 12 : 4));
  const regimes = classifyRegimes(candles);
  assert.equal(regimes[198], 'rotation');
  assert.equal(regimes[199], 'long');
});

test('every regime lasts at least two bars', () => {
  const closes = range(400, i => 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i * 1.7));
  const regimes = classifyRegimes(bars(closes, i => 2 + (i % 7)));
  for (let i = 2; i < regimes.length - 1; i++)
    if (regimes[i] !== regimes[i - 1] && regimes[i - 1] !== null) assert.equal(regimes[i + 1], regimes[i]);
});

test('the band edges follow the active regime and join at changes', () => {
  // Rise, then flat chop: long, then rotation.
  const closes = range(260, i => (i < 180 ? 100 + i : 280 + 5 * Math.sin(i / 2)));
  const regimes = classifyRegimes(bars(closes, 4));
  const outputs = regimeBand().calculateOutputs!(bars(closes, 4), [], 0);
  assert.equal(outputs.length, 9);
  const longUpper = outputs[5],
    rotationUpper = outputs[3];
  const change = regimes.findIndex((r, i) => i > 150 && r === 'rotation');
  assert.ok(change > 0);
  assert.ok(Number.isFinite(longUpper[change - 1]) && Number.isNaN(longUpper[change + 1]));
  assert.ok(Number.isFinite(rotationUpper[change - 1]) && Number.isFinite(rotationUpper[change]));
  assert.ok(outputs[0][change] < longUpper[change - 1]);
});
