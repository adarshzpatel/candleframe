import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TradeBarBuilder, type Trade } from '../src/trade-bars.ts';

const t0 = 1_791_869_340_000; // A minute boundary.
const trade = (offsetMs: number, price: number, size = 1, side: Trade['side'] = 'buy'): Trade => ({
  timeMs: t0 + offsetMs,
  price,
  size,
  side,
});

test('time bars carry buy volume, a per-tick footprint and the delta range', () => {
  const bars = new TradeBarBuilder({ kind: 'time', ms: 60_000 }, 0.25);
  bars.add(trade(100, 100, 2, 'buy'));
  bars.add(trade(200, 100.25, 3, 'sell'));
  const { candle } = bars.add(trade(300, 100, 1, 'sell'))!;
  assert.deepEqual(candle, {
    timeMs: t0,
    open: 100,
    high: 100.25,
    low: 100,
    close: 100,
    volume: 6,
    buyVolume: 2,
    footprint: [
      [100, 2, 1],
      [100.25, 0, 3],
    ],
    deltaRange: [-2, 2],
  });
});

test('time bars accept a late trade without moving the close', () => {
  const bars = new TradeBarBuilder({ kind: 'time', ms: 60_000 }, 0.25);
  bars.add(trade(0, 100));
  bars.add(trade(60_000, 101));
  const late = bars.add(trade(59_999, 99, 2, 'sell'))!;
  assert.equal(late.opened, false);
  assert.deepEqual([late.candle.timeMs, late.candle.close, late.candle.low], [t0, 100, 99]);
});

test('tick bars close after the set number of trades, whatever their size', () => {
  const bars = new TradeBarBuilder({ kind: 'tick', count: 3 }, 0.25);
  const opened = [5, 1, 1, 9, 1, 1, 1].map(
    (size, i) => bars.add(trade(i * 10, 100 + i * 0.25, size))!.opened,
  );
  assert.deepEqual(opened, [true, false, false, true, false, false, true]);
  assert.deepEqual(
    bars.candles.map(c => [c.open, c.close, c.volume]),
    [
      [100, 100.5, 7],
      [100.75, 101.25, 11],
      [101.5, 101.5, 1],
    ],
  );
});

test('range bars close when the next trade would exceed the range', () => {
  const bars = new TradeBarBuilder({ kind: 'range', ticks: 4 }, 0.25);
  for (const price of [100, 100.5, 99.75, 100.75, 99.5]) bars.add(trade(0, price));
  // 99.75 to 100.75 is exactly 4 ticks; 99.5 would make it 5, so it starts a bar.
  assert.deepEqual(
    bars.candles.map(c => [c.open, c.high, c.low, c.close]),
    [
      [100, 100.75, 99.75, 100.75],
      [99.5, 99.5, 99.5, 99.5],
    ],
  );
});

test('bars opened in the same millisecond get strictly increasing times', () => {
  const bars = new TradeBarBuilder({ kind: 'tick', count: 1 }, 0.25);
  for (let i = 0; i < 3; i++) bars.add(trade(0.4, 100));
  assert.deepEqual(
    bars.candles.map(c => c.timeMs),
    [t0, t0 + 1, t0 + 2],
  );
});

test('footprint and buy volume always add up to the bar volume', () => {
  const bars = new TradeBarBuilder({ kind: 'range', ticks: 8 }, 0.1);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let price = 50;
  for (let i = 0; i < 2000; i++) {
    price = Math.round((price + (random() - 0.5) * 0.6) * 10) / 10;
    bars.add(trade(i, price, 1 + Math.floor(random() * 5), random() < 0.5 ? 'buy' : 'sell'));
  }
  for (const c of bars.candles) {
    const sum = c.footprint!.reduce((total, [, buy, sell]) => total + buy + sell, 0);
    assert.equal(sum, c.volume);
    assert.ok(c.buyVolume! <= c.volume);
    assert.ok(Math.round((c.high - c.low) / 0.1) <= 8);
  }
});
