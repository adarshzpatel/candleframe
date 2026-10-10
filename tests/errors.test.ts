import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartError, isChartError, toChartError } from '../src/errors.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';

function runtime() {
  const chart = new ChartRuntime(createSimulatedFeed({ seed: 1 }), []);
  chart.start();
  chart.execute({ type: 'feed.pause', paused: true });
  return chart;
}

test('revision conflicts report the expected and actual revisions', () => {
  const chart = runtime();
  const error = assertThrowsChartError(
    () => chart.execute({ type: 'viewport.reset' }, 999),
    'REVISION_CONFLICT',
  );
  assert.deepEqual(error.details, { expected: 999, actual: chart.inspect().documentRevision });
  chart.dispose();
});

test('validation errors carry a path and serialize to JSON', () => {
  const chart = runtime();
  const error = assertThrowsChartError(
    () => chart.execute({ type: 'priceScale.set', minPrice: 10, maxPrice: 5 }),
    'INVALID_PRICE_SCALE',
  );
  assert.equal(error.path, 'priceScale');
  assert.equal(JSON.parse(JSON.stringify(error)).code, 'INVALID_PRICE_SCALE');
  const missing = assertThrowsChartError(
    () => chart.execute({ type: 'drawing.remove', id: 'nope' }),
    'DRAWING_NOT_FOUND',
  );
  assert.deepEqual(missing.details, { id: 'nope' });
  chart.dispose();
});

test('toChartError keeps codes from legacy messages and wraps unknown values', () => {
  assert.equal(toChartError(new Error('CANDLE_GAP: reconnect')).code, 'CANDLE_GAP');
  assert.equal(toChartError(new Error('socket closed')).code, 'UNEXPECTED_ERROR');
  assert.equal(toChartError('boom').message, 'UNEXPECTED_ERROR: boom');
  const original = new ChartError('X');
  assert.equal(toChartError(original), original);
  assert.ok(isChartError(original, 'X'));
  assert.ok(!isChartError(original, 'Y'));
});

function assertThrowsChartError(run: () => unknown, code: string): ChartError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ChartError, `expected ChartError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${code}`);
}
