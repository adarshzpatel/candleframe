// Measures how many bars `classifyRegimes` takes to call a known regime change.
//
//   node --experimental-strip-types scripts/regime-lag.ts            # 200 seeded runs
//   node --experimental-strip-types scripts/regime-lag.ts --runs 50 --seed 7
//
// Each run: 150 bars of noisy chop, then a trend (long or short) of 60 bars, then 80 bars
// of quiet chop with a quarter of the range. Reports the median and 90th percentile delay
// from each change to the first bar classified as the new regime.
import { classifyRegimes } from '../src/indicators.ts';
import type { Candle } from '../src/types.ts';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) => (arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : [])),
);
const runs = Number(args.runs ?? 200);
let seed = Number(args.seed ?? 1);
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const noise = () => (random() + random() + random() - 1.5) * 2;

function scenario(direction: 1 | -1): { candles: Candle[]; trendStart: number; quietStart: number } {
  const candles: Candle[] = [];
  let price = 1000;
  const push = (drift: number, scale: number) => {
    const open = price;
    price = open + drift + noise() * scale;
    const high = Math.max(open, price) + random() * scale,
      low = Math.min(open, price) - random() * scale;
    candles.push({ timeMs: candles.length * 60_000, open, high, low, close: price, volume: 1 });
  };
  for (let i = 0; i < 150; i++) push((1000 - price) * 0.15, 4);
  const trendStart = candles.length;
  for (let i = 0; i < 60; i++) push(direction * 3, 4);
  const quietStart = candles.length,
    anchor = price;
  for (let i = 0; i < 80; i++) push((anchor - price) * 0.15, 1);
  return { candles, trendStart, quietStart };
}

const delays = { expansion: [] as number[], compression: [] as number[] };
let missed = 0,
  falseBars = 0,
  chopBars = 0,
  heldBars = 0,
  trendBars = 0;
for (let run = 0; run < runs; run++) {
  const direction = run % 2 ? 1 : -1;
  const { candles, trendStart, quietStart } = scenario(direction);
  const regimes = classifyRegimes(candles);
  const want = direction > 0 ? 'long' : 'short';
  const hit = (from: number, to: number, regime: string) => {
    for (let i = from; i < to; i++) if (regimes[i] === regime) return i - from;
    missed++;
    return to - from;
  };
  // Bars of the opening chop (after warmup) called expansion are false signals.
  for (let i = 110; i < trendStart; i++, chopBars++)
    if (regimes[i] === 'long' || regimes[i] === 'short') falseBars++;
  const found = hit(trendStart, quietStart, want);
  delays.expansion.push(found);
  // After the trend is first called, the share of its bars that stay called.
  for (let i = trendStart + found; i < quietStart; i++, trendBars++) if (regimes[i] === want) heldBars++;
  delays.compression.push(hit(quietStart, candles.length, 'compression'));
}
const pct = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(p * (values.length - 1))];
for (const [name, values] of Object.entries(delays))
  console.log(`${name.padEnd(12)} median ${pct(values, 0.5)} bars, p90 ${pct(values, 0.9)} bars`);
console.log(`chop called expansion ${((100 * falseBars) / chopBars).toFixed(1)}% of bars`);
console.log(`trend held ${((100 * heldBars) / trendBars).toFixed(1)}% of bars once called`);
console.log(`missed ${missed} of ${runs * 2} changes`);
