import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingController } from '../src/drawing-controller.ts';
import {
  DrawingTemplates,
  drawingTemplatePatch,
  drawingTemplateValue,
  MAX_TEMPLATES_PER_TOOL,
  parseDrawingTemplates,
  templateName,
  type DrawingTemplateData,
} from '../src/drawing-templates.ts';
import { builtInDrawingTools, DEFAULT_DRAWING_STYLE, DrawingRegistry } from '../src/drawing-tools.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import { createGeometry } from '../src/geometry.ts';
import { isChartError } from '../src/errors.ts';
import type { DrawingContext, DrawingToolDefinition } from '../src/drawing-types.ts';

const tools = builtInDrawingTools as readonly DrawingToolDefinition[];
/** A runtime with three static candles and a fixed view, so no feed timers run. */
function runtimeFixture() {
  const chart = new ChartRuntime({
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
      return { setPaused() {}, dispose() {} };
    },
  });
  chart.start();
  chart.execute({
    type: 'viewport.set',
    fromMs: 0,
    toMs: 180 * 60000,
    priceScale: { mode: 'manual', minPrice: 50, maxPrice: 150 },
  });
  return chart;
}
const code = (codeName: string) => (error: unknown) => isChartError(error, codeName);

function memoryStore(initial?: unknown) {
  let saved: unknown = initial === undefined ? null : structuredClone(initial);
  return {
    saves: 0,
    load: () => structuredClone(saved),
    save(value: DrawingTemplateData) {
      this.saves++;
      saved = JSON.parse(JSON.stringify(value));
    },
    get saved() {
      return saved;
    },
  };
}

test('template names are trimmed and bounded', () => {
  assert.equal(templateName('  Support blue  '), 'Support blue');
  assert.equal(templateName('x'.repeat(64)), 'x'.repeat(64));
  for (const bad of ['', '   ', 'x'.repeat(65), 'tab\there', 42, null])
    assert.throws(() => templateName(bad), code('INVALID_TEMPLATE_NAME'));
});

test('the registry validates tool defaults without a drawing', () => {
  const registry = new DrawingRegistry();
  assert.deepEqual(
    registry.validateDefaults('trendline', {
      style: { color: '#ff0000', width: 3 },
      options: { extendRight: true, extendLeft: false },
    }),
    // Values equal to a setting's default are dropped, as on drawings.
    { style: { color: '#ff0000', width: 3 }, options: { extendRight: true } },
  );
  assert.deepEqual(registry.validateDefaults('fib-retracement', { levels: [0, 0.5, 1] }), {
    levels: [0, 0.5, 1],
  });
  assert.deepEqual(registry.validateDefaults('trendline', { levels: [] }), {});
  assert.throws(() => registry.validateDefaults('nope', {}), code('UNKNOWN_DRAWING_TOOL'));
  assert.throws(() => registry.validateDefaults('trendline', { text: 'x' }), code('INVALID_DRAWING_OPTIONS'));
  assert.throws(
    () => registry.validateDefaults('trendline', { style: { color: 'red' } }),
    code('INVALID_DRAWING_STYLE'),
  );
  assert.throws(
    () => registry.validateDefaults('trendline', { style: { glow: 1 } }),
    code('INVALID_DRAWING_STYLE'),
  );
  assert.throws(
    () => registry.validateDefaults('trendline', { options: { extendRight: 'yes' } }),
    code('INVALID_DRAWING_OPTIONS'),
  );
  assert.throws(
    () => registry.validateDefaults('fib-retracement', { levels: Array(25).fill(0) }),
    code('INVALID_DRAWING_LEVELS'),
  );
});

test('templates save, replace, list, find and delete per tool', () => {
  const templates = new DrawingTemplates(tools);
  const blue = templates.save('trendline', ' Blue ', { style: { color: '#0000ff' } });
  assert.deepEqual(blue, { name: 'Blue', style: { color: '#0000ff' } });
  templates.save('trendline', 'Thick', { style: { width: 5 } });
  templates.save('ray', 'Blue', { style: { color: '#0000aa' } });
  assert.deepEqual(
    templates.list('trendline').map(t => t.name),
    ['Blue', 'Thick'],
  );
  assert.throws(
    () => templates.save('trendline', 'blue', { style: { color: '#00f' } }),
    code('TEMPLATE_EXISTS'),
  );
  // Replacing keeps the list position and takes the new spelling.
  templates.save('trendline', 'BLUE', { style: { color: '#00f' } }, true);
  assert.deepEqual(templates.list('trendline'), [
    { name: 'BLUE', style: { color: '#00f' } },
    { name: 'Thick', style: { width: 5 } },
  ]);
  assert.equal(templates.find('trendline', 'blue')?.name, 'BLUE');
  assert.equal(templates.find('ray', 'blue')?.style?.color, '#0000aa');
  templates.remove('trendline', 'blue');
  assert.deepEqual(
    templates.list('trendline').map(t => t.name),
    ['Thick'],
  );
  assert.throws(() => templates.remove('trendline', 'blue'), code('TEMPLATE_NOT_FOUND'));
  assert.throws(
    () => templates.save('trendline', 'Bad', { style: { width: 99 } }),
    code('INVALID_DRAWING_STYLE'),
  );
  assert.throws(() => templates.save('missing', 'Any', {}), code('UNKNOWN_DRAWING_TOOL'));
  // Returned lists are copies.
  (templates.list('trendline')[0].style as { width: number }).width = 1;
  assert.equal(templates.list('trendline')[0].style?.width, 5);
});

test('each tool holds a bounded number of templates; replacing does not count', () => {
  const templates = new DrawingTemplates(tools);
  for (let i = 0; i < MAX_TEMPLATES_PER_TOOL; i++) templates.save('trendline', `T${i}`, {});
  assert.throws(() => templates.save('trendline', 'One more', {}), code('TEMPLATE_LIMIT'));
  templates.save('trendline', 'T3', { style: { width: 3 } }, true);
  templates.save('ray', 'Other tool', {});
  assert.equal(templates.list('trendline').length, MAX_TEMPLATES_PER_TOOL);
});

test('templates and saved defaults round-trip through a store', async () => {
  const store = memoryStore();
  const first = new DrawingTemplates(tools, store);
  first.save('fib-retracement', 'Golden', {
    style: { color: '#f5c542' },
    options: { reverse: true },
    levels: [0, 0.618, 1],
  });
  first.setDefault('trendline', { style: { width: 3 }, options: { extendRight: true } });
  first.flush();
  assert.equal(store.saves, 1);
  const second = new DrawingTemplates(tools, store);
  await second.load();
  assert.deepEqual(second.snapshot(), first.snapshot());
  second.setDefault('trendline', null);
  second.flush();
  const third = new DrawingTemplates(tools, store);
  await third.load();
  assert.deepEqual(third.defaults(), {});
  assert.equal(third.list('fib-retracement')[0].levels?.length, 3);
});

test('stored data is read leniently: bad entries drop, unknown plugin tools stay', async () => {
  const parsed = parseDrawingTemplates(
    {
      version: 1,
      templates: {
        trendline: [
          { name: 'Good', style: { color: '#fff' } },
          { name: 'good', style: { color: '#000' } },
          { name: '', style: {} },
          { name: 'Bad style', style: { color: 'not a colour' } },
          'nonsense',
        ],
        'plugin:level': [{ name: 'Kept', options: { glow: true } }],
        ray: 'not a list',
      },
      defaults: { trendline: { style: { width: 2.5 } }, ray: { style: { width: 0 } } },
    },
    tools,
  );
  assert.deepEqual(parsed.templates, {
    trendline: [{ name: 'Good', style: { color: '#fff' } }],
    'plugin:level': [{ name: 'Kept', options: { glow: true } }],
  });
  assert.deepEqual(parsed.defaults, { trendline: { style: { width: 2.5 } } });
  for (const junk of [null, 'text', [], { templates: [] }])
    assert.deepEqual(parseDrawingTemplates(junk, tools), { version: 1, templates: {}, defaults: {} });

  // A failing store reports and leaves the session's templates in place.
  const errors: unknown[] = [];
  const broken = new DrawingTemplates(
    tools,
    {
      load: () => Promise.reject(new Error('offline')),
      save: () => {
        throw new Error('quota');
      },
    },
    error => errors.push(error),
  );
  broken.save('trendline', 'Local', {});
  broken.flush();
  await broken.load();
  assert.equal(broken.list('trendline').length, 1);
  assert.deepEqual(
    errors.map(e => (e as Error).message),
    ['quota', 'offline'],
  );
});

test('edits made before a slow store answers win over the stored copy', async () => {
  let answer!: (value: unknown) => void;
  const templates = new DrawingTemplates(tools, {
    load: () => new Promise(resolve => (answer = resolve)),
    save() {},
  });
  const loading = templates.load();
  templates.save('trendline', 'Fresh', { style: { width: 4 } });
  answer({ templates: { trendline: [{ name: 'Old' }], ray: [{ name: 'Stored ray' }] } });
  await loading;
  assert.deepEqual(
    templates.list('trendline').map(t => t.name),
    ['Fresh'],
  );
  assert.deepEqual(
    templates.list('ray').map(t => t.name),
    ['Stored ray'],
  );
});

test('applying a template, the defaults and a reset are each one undoable drawing.update', () => {
  const runtime = runtimeFixture();
  const fib = runtime.drawingRegistry.get('fib-retracement')!;
  runtime.execute({
    type: 'drawing.add',
    drawing: {
      id: 'fib',
      type: 'fib-retracement',
      points: [
        { timeMs: 0, price: 100 },
        { timeMs: 60_000, price: 110 },
      ],
      style: { color: '#123456', width: 4 },
      options: { reverse: true, extend: 'right' },
      levels: [0, 0.5, 1],
      text: 'keep me',
    },
  });
  const source = runtime.exportDocument().drawings[0];
  const template = drawingTemplateValue(source);
  assert.deepEqual(template, {
    style: { ...DEFAULT_DRAWING_STYLE, color: '#123456', width: 4 },
    options: { reverse: true, extend: 'right' },
    levels: [0, 0.5, 1],
  });

  // Reset: built-in style, no options, built-in levels; text and points stay.
  let revision = runtime.inspect().documentRevision;
  runtime.execute({ type: 'drawing.update', id: 'fib', patch: drawingTemplatePatch(fib, null) });
  let drawing = runtime.exportDocument().drawings[0];
  assert.deepEqual(drawing.style, DEFAULT_DRAWING_STYLE);
  assert.equal(drawing.options, undefined);
  assert.deepEqual(drawing.levels, []);
  assert.equal(drawing.text, 'keep me');
  assert.deepEqual(drawing.points, source.points);
  assert.equal(runtime.inspect().documentRevision, revision + 1);

  // A template with only some settings resets the others.
  revision = runtime.inspect().documentRevision;
  runtime.execute({ type: 'drawing.update', id: 'fib', patch: drawingTemplatePatch(fib, template) });
  runtime.execute({
    type: 'drawing.update',
    id: 'fib',
    patch: drawingTemplatePatch(fib, { style: { color: '#00ff00' }, options: { reverse: true } }),
  });
  drawing = runtime.exportDocument().drawings[0];
  assert.deepEqual(drawing.style, { ...DEFAULT_DRAWING_STYLE, color: '#00ff00' });
  assert.deepEqual(drawing.options, { reverse: true });
  runtime.execute({ type: 'history.undo' });
  drawing = runtime.exportDocument().drawings[0];
  assert.deepEqual(drawingTemplateValue(drawing), template);
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(runtime.exportDocument().drawings[0].style, DEFAULT_DRAWING_STYLE);
  runtime.dispose();
});

test('tool defaults replace per tool, clear with null and seed the next drawing', () => {
  const runtime = runtimeFixture();
  const controller = new DrawingController({
    registry: runtime.drawingRegistry,
    state: () => runtime.state(),
    execute: (command, revision) => runtime.execute(command, revision),
    changed() {},
    error(error) {
      throw error;
    },
  });
  controller.configure({
    toolDefaults: {
      'fib-retracement': { style: { color: '#f5c542' }, options: { reverse: true }, levels: [0, 1] },
      trendline: { style: { width: 3 } },
    },
  });
  controller.configure({ toolDefaults: { 'fib-retracement': { style: { width: 5 } } } });
  assert.deepEqual(controller.inspect().options.toolDefaults, {
    'fib-retracement': { style: { width: 5 } },
    trendline: { style: { width: 3 } },
  });
  controller.configure({ toolDefaults: { trendline: null } });
  assert.deepEqual(Object.keys(controller.inspect().options.toolDefaults), ['fib-retracement']);
  assert.throws(
    () => controller.configure({ toolDefaults: { trendline: { style: { width: 0 } } } }),
    code('INVALID_DRAWING_STYLE'),
  );
  assert.throws(
    () => controller.configure({ toolDefaults: { missing: null } }),
    code('UNKNOWN_DRAWING_TOOL'),
  );
  controller.configure({ toolDefaults: { 'fib-retracement': { levels: [0, 0.5, 1] } } });
  controller.setTool('fib-retracement');
  const context: DrawingContext = {
    geometry: createGeometry(runtime.state(), 1000, 600),
    intervalMs: 60000,
    formatPrice: p => p.toFixed(2),
  };
  controller.down({ x: 200, y: 200 }, context);
  controller.down({ x: 500, y: 300 }, context);
  assert.deepEqual(runtime.exportDocument().drawings.at(-1)?.levels, [0, 0.5, 1]);
  runtime.dispose();
});
