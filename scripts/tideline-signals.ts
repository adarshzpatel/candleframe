// Counts Tideline pullback signals and scores their projected trades, with and without the
// chop filters.
//
//   node --experimental-strip-types scripts/tideline-signals.ts            # 40 seeded runs
//   node --experimental-strip-types scripts/tideline-signals.ts --runs 100 --seed 7
//
// Each run alternates 120 bars of noisy chop with 80 bars of trend (direction random), five
// times. A trade scores +targetR at the target, -1 at the stop, and its close in R when the
// projection times out or the data ends. Synthetic bars only show how the filters change the
// mix of signals; they say nothing about an edge on a real market.
import { tideline } from '../src/indicators.ts';
import type { Candle } from '../src/types.ts';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) => (arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : [])),
);
const runs = Number(args.runs ?? 40);
let seed = Number(args.seed ?? 1);
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const noise = () => (random() + random() + random() - 1.5) * 2;

function series(): { candles: Candle[]; trending: boolean[] } {
  const candles: Candle[] = [],
    trending: boolean[] = [];
  let price = 1000;
  const push = (drift: number, trend: boolean) => {
    const open = price;
    price = open + drift + noise() * 4;
    const high = Math.max(open, price) + random() * 4,
      low = Math.min(open, price) - random() * 4;
    candles.push({ timeMs: candles.length * 60_000, open, high, low, close: price, volume: 1 });
    trending.push(trend);
  };
  for (let block = 0; block < 5; block++) {
    const anchor = price;
    for (let i = 0; i < 120; i++) push((anchor - price) * 0.15, false);
    const direction = random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 80; i++) push(direction * 2.5, true);
  }
  return { candles, trending };
}

const OUT = { bull: 11, bear: 12, entry: 13, stop: 14, target: 15 };
const variants = {
  'trend + slope': { neutral: 10, enterPercent: 10, holdBars: 1, regime: false },
  '+ hysteresis, hold': { neutral: 10, enterPercent: 30, holdBars: 3, regime: false },
  '+ regime gate': { neutral: 10, enterPercent: 30, holdBars: 3, regime: true },
};
const targetR = 2;

for (const [name, v] of Object.entries(variants)) {
  let signals = 0,
    inChop = 0;
  const results: number[] = [];
  seed = Number(args.seed ?? 1);
  for (let run = 0; run < runs; run++) {
    const { candles, trending } = series();
    const out = tideline(8, 21, 200, v.neutral, { ...v, targetR }).calculateOutputs!(candles, [], 0);
    for (let i = 0; i < candles.length; i++)
      if (Number.isFinite(out[OUT.bull][i]) || Number.isFinite(out[OUT.bear][i])) {
        signals++;
        if (!trending[i]) inChop++;
      }
    const entry = out[OUT.entry],
      stop = out[OUT.stop],
      target = out[OUT.target];
    for (let i = 0; i < candles.length; i++) {
      if (!Number.isFinite(entry[i]) || Number.isFinite(entry[i - 1])) continue;
      let last = i;
      while (Number.isFinite(entry[last + 1])) last++;
      const side = target[i] > entry[i] ? 1 : -1,
        risk = Math.abs(entry[i] - stop[i]);
      const end = candles[last];
      if (side > 0 ? end.low <= stop[i] : end.high >= stop[i]) results.push(-1);
      else if (side > 0 ? end.high >= target[i] : end.low <= target[i]) results.push(targetR);
      else results.push((side * (end.close - entry[i])) / risk);
    }
  }
  const wins = results.filter(r => r > 0).length;
  const mean = results.reduce((a, b) => a + b, 0) / (results.length || 1);
  console.log(
    `${name.padEnd(18)} signals ${String(signals).padStart(4)}  in chop ${((100 * inChop) / (signals || 1)).toFixed(0).padStart(3)}%` +
      `  trades ${String(results.length).padStart(4)}  win ${((100 * wins) / (results.length || 1)).toFixed(0).padStart(3)}%` +
      `  avg ${mean.toFixed(2)}R`,
  );
}
