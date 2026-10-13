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
