import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IndicatorRegistry, bollinger, ema, macd, rsi, sma } from '../src/indicators.ts';
import { ChartRuntime, parseDocument } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { createGeometry, geometryForRanges } from '../src/geometry.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000;
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    timeMs: i * MINUTE,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }));
const wave = (n: number) =>
  Array.from({ length: n }, (_, i) => Number((100 + 10 * Math.sin(i / 7)).toFixed(2)));
const close = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

test('EMA seeds with the SMA and updates incrementally like a full recalculation', () => {
  const bars = candles(wave(80));
  const plugin = ema(10);
  const full = plugin.calculate(bars, [], 0);
  assert.ok(Number.isNaN(full[8]));
  assert.ok(close(full[9], bars.slice(0, 10).reduce((s, b) => s + b.close, 0) / 10));
  const alpha = 2 / 11;
  assert.ok(close(full[10], alpha * bars[10].close + (1 - alpha) * full[9]));
  bars[79] = { ...bars[79], close: 150, high: 151 };
  const incremental = plugin.calculate(bars, full, 79);
  assert.deepEqual(incremental, ema(10).calculate(bars, [], 0));
});

test('RSI is 100 on a steady rise, 0 on a steady fall and bounded otherwise', () => {
  const rising = rsi(14).calculate(candles(Array.from({ length: 40 }, (_, i) => 100 + i)), [], 0);
  assert.ok(Number.isNaN(rising[13]));
  assert.equal(rising[14], 100);
  const falling = rsi(14).calculate(candles(Array.from({ length: 40 }, (_, i) => 200 - i)), [], 0);
  assert.equal(falling.at(-1), 0);
  const mixed = rsi(14).calculate(candles(wave(200)), [], 0);
  assert.ok(mixed.slice(14).every(v => v > 0 && v < 100));
});

test('MACD histogram is the MACD line minus its signal; Bollinger bands are symmetric', () => {
  const bars = candles(wave(120));
  const [line, signal, histogram] = macd(12, 26, 9).calculateOutputs!(bars, [], 0);
  for (const values of [line, signal, histogram]) assert.equal(values.length, 120);
  assert.ok(Number.isNaN(line[24]) && Number.isFinite(line[25]));
  for (let i = 40; i < 120; i++) assert.ok(close(histogram[i], line[i] - signal[i]));
  const [mid, upper, lower] = bollinger(20, 2).calculateOutputs!(bars, [], 0);
  const average = sma(20).calculate(bars, [], 0);
  for (let i = 19; i < 120; i++) {
    assert.ok(close(mid[i], average[i]));
    assert.ok(close(upper[i] - mid[i], mid[i] - lower[i]));
  }
  assert.throws(() => macd(26, 12, 9), { code: 'INVALID_INPUT' });
});

test('the registry fills defaults and rejects bad inputs with a path', () => {
  const registry = new IndicatorRegistry();
  assert.deepEqual(registry.inputs('macd'), { fast: 12, slow: 26, signal: 9 });
  assert.deepEqual(registry.inputs('bb', { deviations: 2.5 }), { period: 20, deviations: 2.5 });
  assert.throws(() => registry.inputs('rsi', { period: 1.5 }), {
    code: 'INVALID_INDICATOR_INPUT',
    path: 'inputs.period',
  });
  assert.throws(() => registry.inputs('rsi', { length: 14 }), {
    code: 'INVALID_INDICATOR_INPUT',
    path: 'inputs.length',
  });
  assert.throws(() => registry.inputs('vwap'), { code: 'UNKNOWN_INDICATOR' });
  assert.throws(() => new IndicatorRegistry([{ ...registry.get('sma')! }]), {
    code: 'DUPLICATE_INDICATOR_DEFINITION',
  });
});

function chart(plugins = [sma(20)]) {
  const feed = createStaticFeed({ candles: candles(wave(300)), interval: '1m', instrument: 'TEST' });
  const runtime = new ChartRuntime(feed, plugins);
  runtime.start();
  return runtime;
}

test('indicator commands add, edit, hide and remove; undo restores each step', () => {
  const runtime = chart();
  runtime.execute({ type: 'indicator.add', indicator: { kind: 'rsi' } });
  runtime.execute({ type: 'indicator.add', indicator: { kind: 'rsi', inputs: { period: 7 } } });
  let state = runtime.inspect();
  assert.deepEqual(
    state.indicators.map(i => i.id),
    ['sma-20', 'rsi', 'rsi-2'],
  );
  assert.equal(state.indicators[2].name, 'RSI 7');
  assert.equal(state.indicators[1].pane, 'separate');
  assert.ok(state.indicators[1].value! > 0 && state.indicators[1].value! < 100);
  runtime.execute({ type: 'indicator.update', id: 'rsi-2', inputs: { period: 21 }, visible: false });
  state = runtime.inspect();
  assert.deepEqual(state.indicators[2].inputs, { period: 21 });
  assert.equal(state.indicators[2].visible, false);
  assert.equal(runtime.state().indicators[2].visible, false);
  runtime.execute({ type: 'indicator.remove', id: 'sma-20' });
  assert.equal(runtime.inspect().indicators.length, 2);
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.inspect().indicators[0].id, 'sma-20');
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(runtime.inspect().indicators[2].inputs, { period: 7 });
  assert.throws(() => runtime.execute({ type: 'indicator.remove', id: 'nope' }), {
    code: 'INDICATOR_NOT_FOUND',
  });
  assert.throws(() => runtime.execute({ type: 'indicator.add', indicator: { kind: 'vwap' } }), {
    code: 'UNKNOWN_INDICATOR',
  });
  runtime.dispose();
});

test('host plugin objects are used as-is while the document still matches them', () => {
  const plugin = sma(5);
  let calls = 0;
  const calculate = plugin.calculate;
  plugin.calculate = (...args) => {
    calls++;
    return calculate(...args);
  };
  const runtime = chart([plugin]);
  assert.ok(calls > 0);
  assert.equal(runtime.state().indicators[0].plugin, plugin);
  runtime.execute({ type: 'indicator.update', id: 'sma-5', inputs: { period: 6 } });
  assert.notEqual(runtime.state().indicators[0].plugin, plugin, 'changed inputs use a registry instance');
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.state().indicators[0].plugin, plugin, 'undo returns to the host object');
  runtime.dispose();
});

test('older layouts migrate to the host indicators; unknown kinds survive and are reported', () => {
  const runtime = chart([sma(20), rsi(14)]);
  const saved = runtime.exportDocument();
  assert.equal(saved.version, 4);
  const v3 = { ...saved, version: 3, indicators: undefined };
  const feed = runtime.inspect().feed;
  const migrated = parseDocument(v3, feed, undefined, undefined, {
    defaults: saved.indicators,
  });
  assert.deepEqual(migrated.indicators, saved.indicators);
  runtime.restoreDocument({
    ...saved,
    indicators: [...saved.indicators, { id: 'x', kind: 'supertrend', inputs: { atr: 10 }, visible: true }],
  });
  assert.deepEqual(runtime.state().unsupportedIndicatorKinds, ['supertrend']);
  assert.equal(runtime.inspect().indicators[2].supported, false);
  assert.deepEqual(runtime.exportDocument().indicators[2].inputs, { atr: 10 });
  runtime.dispose();
});

test('log scale persists through navigation and market changes, and maps by ratio', () => {
  const runtime = chart();
  runtime.execute({ type: 'priceScale.log', enabled: true });
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'auto', log: true });
  runtime.execute({ type: 'priceScale.set', minPrice: 50, maxPrice: 200 });
  assert.equal(runtime.exportDocument().priceScale.log, true);
  runtime.execute({
    type: 'viewport.set',
    ...runtime.inspect().document.viewport,
    priceScale: { mode: 'manual', minPrice: 60, maxPrice: 180 },
  });
  assert.equal(runtime.exportDocument().priceScale.log, true);
  runtime.execute({ type: 'priceScale.reset' });
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'auto', log: true });
  runtime.replaceFeed(createStaticFeed({ candles: candles(wave(50)), interval: '1m', instrument: 'OTHER' }));
  assert.deepEqual(runtime.exportDocument().priceScale, { mode: 'auto', log: true });
  // On a log axis, 10 to 100 and 100 to 1000 take the same height.
  const g = geometryForRanges(
    { fromMs: 0, toMs: 60 * MINUTE, minPrice: 10, maxPrice: 1000 },
    800,
    600,
    undefined,
    undefined,
    {
      log: true,
    },
  );
  assert.ok(close(g.y(10) - g.y(100), g.y(100) - g.y(1000), 1e-6));
  assert.ok(close(g.price(g.y(123.45)), 123.45, 1e-9));
  runtime.dispose();
});

test('separate-pane indicators get stacked panes; price overlays stay in the plot', () => {
  const runtime = chart([sma(20)]);
  runtime.execute({ type: 'indicator.add', indicator: { kind: 'rsi' } });
  runtime.execute({ type: 'indicator.add', indicator: { kind: 'macd' } });
  const g = createGeometry(runtime.state(), 1000, 800);
  assert.deepEqual(
    g.panes.map(p => p.id),
    ['rsi', 'macd'],
  );
  assert.equal(g.panes[0].min, 0);
  assert.equal(g.panes[0].max, 100);
  assert.ok(g.panes[0].top > g.volumeTop + g.volumeHeight);
  assert.ok(g.panes[1].top > g.panes[0].top + g.panes[0].height);
  assert.ok(g.bottom <= 800 - 20, 'panes end above the time axis');
  assert.ok(g.plotHeight > 800 * 0.3, 'the price plot keeps most of the height');
  assert.ok(close(g.panes[0].value(g.panes[0].y(42)), 42, 1e-9));
  runtime.execute({ type: 'indicator.update', id: 'macd', visible: false });
  assert.equal(createGeometry(runtime.state(), 1000, 800).panes.length, 1);
  runtime.execute({ type: 'layer.set', layer: 'indicator', visible: false });
  assert.equal(createGeometry(runtime.state(), 1000, 800).panes.length, 0);
  runtime.dispose();
});
