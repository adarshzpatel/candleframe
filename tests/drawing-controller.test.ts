import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingController } from '../src/drawing-controller.ts';
import { hitDrawings, renderDrawings } from '../src/drawing-scene.ts';
import { positionHandles, positionMetrics } from '../src/position-drawing.ts';
import { DrawingRegistry } from '../src/drawing-tools.ts';
import { createGeometry } from '../src/geometry.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { DrawingContext } from '../src/drawing-types.ts';
import type { FeedEvent } from '../src/types.ts';

function fixture() {
  let emit!: (event: FeedEvent) => void;
  const runtime = new ChartRuntime({
    descriptor: createSimulatedFeed({ seed: 42 }).descriptor,
    connect(callback) {
      emit = callback;
      callback({
        type: 'candles.history',
        candles: [0, 1, 2].map(i => ({
          timeMs: i * 60000,
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1,
        })),
      });
      return { setPaused() {}, dispose() {} };
    },
  });
  runtime.start();
  runtime.execute({
    type: 'viewport.set',
    fromMs: 0,
    toMs: 180 * 60000,
    priceScale: { mode: 'manual', minPrice: 50, maxPrice: 150 },
  });
  const errors: Error[] = [];
  const controller = new DrawingController({
    registry: runtime.drawingRegistry,
    state: () => runtime.state(),
    execute: (command, rev) => runtime.execute(command, rev),
    changed() {},
    error: error => errors.push(error),
  });
  runtime.subscribe(state => controller.sync(state));
  const context: DrawingContext = {
    geometry: createGeometry(runtime.state(), 1000, 600),
    intervalMs: 60000,
    formatPrice: p => p.toFixed(2),
  };
  return { runtime, controller, context, errors, emit };
}
const a = { x: 200, y: 200 },
  b = { x: 500, y: 300 },
  c = { x: 650, y: 250 };

test('positions place in one click with valid mirrored levels and retain the existing document format', () => {
  const { runtime, controller, context, errors } = fixture();
  for (const type of ['long-position', 'short-position']) {
    controller.setTool(type);
    const revision = runtime.inspect().documentRevision;
    controller.down(a, context);
    controller.up(a, context);
    const drawing = runtime.exportDocument().drawings.at(-1)!;
    assert.equal(drawing.points.length, 3);
    assert.equal(controller.currentTool, 'cursor');
    assert.equal(runtime.inspect().documentRevision, revision + 1);
    assert.ok(positionMetrics(drawing).risk > 0);
    assert.ok(Math.abs(positionMetrics(drawing).ratio - 1) < 1e-10);
    assert.equal(drawing.points[1].timeMs, drawing.points[2].timeMs);
    assert.deepEqual(runtime.drawingRegistry.normalize(JSON.parse(JSON.stringify(drawing))), drawing);
    runtime.execute({ type: 'history.undo' });
    assert.equal(runtime.exportDocument().drawings.length, 0);
  }
  assert.deepEqual(errors, []);
  runtime.dispose();
});

test('position level handles constrain one price, width handles constrain time, and drags commit once', () => {
  const { runtime: r, controller: d, context: ctx, errors } = fixture();
  for (const type of ['long-position', 'short-position']) {
    d.setTool(type);
    d.down({ x: 300, y: 270 }, ctx);
    const original = r.exportDocument().drawings.at(-1)!;
    for (const id of ['target', 'stop', 'entry', 'extent']) {
      const handle = positionHandles(original, ctx).find(h => h.id === id)!;
      assert.equal(hitDrawings([original], r.drawingRegistry, ctx, handle.at, original.id)?.handle, id);
      assert.equal(d.cursor(handle.at, ctx), id === 'extent' ? 'ew-resize' : 'ns-resize');
      const revision = r.inspect().documentRevision;
      const end = { x: handle.at.x + 90, y: handle.at.y - 25 };
      d.down(handle.at, ctx);
      d.move(end, ctx);
      assert.equal(r.inspect().documentRevision, revision);
      d.up(end, ctx);
      const changed = r.exportDocument().drawings.at(-1)!;
      assert.equal(r.inspect().documentRevision, revision + 1);
      if (id === 'extent') {
        assert.deepEqual(
          changed.points.map(p => p.price),
          original.points.map(p => p.price),
        );
        assert.equal(changed.points[0].timeMs, original.points[0].timeMs);
        assert.equal(changed.points[1].timeMs, changed.points[2].timeMs);
      } else {
        const index = ['entry', 'target', 'stop'].indexOf(id);
        assert.deepEqual(
          changed.points.map(p => p.timeMs),
          original.points.map(p => p.timeMs),
        );
        assert.ok(
          changed.points.every((point, i) => i === index || point.price === original.points[i].price),
        );
      }
      r.execute({ type: 'history.undo' });
      assert.deepEqual(r.exportDocument().drawings.at(-1), original);
    }
    // Crossing entry clamps to a valid distance instead of failing on release.
    const target = positionHandles(original, ctx).find(h => h.id === 'target')!;
    const crossing = {
      x: target.at.x,
      y: ctx.geometry.y(original.points[0].price) + (type === 'long-position' ? 150 : -150),
    };
    d.down(target.at, ctx);
    d.up(crossing, ctx);
    assert.ok(positionMetrics(r.exportDocument().drawings.at(-1)!).reward > 0);
    r.execute({ type: 'history.undo' });
    const body = {
      x: ctx.geometry.x(original.points[0].timeMs) + 30,
      y: (ctx.geometry.y(original.points[0].price) + ctx.geometry.y(original.points[1].price)) / 2,
    };
    d.down(body, ctx);
    d.up({ x: body.x + 20, y: body.y + 12 }, ctx);
    const moved = r.exportDocument().drawings.at(-1)!;
    assert.ok(Math.abs(positionMetrics(moved).ratio - positionMetrics(original).ratio) < 1e-10);
  }
  assert.deepEqual(errors, []);
  r.dispose();
});

test('multi-click construction previews without history and commits once, including three-point tools', () => {
  const f = fixture(),
    { controller: d, runtime: r, context: ctx } = f;
  for (const [type, points] of [
    ['trendline', [a, b]],
    ['fib-extension', [a, b, c]],
  ] as const) {
    d.setTool(type);
    const revision = r.inspect().documentRevision,
      count = r.exportDocument().drawings.length;
    points.forEach((point, i) => {
      d.down(point, ctx);
      d.up(point, ctx);
      if (i < points.length - 1) {
        d.move({ x: point.x + 20, y: point.y + 20 }, ctx);
        assert.equal(r.inspect().documentRevision, revision);
      }
    });
    assert.equal(r.inspect().documentRevision, revision + 1);
    assert.equal(r.exportDocument().drawings.length, count + 1);
    assert.equal(r.exportDocument().drawings.at(-1)!.points.length, points.length);
    assert.equal(d.currentTool, 'cursor');
    r.execute({ type: 'history.undo' });
    assert.equal(r.exportDocument().drawings.length, count);
    r.execute({ type: 'history.redo' });
    assert.equal(r.exportDocument().drawings.length, count + 1);
  }
  assert.deepEqual(f.errors, []);
  r.dispose();
});

test('body drags move every anchor once, preserve spans and undo as one edit', () => {
  const { runtime: r, controller: d, context: ctx, errors } = fixture();
  d.setTool('rectangle');
  d.down(a, ctx);
  d.down(b, ctx);
  const initial = r.exportDocument().drawings[0];
  d.select(initial.id);
  const rev = r.inspect().documentRevision;
  d.down({ x: 350, y: 250 }, ctx);
  for (let i = 1; i <= 15; i++) d.move({ x: 350 + i * 2, y: 250 + i }, ctx);
  assert.equal(r.inspect().documentRevision, rev);
  d.up({ x: 380, y: 265 }, ctx);
  const moved = r.exportDocument().drawings[0];
  assert.equal(r.inspect().documentRevision, rev + 1);
  assert.equal(
    moved.points[1].price - moved.points[0].price,
    initial.points[1].price - initial.points[0].price,
  );
  assert.ok(
    moved.points.every(
      (p, i) => Math.abs(ctx.geometry.x(p.timeMs) - ctx.geometry.x(initial.points[i].timeMs) - 30) < 1e-6,
    ),
  );
  assert.ok(
    moved.points.every(
      (p, i) => Math.abs(ctx.geometry.y(p.price) - ctx.geometry.y(initial.points[i].price) - 15) < 1e-6,
    ),
  );
  r.execute({ type: 'history.undo' });
  assert.deepEqual(r.exportDocument().drawings[0], initial);
  assert.deepEqual(errors, []);
  r.dispose();
});

test('cancel, conflicting commands and market replacement discard previews without overwriting newer work', () => {
  const { runtime: r, controller: d, context: ctx, emit } = fixture();
  d.setTool('triangle');
  d.down(a, ctx);
  emit({ type: 'stream.status', status: 'stale', message: 'Waiting for candle updates' });
  assert.equal(d.interacting, true);
  r.execute({ type: 'layer.set', layer: 'volume', visible: false });
  assert.equal(d.interacting, false);
  assert.equal(r.exportDocument().drawings.length, 0);
  d.down(a, ctx);
  d.cancel();
  d.up(b, ctx);
  assert.equal(r.exportDocument().drawings.length, 0);
  d.down(a, ctx);
  r.replaceFeed(createSimulatedFeed({ symbol: 'ETH/USD' }));
  assert.equal(d.interacting, false);
  assert.equal(d.currentTool, 'cursor');
  r.dispose();
});

test('freehand releases one bounded drawing and a path finishes only on explicit completion', () => {
  const { runtime: r, controller: d, context: ctx } = fixture();
  d.setTool('brush');
  d.down(a, ctx);
  for (let i = 0; i < 1300; i++) d.move({ x: 200 + i * 4, y: 200 + (i % 20) }, ctx);
  assert.equal(r.exportDocument().drawings.length, 0);
  d.up(b, ctx);
  assert.equal(r.exportDocument().drawings[0].points.length, 1024);
  d.setTool('polyline');
  d.down(a, ctx);
  d.down(b, ctx);
  d.move(c, ctx);
  assert.equal(r.exportDocument().drawings.length, 1);
  d.finish();
  assert.equal(r.exportDocument().drawings[1].points.length, 2);
  r.dispose();
});

test('shared scenes hit visible topmost shapes, prioritize handles, and respect locking and hiding', () => {
  const { runtime: r, controller: d, context: ctx } = fixture();
  for (const type of ['rectangle', 'ellipse']) {
    d.setTool(type);
    d.down(a, ctx);
    d.down(b, ctx);
  }
  let drawings = r.exportDocument().drawings;
  const registry = new DrawingRegistry();
  assert.equal(hitDrawings(drawings, registry, ctx, { x: 350, y: 250 }, null)?.drawing.type, 'ellipse');
  assert.equal(hitDrawings(drawings, registry, ctx, a, drawings[0].id)?.handle, 0);
  d.select(drawings[1].id);
  r.execute({ type: 'drawing.update', id: drawings[1].id, patch: { locked: true } });
  const rev = r.inspect().documentRevision;
  assert.equal(d.down({ x: 350, y: 250 }, ctx), true);
  d.move(c, ctx);
  d.up(c, ctx);
  assert.equal(r.inspect().documentRevision, rev);
  r.execute({ type: 'drawing.update', id: drawings[1].id, patch: { visible: false } });
  drawings = r.exportDocument().drawings;
  assert.equal(hitDrawings(drawings, registry, ctx, { x: 350, y: 250 }, null)?.drawing.type, 'rectangle');
  d.configure({ hidden: true });
  assert.equal(d.visible().length, 0);
  r.dispose();
});

test('magnet uses displayed OHLC locations and saved text stays plain data', () => {
  const { runtime: r, controller: d, context: ctx } = fixture();
  d.configure({ magnet: 'strong', text: '<script>hello</script>' });
  d.setTool('text');
  const p = { x: ctx.geometry.x(60000 + 30000) + 2, y: ctx.geometry.y(110) + 2 };
  d.down(p, ctx);
  const drawing = r.exportDocument().drawings[0];
  assert.deepEqual(drawing.points, [{ timeMs: 90000, price: 110 }]);
  assert.equal(drawing.text, '<script>hello</script>');
  r.dispose();
});

test('a stationary handle selection neither snaps its anchor nor records an edit', () => {
  const { runtime: r, controller: d, context: ctx } = fixture();
  d.setTool('trendline');
  d.down(a, ctx);
  d.down(b, ctx);
  const initial = r.exportDocument().drawings[0],
    rev = r.inspect().documentRevision;
  d.configure({ magnet: 'strong' });
  const near = { x: a.x + 6, y: a.y };
  d.down(near, ctx);
  d.up(near, ctx);
  assert.equal(r.inspect().documentRevision, rev);
  assert.deepEqual(r.exportDocument().drawings[0], initial);
  d.configure({ magnet: 'off' });
  d.down(near, ctx);
  d.move({ x: near.x + 20, y: near.y }, ctx);
  d.up(near, ctx);
  assert.equal(r.inspect().documentRevision, rev);
  d.configure({ magnet: 'off' });
  d.down(near, ctx);
  d.up({ x: near.x + 20, y: near.y }, ctx);
  const moved = r.exportDocument().drawings[0];
  assert.ok(Math.abs(ctx.geometry.x(moved.points[0].timeMs) - a.x - 20) < 1e-6);
  r.dispose();
});

test('unavailable tools have no invisible handles, and dense paths expose only endpoint handles', () => {
  const { runtime: r, context: ctx } = fixture(),
    registry = new DrawingRegistry();
  const unknown = registry.normalize({
    id: 'unknown',
    type: 'custom:missing',
    points: [ctx.geometry.anchor(a.x, a.y)],
  });
  assert.equal(hitDrawings([unknown], registry, ctx, a, unknown.id), null);
  const brush = registry.normalize({
    id: 'brush',
    type: 'brush',
    points: Array.from({ length: 12 }, (_, i) => ctx.geometry.anchor(a.x + i * 15, a.y)),
  });
  assert.equal(hitDrawings([brush], registry, ctx, a, brush.id)?.handle, 0);
  assert.equal(hitDrawings([brush], registry, ctx, { x: a.x + 90, y: a.y }, brush.id)?.handle, null);
  r.dispose();
});

test('fill-only primitives do not stroke and selection handles render above every drawing', () => {
  const { runtime: r, context } = fixture(),
    registry = new DrawingRegistry();
  const rectangle = registry.normalize({
    id: 'box',
    type: 'rectangle',
    points: [context.geometry.anchor(a.x, a.y), context.geometry.anchor(b.x, b.y)],
  });
  const events: string[] = [];
  const canvas = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      events.push('fill');
    },
    stroke() {
      events.push('stroke');
    },
    setLineDash() {},
    arc() {
      events.push('handle');
    },
    fillRect() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  renderDrawings(canvas, [rectangle, { ...rectangle, id: 'cover' }], registry, context, rectangle.id);
  assert.equal(events.filter(event => event === 'stroke').length, 4); // Two outlines, two selected handles.
  assert.deepEqual(events.slice(-6), ['handle', 'fill', 'stroke', 'handle', 'fill', 'stroke']);
  r.dispose();
});
