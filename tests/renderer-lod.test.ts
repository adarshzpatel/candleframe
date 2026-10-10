import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartRuntime } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { createGeometry } from '../src/geometry.ts';
import { WebGL2Renderer } from '../src/webgl-renderer.ts';
import type { Candle } from '../src/types.ts';

const MINUTE = 60_000;

function render(width: number) {
  const candles: Candle[] = Array.from({ length: 3000 }, (_, i) => ({
    timeMs: i * MINUTE,
    open: 100 + (i % 10),
    close: 101 + (i % 7),
    high: 120,
    low: 80,
    volume: 1,
  }));
  const runtime = new ChartRuntime(
    createStaticFeed({ candles, interval: '1m', instrument: 'LOD', initialBars: 3000 }),
  );
  runtime.start();
  runtime.execute({ type: 'viewport.set', fromMs: 800 * MINUTE, toMs: 2999 * MINUTE });
  (globalThis as unknown as { window: object }).window = { devicePixelRatio: 1 };
  const uploads: Float32Array[] = [];
  const gl = new Proxy<Record<string, unknown>>(
    {
      getProgramParameter: () => true,
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      createTexture: () => ({}),
      getUniformLocation: () => ({}),
      bufferSubData: (_t: unknown, _o: number, data: Float32Array) => uploads.push(data.slice()),
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
  const geometry = createGeometry(runtime.state(), width, 600);
  const stats = renderer.render({ state: runtime.state(), geometry });
  renderer.dispose();
  runtime.dispose();
  const data = uploads.at(-1)!;
  // Wick instances: vertical lines spanning the full 80-120 range.
  const wicks: number[] = [];
  for (let i = 0; i < data.length; i += 11)
    if (data[i] === data[i + 2] && Math.abs(geometry.y(120) - data[i + 1]) < 1e-3) wicks.push(data[i]);
  return { stats, geometry, wicks };
}

test('zoomed-out views merge bars that share a pixel column, keeping the price extremes', () => {
  const narrow = render(900);
  assert.ok(narrow.geometry.barSpacing < 2);
  // About one merged candle per two pixels instead of 2,200 candles.
  assert.ok(narrow.wicks.length <= narrow.geometry.plotWidth / 2 + 2, `${narrow.wicks.length} wicks`);
  assert.ok(narrow.wicks.length > narrow.geometry.plotWidth / 4);
  const wide = render(12_000);
  assert.ok(wide.geometry.barSpacing >= 2);
  assert.ok(wide.wicks.length >= 2199, 'wide views draw every bar');
  assert.ok(narrow.stats.instances < wide.stats.instances / 3);
});
