import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyMarkers, copyPriceLines } from '../src/chart-overlays.ts';

test('price lines are copied, so later host edits do not reach the chart', () => {
  const lines = [{ price: 100.25, color: '@positive', label: 'BUY 2 LMT' }];
  const copy = copyPriceLines(lines);
  lines[0]!.price = 1;
  assert.equal(copy[0]!.price, 100.25);
});

test('price lines and markers reject bad input', () => {
  assert.throws(() => copyPriceLines([{ price: Number.NaN }]), { code: 'INVALID_INPUT' });
  assert.throws(() => copyPriceLines([{ price: 1, color: 'red' }]), { code: 'INVALID_INPUT' });
  assert.throws(() => copyPriceLines([{ price: 1, width: 20 }]), { code: 'INVALID_INPUT' });
  assert.throws(() => copyMarkers([{ timeMs: 1, price: Number.POSITIVE_INFINITY }]), {
    code: 'INVALID_INPUT',
  });
  assert.throws(() => copyMarkers([{ timeMs: 1, price: 1, size: 0 }]), { code: 'INVALID_INPUT' });
});

test('markers are sorted by time for drawing', () => {
  const sorted = copyMarkers([
    { timeMs: 30, price: 1 },
    { timeMs: 10, price: 2, color: '#22aa66' },
    { timeMs: 20, price: 3 },
  ]);
  assert.deepEqual(
    sorted.map(m => m.timeMs),
    [10, 20, 30],
  );
});

test('big trades is a registered indicator that draws bubbles, not a series', async () => {
  const { IndicatorRegistry, bigTrades } = await import('../src/indicators.ts');
  const plugin = new IndicatorRegistry().create('big-trades', { minSize: 50, maxRadius: 30 }, 'bt');
  assert.deepEqual(plugin.bubbles, { minSize: 50, maxRadius: 30 });
  assert.equal(plugin.pane, 'profile');
  assert.throws(() => bigTrades(0), { code: 'INVALID_INPUT' });
});

test('only draggable lines are grabbed, nearest first, within the plot', async () => {
  const { hitPriceLine } = await import('../src/chart-overlays.ts');
  // y = 1000 - price, plot from x 0 to 500.
  const g = { left: 0, plotWidth: 500, y: (price: number) => 1000 - price } as never;
  const lines = [
    { price: 400, id: 'entry', drag: 'copy' as const },
    { price: 404, id: 'stop', drag: 'move' as const },
    { price: 402 },
  ];
  assert.equal(hitPriceLine(lines, g, 100, 1000 - 401)?.id, 'entry');
  assert.equal(hitPriceLine(lines, g, 100, 1000 - 403.5)?.id, 'stop');
  assert.equal(hitPriceLine(lines, g, 100, 1000 - 420), null);
  assert.equal(hitPriceLine(lines, g, 600, 1000 - 400), null);
});

test('a draggable line needs an id and a known mode', () => {
  assert.throws(() => copyPriceLines([{ price: 1, drag: 'move' }]), { code: 'INVALID_INPUT' });
  assert.throws(() => copyPriceLines([{ price: 1, id: 'a', drag: 'fling' as never }]), {
    code: 'INVALID_INPUT',
  });
  assert.equal(copyPriceLines([{ price: 1, id: 'a', drag: 'copy' }])[0]!.drag, 'copy');
});

test('a click inside a drawn × box is found, and a closable line needs an id', async () => {
  const { hitCloseBox } = await import('../src/chart-overlays.ts');
  const boxes = [{ id: 'order:1', x: 100, y: 50, width: 20, height: 20 }];
  assert.equal(hitCloseBox(boxes, 110, 60)?.id, 'order:1');
  assert.equal(hitCloseBox(boxes, 95, 60), null);
  assert.throws(() => copyPriceLines([{ price: 1, closable: true }]), { code: 'INVALID_INPUT' });
});
