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

test('fills of one aggressive order become one large print at their average price', () => {
  const bars = new TradeBarBuilder({ kind: 'time', ms: 60_000 }, 0.25, { largeTradeMin: 10 });
  bars.add({ ...trade(100, 100, 6, 'buy'), orderId: 'A' });
  bars.add({ ...trade(100, 100.25, 6, 'buy'), orderId: 'A' });
  bars.add({ ...trade(200, 100.25, 3, 'sell'), orderId: 'B' });
  const { candle } = bars.add({ ...trade(300, 100, 12, 'sell'), orderId: 'C' })!;
  assert.deepEqual(candle.largeTrades, [
    [100.25, 12, 1, t0 + 100], // 6 @ 100 and 6 @ 100.25 average 100.125, snapped to a tick.
    [100, 12, -1, t0 + 300],
  ]);
});

test('without order ids, fills with the same side and time merge', () => {
  const bars = new TradeBarBuilder({ kind: 'tick', count: 100 }, 0.25, { largeTradeMin: 5 });
  bars.add(trade(5, 100, 3, 'sell'));
  bars.add(trade(5, 99.75, 3, 'sell'));
  bars.add(trade(6, 99.75, 4, 'sell'));
  const { candle } = bars.add(trade(7, 99.75, 1, 'buy'))!;
  assert.deepEqual(candle.largeTrades, [[100, 6, -1, t0 + 5]]);
});

test('large prints are off by default and stay within their bar', () => {
  const plain = new TradeBarBuilder({ kind: 'tick', count: 2 }, 0.25);
  assert.equal(plain.add(trade(0, 100, 500))!.candle.largeTrades, undefined);
  const bars = new TradeBarBuilder({ kind: 'tick', count: 1 }, 0.25, { largeTradeMin: 5 });
  bars.add({ ...trade(0, 100, 5), orderId: 'A' });
  bars.add({ ...trade(0, 100, 5), orderId: 'A' }); // A new bar: the print does not carry over.
  assert.deepEqual(
    bars.candles.map(c => c.largeTrades?.map(t => t[1])),
    [[5], [5]],
  );
});

test('momentum bars close at open ± range and the next opens there, with no gaps', () => {
  const bars = new TradeBarBuilder({ kind: 'momentum', ticks: 4 }, 0.25);
  // Up a point from 100: the bar closes at exactly 101 and the next opens at 101.
  const changed = [100, 100.5, 99.75, 101.25].map(price => bars.add(trade(0, price))!.changed);
  assert.deepEqual(
    bars.candles.map(c => [c.open, c.high, c.low, c.close]),
    [
      [100, 101, 99.75, 101],
      [101, 101.25, 101, 101.25],
    ],
  );
  // The trade that completed the first bar reports both bars, with the first one final.
  assert.deepEqual(
    changed.at(-1)!.map(c => c.close),
    [101, 101.25],
  );
});

test('a momentum jump of several ranges fills the bars in between', () => {
  const bars = new TradeBarBuilder({ kind: 'momentum', ticks: 2 }, 0.25);
  bars.add(trade(0, 100));
  const { changed } = bars.add(trade(5, 98.25))!;
  // Down 7 ticks with a 2-tick range: bars close at 99.5, 99 and 98.5; the last opens there.
  assert.deepEqual(
    bars.candles.map(c => [c.open, c.close]),
    [
      [100, 99.5],
      [99.5, 99],
      [99, 98.5],
      [98.5, 98.25],
    ],
  );
  assert.equal(changed.length, 4);
  // Times stay strictly increasing for the filled bars.
  const times = bars.candles.map(c => c.timeMs);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]!));
});
