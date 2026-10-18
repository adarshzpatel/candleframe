import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { fibLevelColor, fibLevels } from '../src/drawing-primitives.ts';
import { hitScene } from '../src/drawing-scene.ts';
import {
  DrawingTemplates,
  drawingTemplatePatch,
  drawingTemplateValue,
  parseDrawingTemplates,
  TEMPLATE_SAVE_DELAY_MS,
  type DrawingTemplateData,
} from '../src/drawing-templates.ts';
import { builtInDrawingTools, DrawingRegistry, fibDefaultLevels } from '../src/drawing-tools.ts';
import { isChartError } from '../src/errors.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingPrimitive,
  DrawingToolDefinition,
} from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const tools = builtInDrawingTools as readonly DrawingToolDefinition[];
// Every character measures 6 px, so wrapping and text boxes are predictable.
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
  measureText: value => value.length * 6,
};
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (
  type: string,
  extras: Record<string, unknown> = {},
  points = [point(20, 120), point(80, 180)],
) => registry.normalize({ id: 'test', type, points, ...extras });
const project = (d: Drawing) => registry.project(d, context);
const paths = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Extract<DrawingPrimitive, { kind: 'path' }> => p.kind === 'path');
const texts = (primitives: DrawingPrimitive[]) =>
  primitives.filter((p): p is Extract<DrawingPrimitive, { kind: 'text' }> => p.kind === 'text');
const code = (name: string) => (error: unknown) => isChartError(error, name);

test('level styles are validated, trimmed to the levels and omitted when empty', () => {
  const fib = drawing('fib-retracement', {
    levelStyles: [{ color: '#ff0000' }, null, { visible: false }, {}, {}],
  });
  assert.deepEqual(fib.levelStyles, [{ color: '#ff0000' }, {}, { visible: false }]);
  assert.deepEqual(registry.normalize(JSON.parse(JSON.stringify(fib))), fib);
  // `visible: true` is the default, so it is not stored.
  assert.equal(drawing('fib-retracement', { levelStyles: [{ visible: true }] }).levelStyles, undefined);
  // Styles past the last level drop; empty levels count the tool's built-ins.
  const short = drawing('fib-retracement', { levels: [0, 1], levelStyles: [{}, {}, { color: '#00f' }] });
  assert.equal(short.levelStyles, undefined);
  const builtIn = drawing('fib-retracement', {
    levels: [],
    levelStyles: [{}, {}, {}, {}, {}, {}, { color: '#00f' }],
  });
  assert.equal(builtIn.levelStyles?.length, fibDefaultLevels('fib-retracement').length);
  for (const bad of [
    'red',
    [{ color: 'red' }],
    [{ visible: 'no' }],
    [{ color: '#fff', width: 2 }],
    [4],
    Array(25).fill({}),
  ])
    assert.throws(() => drawing('fib-retracement', { levelStyles: bad }), code('INVALID_DRAWING_LEVELS'));
});

test('documents saved before level styles load unchanged', () => {
  const old = {
    id: 'old',
    type: 'fib-retracement',
    points: [point(20, 120), point(80, 180)],
    levels: [0, 0.5, 1],
  };
  const loaded = registry.normalize(old);
  assert.equal('levelStyles' in loaded, false);
  assert.deepEqual(loaded.levels, [0, 0.5, 1]);
  assert.equal(paths(project(loaded)).filter(p => p.color && !p.fill).length, 3);
});

test('fibLevels skips hidden levels and applies per-level and single colours', () => {
  const settings = registry.get('fib-retracement')!.settings;
  const fib = drawing('fib-retracement', {
    levelStyles: [{}, { color: '#123456' }, {}, { visible: false }],
    style: { color: '#abcdef' },
  });
  const rows = fibLevels(fib, fibDefaultLevels(fib.type), settings);
  assert.deepEqual(
    rows.map(r => r.level),
    [0, 0.236, 0.382, 0.618, 0.786, 1],
  );
  assert.equal(rows[1].color, '#123456');
  assert.equal(rows[0].color, fibLevelColor(0, 0));
  assert.equal(rows[3].index, 4);
  const single = { ...fib, options: { levelColors: false } };
  assert.ok(fibLevels(single, fibDefaultLevels(fib.type), settings).every(r => r.color === '#abcdef'));
  // A tool without a levelColors setting always colours each level.
  assert.equal(
    fibLevels({ ...fib, levels: [], options: undefined }, [0.5], undefined)[0].color,
    fibLevelColor(0.5, 0),
  );
});

test('Fibonacci tools draw only visible levels in their chosen colours', () => {
  const levelStyles = [{ color: '#111111' }, { visible: false }];
  for (const type of ['fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-fan']) {
    const points =
      registry.get(type)!.points === 3
        ? [point(20, 120), point(50, 180), point(80, 150)]
        : [point(20, 120), point(80, 180)];
    const plain = registry.project(drawing(type, {}, points), context),
      styled = registry.project(drawing(type, { levelStyles }, points), context);
    const colors = (scene: DrawingPrimitive[]) => texts(scene).map(t => t.color);
    assert.equal(texts(styled).length, texts(plain).length - 1, type);
    assert.ok(colors(styled).includes('#111111'), type);
    assert.ok(!colors(plain).includes('#111111'), type);
  }
});

test('a drawing.update patch sets level styles in one undo step', () => {
  const runtime = new ChartRuntime({
    descriptor: createSimulatedFeed({ seed: 7 }).descriptor,
    connect: () => ({ setPaused() {}, requestSnapshot() {}, dispose() {} }),
  });
  runtime.start();
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'fib', type: 'fib-retracement', points: [point(0, 100), point(60000, 110)] },
  });
  runtime.execute({
    type: 'drawing.update',
    id: 'fib',
    patch: { levels: [0, 0.5, 1], levelStyles: [{}, { color: '#ff8800', visible: false }] },
  });
  assert.deepEqual(runtime.exportDocument().drawings[0].levelStyles, [
    {},
    { color: '#ff8800', visible: false },
  ]);
  assert.throws(
    () =>
      runtime.execute({ type: 'drawing.update', id: 'fib', patch: { levelStyles: [{ color: 'orange' }] } }),
    code('INVALID_DRAWING_LEVELS'),
  );
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().drawings[0].levelStyles, undefined);
  runtime.dispose();
});

test('templates save, apply and reset level styles', () => {
  const fib = drawing('fib-retracement', { levels: [0, 0.5, 1], levelStyles: [{}, { color: '#ff8800' }] });
  const value = drawingTemplateValue(fib);
  assert.deepEqual(value.levelStyles, [{}, { color: '#ff8800' }]);
  value.levelStyles![1].color = '#000000';
  assert.equal(fib.levelStyles![1].color, '#ff8800', 'the template owns a copy');
  const definition = registry.get('fib-retracement');
  assert.deepEqual(drawingTemplatePatch(definition, value).levelStyles, [{}, { color: '#000000' }]);
  assert.deepEqual(drawingTemplatePatch(definition, null).levelStyles, []);
  const store = new DrawingTemplates(tools);
  const saved = store.save('fib-retracement', 'Orange', drawingTemplateValue(fib));
  assert.deepEqual(saved.levelStyles, [{}, { color: '#ff8800' }]);
  assert.throws(
    () => store.save('fib-retracement', 'Bad', { levelStyles: [{ color: 'orange' }] }),
    code('INVALID_DRAWING_LEVELS'),
  );
  const parsed = parseDrawingTemplates(
    {
      templates: {
        'fib-retracement': [
          { name: 'Kept', levels: [0, 1], levelStyles: [{ visible: false }] },
          { name: 'Dropped', levelStyles: [{ color: 'nope' }] },
        ],
      },
    },
    tools,
  );
  assert.deepEqual(parsed.templates['fib-retracement'], [
    { name: 'Kept', levels: [0, 1], levelStyles: [{ visible: false }] },
  ]);
});

test('shapes and channels fill with their own colour, or the line colour when blank', () => {
  const cases: [string, Drawing['points']][] = [
    ['rectangle', [point(20, 120), point(80, 180)]],
    ['ellipse', [point(20, 120), point(80, 180)]],
    ['triangle', [point(20, 120), point(50, 180), point(80, 140)]],
    ['parallel-channel', [point(20, 120), point(80, 150), point(30, 170)]],
  ];
  for (const [type, points] of cases) {
    const fills = (options?: Record<string, unknown>) =>
      paths(registry.project(drawing(type, { style: { color: '#336699' }, options }, points), context))
        .filter(p => p.fill)
        .map(p => p.fill);
    assert.deepEqual(fills(), ['#336699'], type);
    assert.deepEqual(fills({ backgroundColor: '#ffcc00' }), ['#ffcc00'], type);
    assert.deepEqual(fills({ background: false, backgroundColor: '#ffcc00' }), [], type);
  }
  assert.throws(
    () => drawing('rectangle', { options: { backgroundColor: 'yellow' } }),
    code('INVALID_DRAWING_OPTIONS'),
  );
});

test('text wraps at the wrap width, and hit testing covers the wrapped lines', () => {
  const note = (wrapWidth?: number) =>
    drawing('text', { text: 'alpha beta gamma', ...(wrapWidth ? { options: { wrapWidth } } : {}) }, [
      point(20, 150),
    ]);
  const [plain] = texts(project(note()));
  assert.equal(plain.wrap, undefined);
  const wrapped = note(40),
    [label] = texts(project(wrapped));
  assert.equal(label.wrap, 40);
  const at = label.at;
  // Three 12 px lines: the third sits about 32 px below the first baseline.
  const below = { x: at.x + 10, y: at.y + 34 };
  assert.equal(hitScene(project(note()), note(), below, 2, context), false);
  assert.equal(hitScene(project(wrapped), wrapped, below, 2, context), true);
  // Unwrapped, the line runs 96 px; wrapped, the box is one word wide.
  const right = { x: at.x + 90, y: at.y - 4 };
  assert.equal(hitScene(project(note()), note(), right, 2, context), true);
  assert.equal(hitScene(project(wrapped), wrapped, right, 2, context), false);
});

test('line text follows the line angle, stays upright and hit-tests in its rotated box', () => {
  const rising = drawing('trendline', { text: 'Breakout level' });
  const [label] = texts(project(rising));
  const [a, b] = rising.points.map(p => ({
    x: context.geometry.x(p.timeMs),
    y: context.geometry.y(p.price),
  }));
  assert.ok(Math.abs(label.angle! - Math.atan2(b.y - a.y, b.x - a.x)) < 1e-9);
  assert.ok(label.angle! < 0 && label.angle! > -Math.PI / 2);
  // Drawn right to left, the text still reads left to right.
  const falling = drawing('trendline', { text: 'Breakout level' }, [point(80, 180), point(20, 120)]);
  assert.ok(Math.abs(texts(project(falling))[0].angle! - label.angle!) < 1e-9);
  // Level lines keep unrotated text.
  assert.equal(
    texts(project(drawing('horizontal-line', { text: 'Level' }, [point(20, 150)])))[0].angle,
    undefined,
  );
  // A point along the rotated text hits; the same offset on an unrotated box would not.
  const along = 40,
    lift = 9;
  const hit = {
    x: label.at.x - along * Math.cos(label.angle!) + lift * Math.sin(label.angle!),
    y: label.at.y - along * Math.sin(label.angle!) - lift * Math.cos(label.angle!),
  };
  const text = [label];
  assert.equal(hitScene(text, rising, hit, 1, context), true);
  assert.equal(hitScene([{ ...label, angle: undefined }], rising, hit, 1, context), false);
});

test('template edits batch into one store write, and flush writes at once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const writes: DrawingTemplateData[] = [];
    const templates = new DrawingTemplates(tools, {
      load: () => null,
      save: value => void writes.push(value),
    });
    for (const width of [2, 3, 4, 5]) templates.setDefault('trendline', { style: { width } });
    templates.save('trendline', 'Wide', { style: { width: 5 } });
    assert.equal(writes.length, 0);
    mock.timers.tick(TEMPLATE_SAVE_DELAY_MS);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].defaults.trendline.style?.width, 5);
    templates.setDefault('trendline', null);
    templates.flush();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].defaults, {});
    mock.timers.tick(TEMPLATE_SAVE_DELAY_MS);
    templates.flush();
    assert.equal(writes.length, 2, 'nothing pending, nothing written');
  } finally {
    mock.timers.reset();
  }
});

test('templates rename in place and keep names unique', () => {
  const templates = new DrawingTemplates(tools);
  templates.save('trendline', 'Blue', { style: { color: '#0000ff' } });
  templates.save('trendline', 'Red', { style: { color: '#ff0000' } });
  const renamed = templates.rename('trendline', 'blue', '  Navy ');
  assert.deepEqual(renamed, { name: 'Navy', style: { color: '#0000ff' } });
  assert.deepEqual(
    templates.list('trendline').map(t => t.name),
    ['Navy', 'Red'],
  );
  assert.equal(templates.rename('trendline', 'Navy', 'NAVY').name, 'NAVY');
  assert.throws(() => templates.rename('trendline', 'NAVY', 'red'), code('TEMPLATE_EXISTS'));
  assert.throws(() => templates.rename('trendline', 'Green', 'Lime'), code('TEMPLATE_NOT_FOUND'));
  assert.throws(() => templates.rename('trendline', 'Red', ' '), code('INVALID_TEMPLATE_NAME'));
  assert.throws(() => templates.rename('ray', 'Red', 'Crimson'), code('TEMPLATE_NOT_FOUND'));
});
