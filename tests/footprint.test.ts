import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellFormat,
  footprintBar,
  footprintBucket,
  footprintOptions,
  footprintShown,
  FOOTPRINT_DEFAULTS,
  FOOTPRINT_MIN_SPACING,
} from '../src/footprint.ts';
import { ChartRuntime, parseDocument } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { Candle, FootprintLevel } from '../src/types.ts';

const levels: FootprintLevel[] = [
  [98, 0, 88],
  [99, 20, 60],
  [100, 95, 140],
  [101, 48, 12],
];

test('rows sum the levels; the POC is the heaviest row', () => {
  const bar = footprintBar(levels, 1);
  assert.deepEqual(
    bar.rows.map(row => [row.price, row.buy, row.sell]),
    levels.map(level => [...level]),
  );
  assert.equal(bar.poc, 2);
  assert.equal(bar.buy, 163);
  assert.equal(bar.sell, 300);
  assert.equal(bar.maxVolume, 235);
  assert.equal(bar.maxDelta, 88);
  assert.equal(bar.maxSide, 140);
});

test('imbalances compare each side with the diagonal opposite row', () => {
  const bar = footprintBar(levels, 1);
  // Only 88 sold at 98 against 20 bought at 99 clears 3 to 1 (4.4 to 1).
  assert.deepEqual(
    bar.rows.map(row => [row.buyImbalance, row.sellImbalance]),
    [
      [false, true],
      [false, false],
      [false, false],
      [false, false],
    ],
  );
  // 140 sold at 100 against 48 bought at 101 is 2.9 to 1; a lower ratio counts it.
  assert.equal(footprintBar(levels, 1, 1, 2).rows[2].sellImbalance, true);
  // An empty opposite cell never counts, so a bar's edges stay quiet.
  assert.equal(footprintBar([[100, 5, 0]], 1).rows[0].buyImbalance, false);
});

test('grouped rows sit on multiples of the row size and keep gaps as empty rows', () => {
  const bar = footprintBar(
    [
      [99, 1, 1],
      [100, 2, 0],
      [101, 0, 3],
      [104, 4, 0],
    ],
    1,
    2,
  );
  assert.deepEqual(
    bar.rows.map(row => [row.price, row.buy, row.sell]),
    [
      [98, 1, 1],
      [100, 2, 3],
      [102, 0, 0],
      [104, 4, 0],
    ],
  );
  assert.equal(footprintBar(undefined, 1).poc, -1);
});

test('the bucket is the smallest level gap, snapped to the tick size', () => {
  const candle = (footprint?: FootprintLevel[]): Candle => ({
    timeMs: 0,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    ...(footprint ? { footprint } : {}),
  });
  const candles = [
    candle([
      [100, 1, 1],
      [100.5, 1, 1],
    ]),
    candle([
      [100, 1, 1],
      [100.25000001, 1, 1],
    ]),
    candle(),
  ];
  assert.equal(footprintBucket(candles, 0, 3, 0.25), 0.25);
  assert.equal(footprintBucket(candles, 0, 1, 0.25), 0.5);
  assert.equal(footprintBucket(candles, 2, 3, 0.25), 0.25);
});

test('options merge with defaults and reject unknown or mistyped keys', () => {
  assert.deepEqual(footprintOptions(undefined), FOOTPRINT_DEFAULTS);
  assert.deepEqual(footprintOptions({ mode: 'delta' }), { ...FOOTPRINT_DEFAULTS, mode: 'delta' });
  assert.throws(() => footprintOptions({ mode: 'ladder' }), {
    code: 'INVALID_FOOTPRINT',
    path: 'footprint.mode',
  });
  assert.throws(() => footprintOptions({ poc: 1 }), { code: 'INVALID_FOOTPRINT', path: 'footprint.poc' });
  assert.throws(() => footprintOptions({ ratio: 3 }), { code: 'INVALID_FOOTPRINT' });
  assert.equal(footprintShown({ chartType: 'footprint' }, FOOTPRINT_MIN_SPACING), true);
  assert.equal(footprintShown({ chartType: 'footprint' }, FOOTPRINT_MIN_SPACING - 1), false);
  assert.equal(footprintShown({}, 200), false);
});

test('chartType.set is undoable, survives a save and keeps cell settings while candles show', () => {
  const runtime = new ChartRuntime(createSimulatedFeed());
  runtime.start();
  assert.equal(runtime.exportDocument().chartType, undefined);
  runtime.execute({ type: 'chartType.set', chartType: 'footprint', footprint: { mode: 'delta' } });
  runtime.execute({ type: 'chartType.set', chartType: 'footprint', footprint: { poc: false } });
  let saved = runtime.exportDocument();
  assert.equal(saved.chartType, 'footprint');
  assert.deepEqual(saved.footprint, { ...FOOTPRINT_DEFAULTS, mode: 'delta', poc: false });
  runtime.execute({ type: 'chartType.set', chartType: 'candles' });
  saved = runtime.exportDocument();
  assert.equal(saved.chartType, undefined);
  assert.equal(saved.footprint?.mode, 'delta');
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().chartType, 'footprint');

  const parsed = parseDocument(JSON.parse(JSON.stringify(runtime.exportDocument())), runtime.inspect().feed);
  assert.equal(parsed.chartType, 'footprint');
  assert.throws(() => runtime.execute({ type: 'chartType.set', chartType: 'renko' as 'candles' }), {
    code: 'INVALID_CHART_TYPE',
  });
  assert.throws(
    () =>
      runtime.execute({
        type: 'chartType.set',
        chartType: 'footprint',
        footprint: { mode: 'ladder' as 'delta' },
      }),
    { code: 'INVALID_FOOTPRINT' },
  );
  runtime.dispose();
});

test('cells share decimals per bar and drop the leading zero', () => {
  const small = cellFormat(1.4);
  assert.deepEqual(
    [small(1.4), small(0.0412), small(0), small(-0.5, true), small(0.5, true)],
    ['1.40', '.04', '0', '-.50', '+.50'],
  );
  assert.equal(cellFormat(140)(95.4), '95');
  assert.equal(cellFormat(0.3)(0.0412), '.041');
  assert.equal(cellFormat(25000)(12345, true), '+12.3K');
  assert.equal(cellFormat(1.4, 2)(1.4), '1.4');
  assert.equal(cellFormat(0.3, 2)(0.0412), '.04');
});
