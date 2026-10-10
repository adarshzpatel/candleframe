import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PanMotion } from '../src/pan-motion.ts';
import { panPriceScale, panTimeScale } from '../src/scales.ts';

const options = { smooth: true, constrain: (point: { x: number; y: number }) => point };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('drag follows both axes without overshoot, independently of display refresh rate', () => {
  function replay(hz: number) {
    const motion = new PanMotion(0, options);
    motion.move(100, -50, 20);
    for (let t = 20 + 1000 / hz; t < 120; t += 1000 / hz) motion.sample(t);
    const following = motion.sample(120);
    assert.ok(following.x > 99 && following.x <= 100);
    assert.ok(following.y < -49 && following.y >= -50);
    motion.release(120); // Paused for 100 ms: catch up without an extra fling.
    const settled = motion.sample(500);
    assert.deepEqual(settled, { x: 100, y: -50 });
    assert.equal(motion.active, false);
    return following;
  }
  const slow = replay(30), normal = replay(60), fast = replay(120);
  close(slow.x, normal.x); close(normal.x, fast.x);
  close(slow.y, fast.y);
});

test('a flick decelerates, travels at most 60 pixels and settles in 180 ms', () => {
  const motion = new PanMotion(0, options);
  motion.move(30, 15, 20);
  motion.move(30, 15, 40);
  motion.release(40);
  const points = [40, 85, 130, 175, 220].map(time => motion.sample(time));
  const steps = points.slice(1).map((point, i) => point.x - points[i].x);
  assert.ok(steps.every(step => step > 0));
  assert.ok(steps.every((step, i) => i === 0 || step < steps[i - 1]));
  const end = points.at(-1)!;
  assert.ok(end.x > 60 && end.y > 30);
  assert.ok(Math.hypot(end.x - 60, end.y - 30) <= 60 + 1e-6);
  assert.deepEqual(motion.sample(10000), end);
  assert.equal(motion.active, false);
});

test('held motion reaches most of a pointer step in one frame and catches up within 50 ms', () => {
  const motion = new PanMotion(0, options);
  motion.move(100, 0, 16);
  const first = motion.sample(16 + 1000 / 60);
  assert.ok(first.x >= 75 && first.x < 100);
  assert.ok(motion.sample(66).x >= 98);
});

test('cancel freezes motion and a new grab starts without old velocity or queued distance', () => {
  const old = new PanMotion(0, options);
  old.move(120, 40, 40);
  old.release(40);
  const grabbed = old.sample(80);
  old.cancel();
  assert.deepEqual(old.sample(10000), grabbed);
  old.move(10, 10, 10010); old.release(10020);
  assert.deepEqual(old.sample(11000), grabbed);
  const next = new PanMotion(80, options);
  next.move(-10, 0, 100); next.release(200);
  assert.deepEqual(next.sample(400), { x: -10, y: 0 });
});

test('direct mode has no lag or release travel for opt-out and reduced motion', () => {
  const motion = new PanMotion(0, { ...options, smooth: false });
  motion.move(80, -20, 16);
  assert.deepEqual(motion.sample(16), { x: 80, y: -20 });
  motion.release(16);
  assert.deepEqual(motion.sample(1000), { x: 80, y: -20 });
  assert.equal(motion.active, false);
});

test('reversing a flick reverses its momentum instead of retaining the old direction', () => {
  const motion = new PanMotion(0, options);
  motion.move(80, 0, 20);
  motion.move(-30, 0, 40);
  motion.release(40);
  assert.ok(motion.sample(360).x < 50);
});

test('wide-zoom history edges and the price floor clamp glide and discard pointer overshoot', () => {
  const minute = 60_000, width = 1000, height = 400;
  const span = 2200 * minute, min = 90, max = 110;
  const history = { firstMs: 0, lastMs: 359 * minute, intervalMs: minute };
  const motion = new PanMotion(0, {
    smooth: true,
    constrain(point) {
      const time = panTimeScale(0, span, point.x, width, history);
      const price = panPriceScale(min, max, point.y, height, 0.01);
      return { x: -time.fromMs / span * width, y: (price.minPrice - min) / (max - min) * height };
    },
  });
  motion.move(10000, -10000, 20);
  const atEdge = motion.sample(1000);
  close(atEdge.x, (2200 - 5) / 2200 * width);
  close(min + atEdge.y / height * (max - min), 0.01);
  motion.move(-10, 10, 1020);
  const reversed = motion.sample(1500);
  close(reversed.x, atEdge.x - 10);
  close(reversed.y, atEdge.y + 10);
  motion.move(10, -10, 1520);
  motion.release(1520);
  for (const t of [1540, 1600, 1700, 1840]) {
    const p = motion.sample(t);
    assert.ok(p.x <= atEdge.x && p.y >= atEdge.y);
  }
  assert.equal(motion.active, false);
});
