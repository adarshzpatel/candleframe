import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometryForRanges } from '../src/geometry.ts';
import { ScaleMotion } from '../src/scale-motion.ts';

const start = { fromMs: 0, toMs: 180 * 60000, minPrice: 90, maxPrice: 110 };
const target = { fromMs: 90 * 60000, toMs: 180 * 60000, minPrice: 80, maxPrice: 120 };

test('scale easing moves both axes continuously, preserves zoom anchors, and settles exactly', () => {
  const motion = new ScaleMotion(start);
  motion.retarget(target, 0);
  const frames = [0, 15, 30, 45, 60, 75, 90].map(time => motion.sample(time));
  assert.deepEqual(frames[0], start);
  assert.deepEqual(frames.at(-1), target);
  const steps = frames.slice(1).map((frame, i) => frame.fromMs - frames[i].fromMs);
  assert.ok(steps.every((step, i) => step > 0 && (i === 0 || step < steps[i - 1])));
  for (const frame of frames) {
    const geometry = geometryForRanges(frame, 800, 500);
    assert.equal(geometry.x(target.toMs), geometry.left + geometry.plotWidth);
    assert.equal(geometry.y(100), geometry.top + geometry.plotHeight / 2);
    const anchor = geometry.anchor(240, 200);
    assert.ok(Math.abs(geometry.x(anchor.timeMs) - 240) < 1e-6);
    assert.ok(Math.abs(geometry.y(anchor.price) - 200) < 1e-6);
  }
  assert.equal(motion.active, false);
});

test('continuous axis resizing catches up within 40 ms without a release jump', () => {
  const motion = new ScaleMotion(start);
  for (const now of [0, 8, 16, 24, 32]) motion.retarget({ ...target, minPrice: 80 - now }, now, 40);
  const expected = { ...target, minPrice: 48 };
  const near = motion.sample(48);
  assert.ok(Math.abs(near.minPrice - expected.minPrice) < 10);
  assert.deepEqual(motion.sample(72), expected);
  assert.equal(motion.active, false);
});

test('repeated wheel targets continue from the current position without restarting for unchanged data', () => {
  const motion = new ScaleMotion(start);
  motion.retarget(target, 0);
  const midway = motion.sample(60);
  const next = { ...start, fromMs: -500000, minPrice: 10, maxPrice: 1000 };
  motion.retarget(next, 60);
  assert.deepEqual(motion.sample(60), midway);
  // Feed/status publications with identical geometry must not prolong the animation.
  for (const t of [80, 120, 180, 240]) motion.retarget({ ...next }, t);
  assert.deepEqual(motion.sample(240), next);
  assert.equal(motion.active, false);
  assert.deepEqual(start, { fromMs: 0, toMs: 10800000, minPrice: 90, maxPrice: 110 });
});

test('scale transitions are clock based and stay valid across a large zoom and a suspended frame', () => {
  const destination = { fromMs: 20000000, toMs: 152000000, minPrice: 0.01, maxPrice: 0.03 };
  function replay(hz: number) {
    const motion = new ScaleMotion(start);
    motion.retarget(destination, 0);
    for (let t = 1000 / hz; t < 100; t += 1000 / hz) {
      const ranges = motion.sample(t);
      assert.ok(ranges.toMs > ranges.fromMs && ranges.minPrice > 0 && ranges.maxPrice > ranges.minPrice);
    }
    const halfway = motion.sample(100);
    assert.deepEqual(motion.sample(10000), destination);
    assert.equal(motion.active, false);
    return halfway;
  }
  assert.deepEqual(replay(30), replay(120));
});
