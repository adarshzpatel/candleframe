import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingController } from '../src/drawing-controller.ts';
import { hitDrawings } from '../src/drawing-scene.ts';
import { DrawingRegistry } from '../src/drawing-tools.ts';
import { shapesIcons, tableCells } from '../src/drawing-tools-shapes.ts';
import { createGeometry, geometryForRanges } from '../src/geometry.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { Drawing, DrawingContext, DrawingPoint, DrawingPrimitive } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const g = context.geometry;
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, points: { timeMs: number; price: number }[], extras: Partial<Drawing> = {}) =>
  registry.normalize({ id: 'test', type, points, ...extras });
const paths = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Extract<DrawingPrimitive, { kind: 'path' }> => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Extract<DrawingPrimitive, { kind: 'text' }> => p.kind === 'text');
const at = (p: { timeMs: number; price: number }): DrawingPoint => ({ x: g.x(p.timeMs), y: g.y(p.price) });
const near = (a: DrawingPoint, b: DrawingPoint, tolerance = 0.5) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

const TOOLS = {
  Shapes: ['rotated-rectangle', 'circle', 'path', 'arc', 'curve', 'double-curve'],
  Arrows: ['arrow-marker', 'arrow-mark-up', 'arrow-mark-down'],
  'Text and notes': [
    'note',
    'price-note',
    'pin',
    'signpost',
    'flag-mark',
    'comment',
    'table',
    'anchored-text',
    'anchored-note',
  ],
};

test('shape, arrow and note tools are registered in their menu sections with icons', () => {
  for (const [section, types] of Object.entries(TOOLS))
    for (const type of types) {
      const tool = registry.get(type);
      assert.ok(tool, type);
      assert.equal(tool.section, section, type);
      assert.equal(tool.group, section === 'Text and notes' ? 'Annotations' : 'Shapes', type);
      assert.match(shapesIcons[type], /^<(path|circle|rect)/, type);
    }
  const points = Object.fromEntries(
    Object.values(TOOLS)
      .flat()
      .map(type => [type, registry.get(type)!.points]),
  );
  assert.deepEqual(points, {
    'rotated-rectangle': 3,
    circle: 2,
    path: 'path',
    arc: 3,
    curve: 3,
    'double-curve': 3,
    'arrow-marker': 2,
    'arrow-mark-up': 1,
    'arrow-mark-down': 1,
    note: 1,
    'price-note': 2,
    pin: 1,
    signpost: 1,
    'flag-mark': 1,
    comment: 1,
    table: 1,
    'anchored-text': 1,
    'anchored-note': 1,
  });
});

test('text tools open the editor and share the text settings with a 20% tinted background', () => {
  for (const type of ['note', 'pin', 'signpost', 'comment', 'table', 'anchored-text', 'anchored-note']) {
    const tool = registry.get(type)!;
    assert.equal(tool.editableText, true, type);
    const keys = tool.settings!.map(s => s.key);
    for (const key of ['bold', 'italic', 'border', 'background', 'backgroundColor', 'backgroundOpacity'])
      assert.ok(keys.includes(key), `${type} ${key}`);
    assert.equal(tool.settings!.find(s => s.key === 'backgroundOpacity')!.default, 0.2);
    assert.equal(tool.settings!.find(s => s.key === 'backgroundColor')!.default, '');
  }
  assert.equal(registry.get('anchored-text')!.settings!.find(s => s.key === 'background')!.default, false);
  const bold = drawing('anchored-text', [point(50, 150)], {
    text: 'Bold',
    options: { bold: true, background: true },
  });
  const [label] = texts(registry.project(bold, context));
  assert.equal(label.bold, true);
  assert.equal(label.plain, false);
  assert.equal(label.background, bold.style.color);
  assert.equal(label.backgroundOpacity, 0.2);
});

test('a rotated rectangle keeps its first side and takes its width from the third point', () => {
  const d = drawing('rotated-rectangle', [point(20, 120), point(60, 160), point(70, 120)]);
  const [fill, outline] = paths(registry.project(d, context));
  assert.equal(fill.fill, d.style.color);
  const [a, b, c, e] = outline.points;
  assert.ok(near(a, at(d.points[0])) && near(b, at(d.points[1])));
  const dot = (u: DrawingPoint, v: DrawingPoint) => u.x * v.x + u.y * v.y;
  const side = { x: b.x - a.x, y: b.y - a.y },
    across = { x: c.x - b.x, y: c.y - b.y };
  assert.ok(Math.abs(dot(side, across)) < 1e-6);
  assert.ok(near({ x: e.x + side.x, y: e.y + side.y }, c));
  // The third point lies on the far side.
  const p = at(d.points[2]),
    length = Math.hypot(side.x, side.y);
  const distance = Math.abs((p.x - a.x) * -side.y + (p.y - a.y) * side.x) / length;
  assert.ok(Math.abs(Math.hypot(across.x, across.y) - distance) < 1e-6);
  const plain = drawing('rotated-rectangle', d.points, { options: { background: false } });
  assert.equal(paths(registry.project(plain, context)).length, 1);
});

test('a circle is centred on its first point and reaches its second', () => {
  const d = drawing('circle', [point(50, 150), point(70, 160)]);
  const outline = paths(registry.project(d, context)).at(-1)!;
  const center = at(d.points[0]),
    r = Math.hypot(at(d.points[1]).x - center.x, at(d.points[1]).y - center.y);
  for (const p of outline.points) assert.ok(Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r) < 1e-6);
  assert.equal(outline.closed, true);
});

test('a path ends in an arrow by default and can mark either end', () => {
  const points = [point(10, 120), point(30, 160), point(50, 130), point(50, 130)];
  const plain = paths(registry.project(drawing('path', points), context));
  assert.equal(plain.length, 2);
  // A repeated last point still aims the head along the last real segment.
  assert.ok(near(plain[1].points[1], at(points[3])));
  const both = drawing('path', points, { options: { leftEnd: 'arrow', rightEnd: 'normal' } });
  const heads = paths(registry.project(both, context));
  assert.equal(heads.length, 2);
  assert.ok(near(heads[1].points[1], at(points[0])));
});

test('arcs, curves and double curves pass through their anchors', () => {
  const [a, b, c] = [point(20, 120), point(80, 120), point(50, 170)];
  const arc = paths(registry.project(drawing('arc', [a, b, c]), context));
  const outline = arc.at(-1)!.points;
  assert.ok(near(outline[0], at(a)) && near(outline.at(-1)!, at(b)));
  assert.ok(near(outline[32], at(c)));
  assert.equal(arc[0].closed, true);
  assert.ok(arc[0].fill);

  const curve = paths(registry.project(drawing('curve', [a, b, c]), context))[0].points;
  assert.ok(near(curve[0], at(a)) && near(curve.at(-1)!, at(b)) && near(curve[24], at(c)));

  const double = paths(registry.project(drawing('double-curve', [a, b, point(35, 150)]), context))[0].points;
  const middle = double[32],
    peak = double[16],
    trough = double[48];
  assert.ok(near(double[0], at(a)) && near(double.at(-1)!, at(b)));
  assert.ok(near(peak, at(point(35, 150))));
  assert.ok(near({ x: 2 * middle.x - peak.x, y: 2 * middle.y - peak.y }, trough));
});

test('arrow marks snap under the low or over the high of the bar they mark', () => {
  const candles = [0, 10, 20].map(timeMs => ({
    timeMs,
    open: 150,
    high: 170,
    low: 130,
    close: 160,
    volume: 1,
  }));
  const c = { ...context, candles };
  assert.deepEqual(registry.get('arrow-mark-up')!.create!(point(14, 155), c), [point(15, 130)]);
  assert.deepEqual(registry.get('arrow-mark-down')!.create!(point(14, 155), c), [point(15, 170)]);
  assert.deepEqual(registry.get('arrow-mark-up')!.create!(point(55, 155), c), [point(55, 155)]);

  const up = drawing('arrow-mark-up', [point(15, 130)], { text: 'Buy' });
  const [shape] = paths(registry.project(up, context));
  const [label] = texts(registry.project(up, context));
  const tip = at(up.points[0]);
  assert.equal(shape.fill, '#089981');
  assert.ok(shape.points.every(p => p.y >= tip.y));
  assert.ok(label.at.y > Math.max(...shape.points.map(p => p.y)));
  const down = drawing('arrow-mark-down', [point(15, 170)], { options: { arrowColor: '#123456' } });
  const [downShape] = paths(registry.project(down, context));
  assert.equal(downShape.fill, '#123456');
  assert.ok(downShape.points.every(p => p.y <= at(down.points[0]).y));
});

test('an arrow marker is a filled broad arrow with text at its tail', () => {
  const d = drawing('arrow-marker', [point(20, 120), point(60, 160)], { text: 'Go' });
  const [shape] = paths(registry.project(d, context));
  assert.equal(shape.closed, true);
  assert.equal(shape.opacity, 1);
  assert.ok(near(shape.points[3], at(d.points[1])));
  const [label] = texts(registry.project(d, context));
  assert.equal(label.text, 'Go');
  assert.ok(label.at.x < at(d.points[0]).x);
});

test('notes and pins show their text only while hovered or selected', () => {
  for (const type of ['note', 'pin', 'anchored-note']) {
    const d = drawing(type, [point(50, 150)], { text: 'Hidden' });
    assert.equal(texts(registry.project(d, context)).length, 0, type);
    assert.equal(texts(registry.project(d, { ...context, hovered: true }))[0].text, 'Hidden');
    assert.equal(texts(registry.project(d, { ...context, selected: true }))[0].text, 'Hidden');
    // The marker alone is enough to hover or select the note.
    const hit = hitDrawings([d], registry, context, { x: g.x(50), y: g.y(150) - 12 }, null);
    assert.equal(hit?.drawing.id, 'test', type);
  }
});

test('a price note joins its price to a label and tags the price axis', () => {
  const d = drawing('price-note', [point(40, 150), point(60, 170)]);
  const primitives = registry.project(d, context);
  assert.deepEqual(
    primitives.find(p => p.kind === 'axis'),
    { kind: 'axis', axis: 'price', value: 150, color: d.style.color },
  );
  assert.equal(texts(primitives)[0].text, '150.00');
  assert.equal(texts(registry.project({ ...d, text: 'Target' }, context))[0].text, 'Target\n150.00');
  assert.ok(near(paths(primitives)[0].points[0], at(d.points[0])));
});

test('signposts, flags and comments sit above their anchor', () => {
  for (const type of ['signpost', 'flag-mark', 'comment']) {
    const d = drawing(type, [point(50, 150)], { text: 'Hi' });
    const y = at(d.points[0]).y;
    const shapes = registry.project(d, context);
    assert.ok(
      shapes.every(p => p.kind !== 'path' || p.points.every(q => q.y <= y + 3.5)),
      type,
    );
  }
  const below = drawing('signpost', [point(50, 150)], { text: 'Hi', options: { plate: 'below' } });
  assert.ok(texts(registry.project(below, context))[0].at.y > at(below.points[0]).y);
  const bubble = registry.project(drawing('comment', [point(50, 150)], { text: 'Hi' }), context);
  // The bubble's tail touches the anchor.
  assert.ok(paths(bubble)[0].points.some(p => near(p, at(point(50, 150)))));
});

test('table text splits rows on new lines and cells on tabs or pipes', () => {
  assert.deepEqual(tableCells('a\tb\nc | d'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.deepEqual(tableCells('| Level | Price |\n|---|:---:|\n| R1 | 10 |'), [
    ['Level', 'Price'],
    ['R1', '10'],
  ]);
  assert.deepEqual(tableCells(''), [['']]);
  const d = drawing('table', [point(20, 180)], { text: 'Level | Price\nR1 | 10\nS1' });
  const primitives = registry.project(d, context);
  assert.deepEqual(
    texts(primitives).map(t => [t.text, t.bold]),
    [
      ['Level', true],
      ['Price', true],
      ['R1', false],
      ['10', false],
      ['S1', false],
    ],
  );
  const frame = paths(primitives).find(p => p.closed && !p.fill)!;
  assert.ok(near(frame.points[0], at(d.points[0])));
  assert.ok(registry.project(drawing('table', [point(20, 180)], { text: '---' }), context).length > 0);
});

function fixture() {
  const runtime = new ChartRuntime({
    descriptor: createSimulatedFeed({ seed: 42 }).descriptor,
    connect(callback) {
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
      return { setPaused() {}, requestSnapshot() {}, dispose() {} };
    },
  });
  runtime.start();
  runtime.execute({
    type: 'viewport.set',
    fromMs: 0,
    toMs: 180 * 60000,
    priceScale: { mode: 'manual', minPrice: 50, maxPrice: 150 },
  });
  const controller = new DrawingController({
    registry: runtime.drawingRegistry,
    state: () => runtime.state(),
    execute: (command, rev) => runtime.execute(command, rev),
    changed() {},
    error: error => {
      throw error;
    },
  });
  runtime.subscribe(state => controller.sync(state));
  const view = (): DrawingContext => ({
    geometry: createGeometry(runtime.state(), 1000, 600),
    intervalMs: 60000,
    formatPrice: p => p.toFixed(2),
  });
  return { runtime, controller, view };
}

test('anchored text keeps its plot position while the chart pans and moves when dragged', () => {
  const { runtime, controller, view } = fixture();
  controller.setTool('anchored-text');
  const click = { x: 300, y: 200 };
  controller.down(click, view());
  controller.up(click, view());
  let saved = runtime.exportDocument().drawings.at(-1)!;
  const plot = view().geometry;
  assert.deepEqual(saved.options, {
    plotX: Number(((click.x - plot.left) / plot.plotWidth).toFixed(4)),
    plotY: Number(((click.y - plot.top) / plot.plotHeight).toFixed(4)),
  });
  const placed = texts(runtime.drawingRegistry.project(saved, view()))[0].at;

  runtime.execute({
    type: 'viewport.set',
    fromMs: 60 * 60000,
    toMs: 240 * 60000,
    priceScale: { mode: 'manual', minPrice: 80, maxPrice: 180 },
  });
  const panned = texts(runtime.drawingRegistry.project(saved, view()))[0].at;
  assert.ok(near(panned, placed, 0.1));
  // The handle sits where the text is drawn, not at the stale anchor.
  assert.ok(near(runtime.drawingRegistry.get('anchored-text')!.handles!(saved, view())[0].at, placed, 0.1));

  // A body drag starts from the drawn position and stores the new one.
  const grab = { x: placed.x + 10, y: placed.y - 4 };
  controller.down(grab, view());
  controller.move({ x: grab.x + 100, y: grab.y + 50 }, view());
  controller.up({ x: grab.x + 100, y: grab.y + 50 }, view());
  saved = runtime.exportDocument().drawings.at(-1)!;
  const moved = texts(runtime.drawingRegistry.project(saved, view()))[0].at;
  assert.ok(near(moved, { x: placed.x + 100, y: placed.y + 50 }, 1));
  const anchor = view().geometry;
  assert.ok(near({ x: anchor.x(saved.points[0].timeMs), y: anchor.y(saved.points[0].price) }, moved, 1));
});

test('anchored drawings without stored positions follow their anchor', () => {
  const d = drawing('anchored-text', [point(50, 150)], { text: 'API' });
  assert.ok(near(texts(registry.project(d, context))[0].at, at(d.points[0])));
});
