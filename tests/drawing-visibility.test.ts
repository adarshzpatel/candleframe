import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartCommandSchema } from '../src/command-schema.ts';
import {
  DrawingFavourites,
  MAX_FAVOURITE_TOOLS,
  parseDrawingFavourites,
  type DrawingFavouriteData,
} from '../src/drawing-favourites.ts';
import { hitDrawings } from '../src/drawing-scene.ts';
import {
  drawingTemplatePatch,
  drawingTemplateValue,
  DrawingTemplates,
  parseDrawingTemplates,
} from '../src/drawing-templates.ts';
import { builtInDrawingTools, DrawingRegistry, translateDrawing } from '../src/drawing-tools.ts';
import {
  DRAWING_VISIBILITY_UNITS,
  drawingShown,
  intervalVisibility,
  normalizedVisibility,
  visibleOnInterval,
} from '../src/drawing-visibility.ts';
import { isChartError } from '../src/errors.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { DrawingContext, DrawingToolDefinition } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const point = (timeMs: number, price: number) => ({ timeMs, price });
const trend = (visibility?: unknown) =>
  registry.normalize({ id: 'line', type: 'trendline', points: [point(20, 120), point(80, 180)], visibility });
const code = (name: string) => (error: unknown) => isChartError(error, name);

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
  return chart;
}

test('visibility keeps only families that differ from their default', () => {
  assert.equal(trend().visibility, undefined);
  assert.equal('visibility' in trend(), false);
  assert.equal(trend({}).visibility, undefined);
  assert.equal(trend({ minutes: { enabled: true, from: 1, to: 59 } }).visibility, undefined);
  // Missing fields take the family's default.
  assert.deepEqual(trend({ minutes: { to: 15 }, ticks: { enabled: false } }).visibility, {
    minutes: { enabled: true, from: 1, to: 15 },
    ticks: { enabled: false, from: 1, to: 999_999 },
  });
  const saved = trend({ hours: { from: 4, to: 12 } });
  assert.deepEqual(registry.normalize(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(DRAWING_VISIBILITY_UNITS.length, 8);
});

test('visibility rejects unknown families, bad counts and reversed ranges', () => {
  for (const bad of [
    'all',
    [],
    { years: { enabled: true } },
    { minutes: true },
    { minutes: { enabled: 'yes' } },
    { minutes: { from: 0 } },
    { minutes: { to: 60 } },
    { minutes: { from: 1.5 } },
    { minutes: { from: 10, to: 5 } },
    { hours: { from: 1, to: 2, step: 1 } },
  ])
    assert.throws(() => trend(bad), code('INVALID_DRAWING_VISIBILITY'), JSON.stringify(bad));
  assert.equal(normalizedVisibility(null), undefined);
});

test('intervals map to a family and count', () => {
  const cases: [string, ReturnType<typeof intervalVisibility>][] = [
    ['1s', { unit: 'seconds', count: 1 }],
    ['5m', { unit: 'minutes', count: 5 }],
    ['4h', { unit: 'hours', count: 4 }],
    ['1d', { unit: 'days', count: 1 }],
    ['2w', { unit: 'weeks', count: 2 }],
    ['500t', { unit: 'ticks', count: 500 }],
    ['10r', { unit: 'ranges', count: 10 }],
    ['10mr', { unit: 'ranges', count: 10 }],
    // Counts above the family's maximum roll up when they divide evenly.
    ['60m', { unit: 'hours', count: 1 }],
    ['120s', { unit: 'minutes', count: 2 }],
    ['48h', { unit: 'days', count: 2 }],
    ['3600s', { unit: 'hours', count: 1 }],
    ['7d', { unit: 'days', count: 7 }],
    ['90m', { unit: 'minutes', count: 59 }],
    ['nope', null],
    ['0m', null],
  ];
  for (const [interval, expected] of cases)
    assert.deepEqual(intervalVisibility(interval), expected, interval);
});

test('drawings show only on intervals their rules allow', () => {
  const d = trend({ minutes: { from: 5, to: 30 }, hours: { enabled: false } });
  assert.equal(visibleOnInterval(d, '1m'), false);
  assert.equal(visibleOnInterval(d, '5m'), true);
  assert.equal(visibleOnInterval(d, '30m'), true);
  assert.equal(visibleOnInterval(d, '45m'), false);
  assert.equal(visibleOnInterval(d, '4h'), false);
  assert.equal(visibleOnInterval(d, '60m'), false);
  assert.equal(visibleOnInterval(d, '1d'), true);
  assert.equal(visibleOnInterval(d, '500t'), true);
  assert.equal(visibleOnInterval(d, undefined), true);
  assert.equal(visibleOnInterval(d, 'weird'), true);
  assert.equal(drawingShown({ ...d, visible: false }, '5m'), false);
  assert.equal(drawingShown(trend(), '1m'), true);
});

test('a drawing hidden on the interval projects nothing and cannot be hit', () => {
  const d = trend({ minutes: { enabled: false } });
  const on5m = { ...context, interval: '5m' },
    on1h = { ...context, interval: '1h' };
  assert.deepEqual(registry.project(d, on5m), []);
  assert.ok(registry.project(d, on1h).length > 0);
  assert.ok(registry.project(d, context).length > 0, 'hosts without an interval show everything');
  const mid = { x: context.geometry.x(50), y: context.geometry.y(150) };
  assert.equal(hitDrawings([d], registry, on5m, mid, null), null);
  assert.equal(hitDrawings([d], registry, on5m, mid, 'line'), null);
  assert.equal(hitDrawings([d], registry, on1h, mid, null)?.drawing.id, 'line');
});

test('copies own their visibility', () => {
  const d = trend({ days: { from: 1, to: 5 } });
  const copy = translateDrawing(d, 10, 0, 0.01);
  copy.visibility!.days!.to = 9;
  assert.equal(d.visibility!.days!.to, 5);
});

test('the headless runtime merges, resets, undoes and saves visibility', () => {
  const chart = runtimeFixture();
  chart.execute({
    type: 'drawing.add',
    drawing: {
      id: 'a',
      type: 'horizontal-line',
      points: [point(60000, 100)],
      visibility: { ticks: { enabled: false } },
    },
  });
  chart.execute({
    type: 'drawing.update',
    id: 'a',
    patch: { visibility: { minutes: { enabled: true, from: 5, to: 59 } } },
  });
  assert.deepEqual(chart.inspect().document.drawings[0].visibility, {
    ticks: { enabled: false, from: 1, to: 999_999 },
    minutes: { enabled: true, from: 5, to: 59 },
  });
  const saved = chart.exportDocument();
  chart.execute({ type: 'drawing.update', id: 'a', patch: { visibility: null } });
  assert.equal('visibility' in chart.inspect().document.drawings[0], false);
  chart.execute({ type: 'history.undo' });
  assert.deepEqual(chart.inspect().document.drawings[0].visibility, saved.drawings[0].visibility);
  assert.throws(
    () =>
      chart.execute({
        type: 'drawing.update',
        id: 'a',
        patch: { visibility: { minutes: { enabled: true, from: 99, to: 99 } } },
      }),
    code('INVALID_DRAWING_VISIBILITY'),
  );
  assert.throws(
    () => chart.execute({ type: 'drawing.update', id: 'a', patch: { visibility: 'none' as never } }),
    code('INVALID_DRAWING_VISIBILITY'),
  );
  chart.execute({ type: 'drawing.duplicate', id: 'a', newId: 'b' });
  assert.deepEqual(chart.inspect().document.drawings[1].visibility, saved.drawings[0].visibility);

  const restored = runtimeFixture();
  restored.restoreDocument(JSON.parse(JSON.stringify(saved)), restored.inspect().documentRevision);
  assert.deepEqual(restored.exportDocument().drawings, saved.drawings);
  // Documents saved before visibility existed load unchanged.
  const old = structuredClone(saved);
  delete old.drawings[0].visibility;
  restored.restoreDocument(old, restored.inspect().documentRevision);
  assert.equal('visibility' in restored.exportDocument().drawings[0], false);
  chart.dispose();
  restored.dispose();
});

test('the command schema describes visibility on add and update', () => {
  const schema = JSON.stringify(chartCommandSchema);
  assert.ok(schema.includes('"visibility"'));
  assert.ok(schema.includes('"seconds"'));
});

test('templates and defaults carry visibility; reset clears it', () => {
  const tools = builtInDrawingTools as readonly DrawingToolDefinition[];
  const d = trend({ seconds: { enabled: false } });
  const value = drawingTemplateValue(d);
  assert.deepEqual(value.visibility, { seconds: { enabled: false, from: 1, to: 59 } });
  const templates = new DrawingTemplates(tools);
  templates.save('trendline', 'No seconds', value);
  assert.deepEqual(templates.find('trendline', 'no seconds')?.visibility, value.visibility);
  assert.deepEqual(drawingTemplatePatch(registry.get('trendline'), value).visibility, value.visibility);
  assert.equal(drawingTemplatePatch(registry.get('trendline'), null).visibility, null);
  const parsed = parseDrawingTemplates(
    {
      templates: {
        trendline: [
          { name: 'Kept', visibility: { hours: { from: 2, to: 4 } } },
          { name: 'Dropped', visibility: { hours: { from: 9, to: 4 } } },
        ],
      },
      defaults: { trendline: { visibility: { days: { enabled: false } } } },
    },
    tools,
  );
  assert.deepEqual(
    parsed.templates.trendline.map(t => t.name),
    ['Kept'],
  );
  assert.deepEqual(parsed.defaults.trendline.visibility, { days: { enabled: false, from: 1, to: 366 } });
  assert.deepEqual(registry.validateDefaults('trendline', { visibility: {} }), {});
});

function memoryStore(initial?: unknown) {
  let saved: unknown = initial === undefined ? null : structuredClone(initial);
  return {
    saves: 0,
    load: () => structuredClone(saved),
    save(value: DrawingFavouriteData) {
      this.saves++;
      saved = JSON.parse(JSON.stringify(value));
    },
    get saved() {
      return saved as DrawingFavouriteData;
    },
  };
}

test('stored favourites are checked and deduplicated', () => {
  assert.deepEqual(parseDrawingFavourites(null), { version: 1, tools: [], visible: true, position: null });
  assert.deepEqual(
    parseDrawingFavourites({
      tools: ['trendline', 'trendline', 'vendor:cone', 7, '__bad', 'ray'],
      visible: false,
      position: { x: 40, y: 12 },
    }),
    { version: 1, tools: ['trendline', 'vendor:cone', 'ray'], visible: false, position: { x: 40, y: 12 } },
  );
  assert.equal(parseDrawingFavourites({ position: { x: Infinity, y: 0 } }).position, null);
  assert.equal(parseDrawingFavourites({ position: { x: '1', y: 0 } }).position, null);
  const many = Array.from({ length: 50 }, (_, i) => `tool-${i}`);
  assert.equal(parseDrawingFavourites({ tools: many }).tools.length, MAX_FAVOURITE_TOOLS);
});

test('favourites toggle, notify and save the whole state', async () => {
  const store = memoryStore();
  const favourites = new DrawingFavourites(store);
  let changes = 0;
  const unsubscribe = favourites.subscribe(() => changes++);
  assert.equal(favourites.toggle('trendline'), true);
  assert.equal(favourites.toggle('fib-retracement'), true);
  assert.deepEqual(favourites.tools(), ['trendline', 'fib-retracement']);
  assert.equal(favourites.toggle('trendline'), false);
  assert.equal(favourites.has('trendline'), false);
  favourites.setVisible(false);
  favourites.setPosition({ x: 10.6, y: 20.2 });
  assert.deepEqual(store.saved, {
    version: 1,
    tools: ['fib-retracement'],
    visible: false,
    position: { x: 11, y: 20 },
  });
  assert.equal(store.saves, 5);
  assert.equal(changes, 5);
  unsubscribe();
  favourites.toggle('ray');
  assert.equal(changes, 5);
  assert.equal(favourites.toggle('__bad'), false);
  await favourites.load();
  assert.deepEqual(favourites.tools(), ['fib-retracement', 'ray'], 'edits before load win');
});

test('favourites load from the store and survive failing storage', async () => {
  const favourites = new DrawingFavourites(memoryStore({ tools: ['ray'], position: { x: 5, y: 6 } }));
  let notified = false;
  favourites.subscribe(() => (notified = true));
  await favourites.load();
  assert.ok(notified);
  assert.deepEqual(favourites.tools(), ['ray']);
  assert.deepEqual(favourites.position, { x: 5, y: 6 });
  const errors: unknown[] = [];
  const broken = new DrawingFavourites(
    {
      load: () => Promise.reject(new Error('offline')),
      save: () => {
        throw new Error('full');
      },
    },
    error => errors.push(error),
  );
  await broken.load();
  assert.equal(broken.toggle('ray'), true);
  assert.deepEqual(broken.tools(), ['ray']);
  assert.equal(errors.length, 2);
});
