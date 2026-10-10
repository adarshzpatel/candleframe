import { createStaticFeed } from '../src/index.ts';
import type { Candle, Interval, StaticFeed } from '../src/index.ts';

const HOUR = 3_600_000,
  DAY = 24 * HOUR;

/** Seeded random walk for a fictional stock. Weekdays only; 1h bars cover 13:30 to 20:00 UTC. */
function generate(interval: '1h' | '1d'): Candle[] {
  let state = 20260101;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const bars: Candle[] = [];
  let close = 142.5;
  const end = Date.UTC(2026, 9, 9);
  const start = end - (interval === '1d' ? 1100 : 160) * DAY;
  for (let day = start; day <= end; day += DAY) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const slots = interval === '1d' ? [0] : [13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5].map(h => h * HOUR);
    for (const offset of slots) {
      const drift = interval === '1d' ? 2.2 : 0.6;
      const open = Number((close + (random() - 0.5) * drift * 0.4).toFixed(2));
      close = Number(Math.max(5, open + (random() - 0.49) * drift).toFixed(2));
      bars.push({
        timeMs: day + offset,
        open,
        close,
        high: Number((Math.max(open, close) + random() * drift * 0.6).toFixed(2)),
        low: Number((Math.min(open, close) - random() * drift * 0.6).toFixed(2)),
        volume: Math.round(200_000 + random() * 900_000),
      });
    }
  }
  return bars;
}

export function sampleEquityFeed(interval: Interval): StaticFeed {
  return createStaticFeed({
    id: 'sample-equity',
    label: 'Sample equity',
    instrument: { symbol: 'ACME', name: 'Acme Corp (sample)', quote: 'USD', quantityPrecision: 0 },
    interval,
    candles: generate(interval === '1h' ? '1h' : '1d'),
    gaps: true,
    initialBars: 400,
    pageSize: 400,
  });
}
