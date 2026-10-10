// Main-thread cost of the work a live chart repeats: applying a tick (with indicators)
// and building a frame's GPU instances. Uses a no-op WebGL context, so it measures
// CPU work only, not GPU time or presentation.
//
//   node --experimental-strip-types scripts/bench.ts [--candles 10000] [--bars 2200]
import { performance } from 'node:perf_hooks';
import { ChartRuntime } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { bollinger, ema, macd, rsi, sma } from '../src/indicators.ts';
import { createGeometry } from '../src/geometry.ts';
import { WebGL2Renderer } from '../src/webgl-renderer.ts';
import type { Candle } from '../src/types.ts';

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const count = arg('candles', 10_000);
const visibleBars = arg('bars', 2200);
const MINUTE = 60_000;

let price = 100;
const candles: Candle[] = Array.from({ length: count }, (_, i) => {
  const open = price;
  price = Math.max(1, price + Math.sin(i / 17) * 0.4 + ((i * 7919) % 13) / 13 - 0.5);
  return {
    timeMs: i * MINUTE,
    open,
    close: price,
    high: Math.max(open, price) + 0.3,
    low: Math.min(open, price) - 0.3,
    volume: 10 + (i % 7),
  };
});
const feed = createStaticFeed({ candles, interval: '1m', instrument: 'BENCH', initialBars: count });
const runtime = new ChartRuntime(feed, [sma(20), ema(50), bollinger(20, 2), rsi(14), macd(12, 26, 9)], {
  maxCandles: count + 1000,
});
runtime.start();

function measure(label: string, runs: number, work: (i: number) => void): void {
  for (let i = 0; i < Math.min(20, runs); i++) work(i);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    work(i);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const pick = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(3);
  console.log(`${label.padEnd(44)} median ${pick(0.5)} ms   p95 ${pick(0.95)} ms`);
}

console.log(`${count} candles, 5 indicators (SMA, EMA, BB, RSI, MACD), ${visibleBars} visible bars\n`);
let last = candles.at(-1)!;
measure('tick: replace last bar + indicators', 300, i => {
  last = { ...last, close: last.close + (i % 2 ? 0.1 : -0.1), high: last.high + 0.2 };
  feed.update(last);
});
measure('tick: append bar + indicators', 300, () => {
  last = { ...last, timeMs: last.timeMs + MINUTE, open: last.close };
  feed.update(last);
});

runtime.execute({ type: 'indicator.update', id: 'rsi-14', visible: true });
const end = runtime.state().candles.at(-1)!.timeMs;
runtime.execute({ type: 'viewport.set', fromMs: end - (visibleBars - 12) * MINUTE, toMs: end + 12 * MINUTE });

(globalThis as unknown as { window: object }).window = { devicePixelRatio: 2 };
const gl = new Proxy<Record<string, unknown>>(
  {
    getProgramParameter: () => true,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    createTexture: () => ({}),
    getUniformLocation: () => ({}),
  },
  { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
);
const canvas = Object.assign(new EventTarget(), { width: 0, height: 0, getContext: () => gl });
const renderer = new WebGL2Renderer();
renderer.mount(
  canvas as unknown as HTMLCanvasElement,
  () => {},
  () => {},
);
const state = runtime.state();
measure('frame: geometry (autoscale + panes)', 300, () => createGeometry(state, 1600, 900));
const geometry = createGeometry(state, 1600, 900);
let instances = 0;
measure('frame: build and upload GPU instances', 300, () => {
  instances = renderer.render({ state, geometry }).instances;
});
console.log(`\n${instances} instances per frame`);
renderer.dispose();
runtime.dispose();
