import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CandleMotion } from '../src/candle-motion.ts';
import type { Candle } from '../src/types.ts';

const bar = (close: number, timeMs = 0, high = Math.max(100, close), low = Math.min(100, close)): Candle => ({
  timeMs,
  open: 100,
  high,
  low,
  close,
  volume: close,
});

test('ticks inside one bar glide from the displayed values and settle exactly', () => {
  const motion = new CandleMotion();
  motion.retarget(bar(100), 0, 180);
  assert.equal(motion.active, false, 'the first candle appears without a glide');
  const target = bar(110);
  motion.retarget(target, 1000, 180);
  const halfway = motion.sample(1090)!;
  assert.ok(halfway.close > 100 && halfway.close < 110);
  assert.ok(halfway.high >= Math.max(halfway.open, halfway.close), 'the wick still covers the body');
  // A second tick mid-glide starts from where the candle is shown, not from the old target.
  motion.retarget(bar(105, 0, 110), 1090, 180);
  assert.ok(Math.abs(motion.sample(1090)!.close - halfway.close) < 1e-9);
  assert.equal(motion.sample(1270)!.close, 105);
  assert.equal(motion.active, false);
});

test('a new bar, a zero duration or a cleared series snaps', () => {
  const motion = new CandleMotion();
  motion.retarget(bar(100), 0, 180);
  motion.retarget(bar(120, 60_000), 10, 180);
  assert.equal(motion.sample(10)!.close, 120);
  motion.retarget(bar(130, 60_000), 20, 0);
  assert.equal(motion.sample(20)!.close, 130);
  motion.retarget(undefined, 30, 180);
  assert.equal(motion.sample(30), null);
});
