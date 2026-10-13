import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectFlowSignals } from '../src/flow-signals.ts';
import type { Candle } from '../src/types.ts';

const options = { lookback: 20, volumeMultiple: 1.5, minDelta: 0.3 };

/** 20 quiet bars (volume 100, range 4, balanced delta), then the bar under test. */
function series(last: Partial<Candle>): Candle[] {
  const quiet = Array.from({ length: 20 }, (_, i) => ({
    timeMs: i * 60_000,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 100,
    buyVolume: 50,
  }));
  return [...quiet, { timeMs: 20 * 60_000, open: 100, high: 102, low: 98, close: 100, volume: 100, ...last }];
}

const detect = (bars: Candle[]) => detectFlowSignals(bars, 20, bars.length, options);

test('heavy buying that lifts price is buy aggression, marked under the low', () => {
  const [signal] = detect(
    series({ volume: 300, buyVolume: 250, open: 100, close: 104, high: 104.5, low: 99.5 }),
  );
  // The zone is the base the push launched from: the low to the open.
  assert.deepEqual(signal, {
    index: 20,
    kind: 'aggression',
    side: 1,
    price: 99.5,
    strength: 3,
    zoneLow: 99.5,
    zoneHigh: 100,
  });
});

test('heavy selling that fails to push price down is absorption by bids, at the heaviest sell level', () => {
  const [signal] = detect(
    series({
      volume: 300,
      buyVolume: 50,
      open: 100,
      close: 100.5,
      footprint: [
        [99.5, 10, 180],
        [100, 30, 60],
        [100.5, 10, 10],
      ],
    }),
  );
  // The zone runs from the low up to the level where sellers were absorbed.
  assert.deepEqual(signal, {
    index: 20,
    kind: 'absorption',
    side: 1,
    price: 99.5,
    strength: 3,
    zoneLow: 98,
    zoneHigh: 99.5,
  });
});

test('heavy buying into falling price is absorption by offers, at the high without a footprint', () => {
  const [signal] = detect(series({ volume: 200, buyVolume: 160, open: 100, close: 99, high: 101 }));
  assert.equal(signal!.kind, 'absorption');
  assert.equal(signal!.side, -1);
  assert.equal(signal!.price, 101);
});

test('ordinary volume, balanced delta or missing buy volume give no signal', () => {
  assert.deepEqual(detect(series({ volume: 140, buyVolume: 130, close: 104 })), []);
  assert.deepEqual(detect(series({ volume: 300, buyVolume: 170, close: 104 })), []);
  assert.deepEqual(detect(series({ volume: 300, buyVolume: undefined, close: 104 })), []);
});

test('the first bars wait for half a lookback of history', () => {
  const bars = series({ volume: 300, buyVolume: 250, close: 104 }).slice(12);
  assert.deepEqual(detectFlowSignals(bars, 0, bars.length, options), []);
});

test('the indicator is registered with its inputs', async () => {
  const { IndicatorRegistry } = await import('../src/indicators.ts');
  const plugin = new IndicatorRegistry().create(
    'flow-signals',
    { lookback: 30, volumeMultiple: 2, minDelta: 40, absorptionDelta: 15, zoneBars: 60 },
    'fs',
  );
  assert.deepEqual(plugin.flowSignals, {
    lookback: 30,
    volumeMultiple: 2,
    minDelta: 0.4,
    absorptionDelta: 0.15,
    zoneBars: 60,
  });
});

test('absorption has its own, lower delta threshold and also counts a rejected close', () => {
  // 20% net selling, closing near the high after trading down: bids absorbed it.
  const bar = { volume: 300, buyVolume: 120, open: 100, high: 101, low: 97, close: 100.75 };
  assert.deepEqual(detect(series(bar)), []);
  const bars = series(bar);
  const [signal] = detectFlowSignals(bars, 20, bars.length, { ...options, absorptionDelta: 0.15 });
  assert.deepEqual([signal!.kind, signal!.side, signal!.price], ['absorption', 1, 97]);
});

test('a zone extends until a later bar closes through it, or for at most maxBars', async () => {
  const { zoneEnd } = await import('../src/flow-signals.ts');
  const bars = series({ volume: 300, buyVolume: 250, open: 100, close: 104, high: 104.5, low: 99.5 });
  const [signal] = detect(bars);
  const later = (close: number) => ({ timeMs: 0, open: close, high: close, low: close, close, volume: 1 });
  // Two bars hold above the zone, the third closes below it.
  const extended = [...bars, later(101), later(99.8), later(99)];
  assert.deepEqual(zoneEnd(extended, signal!, 120), { endIndex: 23, broken: true });
  assert.deepEqual(zoneEnd(extended, signal!, 2), { endIndex: 22, broken: false });
  assert.deepEqual(zoneEnd(bars, signal!, 120), { endIndex: 20, broken: false });
});

test('a zone is at least one tick thick', () => {
  const bars = series({ volume: 300, buyVolume: 250, open: 99.5, close: 104, high: 104.5, low: 99.5 });
  const [signal] = detectFlowSignals(bars, 20, bars.length, { ...options, tickSize: 0.25 });
  assert.deepEqual([signal!.zoneLow, signal!.zoneHigh], [99.5, 99.75]);
});
