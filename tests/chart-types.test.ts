import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHART_TYPES, drawsClosesOnly, heikinAshi } from '../src/chart-types.ts';
import { chartCommandSchema } from '../src/command-schema.ts';
import { createGeometry } from '../src/geometry.ts';
import { sma } from '../src/indicators.ts';
import { ChartRuntime, parseDocument } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { WebGL2Renderer } from '../src/webgl-renderer.ts';
import type { Candle, ChartType } from '../src/types.ts';

const MINUTE = 60_000;
/** Series equal up to rounding: incremental sums drift in the last digits. */
const near = (actual: readonly number[], expected: readonly number[]) =>
  assert.ok(
    actual.length === expected.length &&
      actual.every((v, i) =>
        Number.isNaN(v) ? Number.isNaN(expected[i]) : Math.abs(v - expected[i]) < 1e-9,
      ),
  );
const series = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const open = 100 + 8 * Math.sin(i / 5),
      close = 100 + 8 * Math.sin((i + 1) / 5);
    return {
      timeMs: i * MINUTE,
      open,
      close,
      high: Math.max(open, close) + 3,
      low: Math.min(open, close) - 3,
      volume: 1 + (i % 4),
    };
  });

test('Heikin Ashi follows the formula and updates a tick like a full recalculation', () => {
  const raw = series(40);
  const ha = heikinAshi(raw, [], 0);
  assert.equal(ha.length, raw.length);
  assert.equal(ha[0].open, (raw[0].open + raw[0].close) / 2);
  for (const i of [1, 17, 39]) {
    const bar = raw[i];
    assert.equal(ha[i].close, (bar.open + bar.high + bar.low + bar.close) / 4);
    assert.equal(ha[i].open, (ha[i - 1].open + ha[i - 1].close) / 2);
    assert.equal(ha[i].high, Math.max(bar.high, ha[i].open, ha[i].close));
    assert.equal(ha[i].low, Math.min(bar.low, ha[i].open, ha[i].close));
    assert.equal(ha[i].timeMs, bar.timeMs);
    assert.equal(ha[i].volume, bar.volume);
  }
  const ticked = raw.slice();
  ticked[39] = { ...ticked[39], close: 120, high: 121 };
  const incremental = heikinAshi(ticked, ha, 39);
  assert.deepEqual(incremental, heikinAshi(ticked, [], 0));
  assert.equal(incremental[38], ha[38], 'earlier bars are reused');
});

test('every chart type is a command enum value and survives a save', () => {
  const schema = (
    chartCommandSchema.oneOf as { properties: { type: { const: string }; chartType: { enum: string[] } } }[]
  ).find(command => command.properties.type.const === 'chartType.set')!;
  assert.deepEqual(
    schema.properties.chartType.enum,
    CHART_TYPES.map(type => type.id),
  );
  const runtime = new ChartRuntime(
    createStaticFeed({ candles: series(60), interval: '1m', instrument: 'TEST' }),
  );
  runtime.start();
  for (const { id } of CHART_TYPES) {
    runtime.execute({ type: 'chartType.set', chartType: id });
    const saved = JSON.parse(JSON.stringify(runtime.exportDocument()));
    assert.equal(saved.chartType, id === 'candles' ? undefined : id);
    assert.equal(parseDocument(saved, runtime.inspect().feed).chartType, saved.chartType);
  }
  assert.throws(() => runtime.execute({ type: 'chartType.set', chartType: 'renko' as ChartType }), {
    code: 'INVALID_CHART_TYPE',
  });
  runtime.dispose();
});

test('Heikin Ashi bars replace the candles every consumer reads, and query can return raw ones', () => {
  const raw = series(80);
  const feed = createStaticFeed({ candles: raw, interval: '1m', instrument: 'TEST' });
  const runtime = new ChartRuntime(feed, [sma(10)]);
  runtime.start();
  const smaOf = () => runtime.state().indicators[0].series[0];
  const rawSma = smaOf().slice();
  runtime.execute({ type: 'chartType.set', chartType: 'heikin-ashi' });
  const ha = heikinAshi(raw, [], 0);
  assert.deepEqual(runtime.state().candles, ha);
  assert.deepEqual(runtime.query({ limit: 5 }).candles, ha.slice(-5));
  assert.deepEqual(runtime.query({ limit: 5, raw: true }).candles, raw.slice(-5));
  // Indicators read the bars on screen.
  near(smaOf(), sma(10).calculate(ha, [], 0));
  assert.notDeepEqual(smaOf(), rawSma);

  // A live tick recomputes from the changed bar on.
  const tick = { ...raw[79], close: raw[79].close + 5, high: raw[79].close + 6 };
  feed.update(tick);
  const ticked = [...raw.slice(0, 79), tick];
  assert.deepEqual(runtime.state().candles, heikinAshi(ticked, [], 0));
  near(smaOf(), sma(10).calculate(heikinAshi(ticked, [], 0), [], 0));

  // A preview leaves the bars alone; undo switches back to the feed's bars and indicators.
  runtime.preview([{ type: 'chartType.set', chartType: 'line' }]);
  assert.deepEqual(runtime.state().candles, heikinAshi(ticked, [], 0));
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().chartType, undefined);
  assert.deepEqual(runtime.state().candles, ticked);
  near(smaOf(), sma(10).calculate(ticked, [], 0));
  runtime.dispose();
});

test('line types fit the price range to closes', () => {
  const runtime = new ChartRuntime(
    createStaticFeed({ candles: series(60), interval: '1m', instrument: 'TEST' }),
  );
  runtime.start();
  const candles = createGeometry(runtime.state(), 900, 600);
  runtime.execute({ type: 'chartType.set', chartType: 'area' });
  const area = createGeometry(runtime.state(), 900, 600);
  assert.ok(area.maxPrice - area.minPrice < candles.maxPrice - candles.minPrice);
  assert.ok(drawsClosesOnly('baseline') && !drawsClosesOnly('ohlc-bars') && !drawsClosesOnly(undefined));
  runtime.dispose();
});

/** Instances the renderer uploads for one frame: [x1, y1, x2, y2, width, r, g, b, a, clipTop, clipBottom, endWidth]. */
function render(type: ChartType) {
  const runtime = new ChartRuntime(
    createStaticFeed({ candles: series(60), interval: '1m', instrument: 'TEST' }),
    [],
    {},
  );
  runtime.start();
  runtime.execute({ type: 'chartType.set', chartType: type });
  for (const layer of ['volume', 'indicator'] as const)
    runtime.execute({ type: 'layer.set', layer, visible: false });
  (globalThis as unknown as { window: object }).window = { devicePixelRatio: 1 };
  let upload = new Float32Array();
  const gl = new Proxy<Record<string, unknown>>(
    {
      getProgramParameter: () => true,
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      createTexture: () => ({}),
      getUniformLocation: () => ({}),
      bufferSubData: (_t: unknown, _o: number, data: Float32Array) => (upload = data.slice()),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  const renderer = new WebGL2Renderer();
  renderer.mount(
    Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: () => gl,
    }) as unknown as HTMLCanvasElement,
    () => {},
    () => {},
  );
  const geometry = createGeometry(runtime.state(), 900, 600);
  renderer.render({ state: runtime.state(), geometry, grid: { x: [], y: [] } });
  renderer.dispose();
  runtime.dispose();
  const instances = Array.from({ length: upload.length / 12 }, (_, i) =>
    Array.from(upload.slice(i * 12, i * 12 + 12)),
  );
  return { instances, geometry };
}

test('each chart type draws its own geometry', () => {
  const counts = Object.fromEntries(CHART_TYPES.map(({ id }) => [id, render(id).instances.length]));
  for (const [type, count] of Object.entries(counts)) assert.ok(count > 0, `${type} draws`);
  // Two lines per candle; bars add ticks; hollow up candles draw an outline.
  assert.ok(counts['ohlc-bars'] > counts['hlc-bars'] && counts['hlc-bars'] > counts['high-low']);
  assert.ok(counts['hollow-candles'] > counts.candles);
  assert.ok(counts.area > counts.line, 'area adds fills');

  const fills = (type: ChartType) => render(type).instances.filter(v => v[11] >= 0);
  assert.equal(fills('line').length, 0);
  assert.ok(fills('area').length > 0);
  // Baseline fills come in two colours, above and below the base.
  assert.equal(new Set(fills('baseline').map(v => v.slice(5, 8).join())).size, 2);

  const { instances, geometry } = render('columns');
  const bottom = geometry.top + geometry.plotHeight;
  const columns = instances.filter(v => v[1] === v[3] && Math.abs(v[1] + v[4] / 2 - bottom) < 1e-3);
  assert.ok(columns.length >= 50, 'columns stand on the bottom of the price pane');

  const steps = render('step-line').instances;
  assert.ok(steps.every(v => Math.abs(v[0] - v[2]) < 1e-6 || Math.abs(v[1] - v[3]) < 1e-6));
});
