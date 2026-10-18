import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingRegistry } from '../src/drawing-tools.ts';
import {
  elliottDegreeColor,
  elliottLabel,
  elliottTools,
  patternTools,
} from '../src/drawing-tools-patterns.ts';
import { geometryForRanges } from '../src/geometry.ts';
import type { Drawing, DrawingContext, DrawingPrimitive } from '../src/drawing-types.ts';

const registry = new DrawingRegistry();
const context: DrawingContext = {
  geometry: geometryForRanges({ fromMs: 0, toMs: 100, minPrice: 100, maxPrice: 200 }, 1092, 1112),
  intervalMs: 10,
  formatPrice: price => price.toFixed(2),
};
const point = (timeMs: number, price: number) => ({ timeMs, price });
const drawing = (type: string, prices: number[], extras: Partial<Drawing> = {}) =>
  registry.normalize({
    id: 'test',
    type,
    points: prices.map((price, i) => point(10 + i * 12, price)),
    ...extras,
  });
const project = (d: Drawing) => registry.project(d, context);
const texts = (scene: DrawingPrimitive[]) =>
  scene.filter((p): p is Extract<DrawingPrimitive, { kind: 'text' }> => p.kind === 'text');
const words = (scene: DrawingPrimitive[]) => texts(scene).map(t => t.text);
const fills = (scene: DrawingPrimitive[]) => scene.filter(p => p.kind === 'path' && p.fill);
const dashed = (scene: DrawingPrimitive[]) => scene.filter(p => p.kind === 'path' && p.dash?.length);

const XABCD = [110, 190, 140, 170, 120];

test('patterns family registers chart patterns and Elliott waves under their sections', () => {
  const counts: Record<string, number> = {
    xabcd: 5,
    cypher: 5,
    'head-and-shoulders': 7,
    abcd: 4,
    'triangle-pattern': 4,
    'three-drives': 7,
    'elliott-impulse': 6,
    'elliott-correction': 4,
    'elliott-triangle': 6,
    'elliott-double-combo': 4,
    'elliott-triple-combo': 6,
  };
  for (const [type, points] of Object.entries(counts)) {
    const tool = registry.get(type);
    assert.ok(tool, type);
    assert.equal(tool.group, 'Patterns');
    assert.equal(tool.points, points, type);
    assert.equal(tool.section, type.startsWith('elliott') ? 'Elliott waves' : 'Chart patterns');
  }
  assert.equal(patternTools.length + elliottTools.length, Object.keys(counts).length);
  assert.throws(() => drawing('xabcd', [110, 190, 140, 170]), /POINT_COUNT/);
});

test('XABCD labels its points and shows retracement ratios on dashed connectors', () => {
  const scene = project(drawing('xabcd', XABCD));
  for (const name of ['X', 'A', 'B', 'C', 'D']) assert.ok(words(scene).includes(name), name);
  // XB = AB/XA = 50/80, AC = BC/AB = 30/50, BD = CD/BC = 50/30, XD = AD/XA = 70/80.
  for (const value of ['0.625', '0.6', '1.667', '0.875']) assert.ok(words(scene).includes(value), value);
  assert.equal(fills(scene).length, 2);
  assert.equal(dashed(scene).length, 4);
});

test('pattern labels sit above highs and below lows', () => {
  const d = drawing('xabcd', XABCD),
    scene = project(d);
  for (const [i, name] of ['X', 'A', 'B', 'C', 'D'].entries()) {
    const label = texts(scene).find(t => t.text === name)!,
      y = context.geometry.y(d.points[i].price);
    if (i % 2) assert.ok(label.at.y < y, `${name} above its high`);
    else assert.ok(label.at.y > y, `${name} below its low`);
  }
});

test('background, ratio and label colour settings change the pattern', () => {
  const plain = project(drawing('xabcd', XABCD, { options: { background: false, ratios: false } }));
  assert.equal(fills(plain).length, 0);
  assert.deepEqual(words(plain), ['X', 'A', 'B', 'C', 'D']);
  assert.equal(dashed(plain).length, 4);
  const tinted = project(drawing('abcd', [110, 190, 140, 170], { options: { labelColor: '#ff0000' } }));
  assert.ok(texts(tinted).every(t => t.color === '#ff0000'));
  // Without a label colour the text contrasts with the box: dark on the light default, white on dark.
  assert.equal(texts(project(drawing('abcd', [110, 190, 140, 170])))[0].color, '#131722');
  const dark = drawing('abcd', [110, 190, 140, 170], { style: { color: '#2962ff' } } as Partial<Drawing>);
  assert.equal(texts(project(dark))[0].color, '#ffffff');
  assert.throws(() => drawing('abcd', [110, 190, 140, 170], { options: { labelColor: 'red' } }), /OPTIONS/);
});

test('cypher measures C against XA and D against XC', () => {
  // XB = 40/60, XC = 90/60 = 1.5, XD = CD/XC = 70/90.
  const scene = project(drawing('cypher', [110, 170, 130, 200, 130]));
  for (const value of ['0.667', '1.5', '0.778']) assert.ok(words(scene).includes(value), value);
  assert.equal(fills(scene).length, 2);
});

test('ABCD and three drives label legs with their ratios', () => {
  assert.deepEqual(words(project(drawing('abcd', [110, 190, 140, 170]))).sort(), [
    '0.6',
    '0.625',
    'A',
    'B',
    'C',
    'D',
  ]);
  const drives = words(project(drawing('three-drives', [110, 150, 130, 170, 150, 190, 160])));
  for (const name of ['Drive 1', 'Drive 2', 'Drive 3', 'A', 'B', '0.5', '2'])
    assert.ok(drives.includes(name), name);
});

test('head and shoulders names its peaks and extends the neckline through the troughs', () => {
  const d = drawing('head-and-shoulders', [120, 160, 140, 190, 140, 160, 120]),
    scene = project(d);
  assert.deepEqual(words(scene), ['Left Shoulder', 'Head', 'Right Shoulder']);
  assert.equal(fills(scene).length, 3);
  const y = context.geometry.y(140),
    neck = scene.find(p => p.kind === 'path' && !p.fill && p.points.length === 2 && p.points[0].y === y);
  assert.ok(neck && neck.kind === 'path');
  assert.ok(neck.points[0].x <= context.geometry.x(10) && neck.points[1].x >= context.geometry.x(82));
  const inverse = project(drawing('head-and-shoulders', [180, 140, 160, 110, 160, 140, 180]));
  const head = texts(inverse).find(t => t.text === 'Head')!;
  assert.ok(head.at.y > context.geometry.y(110), 'inverse labels sit below the lows');
});

test('triangle pattern shades up to the apex of its converging sides', () => {
  const scene = project(drawing('triangle-pattern', [180, 110, 165, 125]));
  assert.deepEqual(words(scene), ['A', 'B', 'C', 'D']);
  const area = fills(scene)[0];
  assert.ok(area && area.kind === 'path' && area.points.length === 3);
  // Parallel sides have no apex, so the shading stops at the last anchor instead.
  const parallel = fills(project(drawing('triangle-pattern', [180, 110, 180, 110])))[0];
  assert.ok(parallel && parallel.kind === 'path' && parallel.points.length === 4);
  assert.equal(
    fills(project(drawing('triangle-pattern', [180, 110, 165, 125], { options: { background: false } })))
      .length,
    0,
  );
});

test('Elliott degrees change label notation and colour', () => {
  assert.deepEqual(elliottLabel('3', 'intermediate'), { text: '(3)', circle: false });
  assert.deepEqual(elliottLabel('3', 'cycle'), { text: 'III', circle: false });
  assert.deepEqual(elliottLabel('3', 'supercycle'), { text: '(III)', circle: false });
  assert.deepEqual(elliottLabel('B', 'grand-supercycle'), { text: '((B))', circle: false });
  assert.deepEqual(elliottLabel('4', 'minute'), { text: 'iv', circle: true });
  assert.deepEqual(elliottLabel('B', 'minuette'), { text: '(b)', circle: false });
  assert.deepEqual(elliottLabel('2', 'primary'), { text: '2', circle: true });
  assert.notEqual(elliottDegreeColor('primary'), elliottDegreeColor('minor'));

  const impulse = drawing('elliott-impulse', [110, 140, 125, 180, 160, 195]);
  assert.deepEqual(words(project(impulse)), ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)']);
  assert.ok(texts(project(impulse)).every(t => t.color === elliottDegreeColor('intermediate') && t.plain));
  const primary = project({ ...impulse, options: { degree: 'primary' } });
  assert.deepEqual(words(primary), ['0', '1', '2', '3', '4', '5']);
  assert.equal(primary.filter(p => p.kind === 'path' && p.closed).length, 6, 'one circle per label');
  const tinted = project({ ...impulse, options: { labelColor: '#123456', showWave: false } });
  assert.ok(texts(tinted).every(t => t.color === '#123456'));
  assert.equal(tinted.filter(p => p.kind === 'path').length, 0);
});

test('Elliott waves label each type and place labels above highs, below lows', () => {
  const cases: [string, number[], string[]][] = [
    ['elliott-correction', [190, 130, 160, 110], ['(0)', '(A)', '(B)', '(C)']],
    ['elliott-triangle', [190, 120, 175, 130, 165, 140], ['(0)', '(A)', '(B)', '(C)', '(D)', '(E)']],
    ['elliott-double-combo', [190, 130, 160, 110], ['(0)', '(W)', '(X)', '(Y)']],
    ['elliott-triple-combo', [190, 140, 165, 125, 150, 110], ['(0)', '(W)', '(X)', '(Y)', '(X)', '(Z)']],
  ];
  for (const [type, prices, names] of cases) {
    const d = drawing(type, prices),
      labels = texts(project(d));
    assert.deepEqual(
      labels.map(t => t.text),
      names,
      type,
    );
    labels.forEach((label, i) => {
      const y = context.geometry.y(d.points[i].price);
      assert.ok(i % 2 ? label.at.y > y : label.at.y < y, `${type} ${label.text}`);
    });
  }
});

test('pattern previews with every partial and coincident point count stay finite', () => {
  for (const tool of [...patternTools, ...elliottTools]) {
    const total = tool.points as number;
    for (let count = 1; count <= total; count++) {
      for (const coincident of [true, false]) {
        const preview: Drawing = {
          ...drawing('abcd', [110, 190, 140, 170]),
          type: tool.type,
          points: Array.from({ length: count }, (_, i) =>
            coincident ? point(50, 150) : point(10 + i * 12, i % 2 ? 180 : 120),
          ),
        };
        for (const primitive of registry.project(preview, context)) {
          const coordinates =
            primitive.kind === 'path' ? primitive.points : primitive.kind === 'text' ? [primitive.at] : [];
          for (const p of coordinates)
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${tool.type} with ${count} points`);
          if (primitive.kind === 'text') assert.ok(!/NaN|Infinity/.test(primitive.text), primitive.text);
        }
      }
    }
  }
});
