import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrawingController } from '../src/drawing-controller.ts';
import { drawingTree, treeMoveCommands } from '../src/drawing-groups.ts';
import { createGeometry } from '../src/geometry.ts';
import { ChartRuntime } from '../src/runtime.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import { chartCommandTypes } from '../src/command-schema.ts';
import type { DrawingContext, DrawingInteractionState } from '../src/drawing-types.ts';
import type { ChartCommand } from '../src/types.ts';

const minute = 60000;
function fixture() {
  const runtime = new ChartRuntime({
    descriptor: createSimulatedFeed({ seed: 42 }).descriptor,
    connect(callback) {
      callback({
        type: 'candles.history',
        candles: [0, 1, 2].map(i => ({
          timeMs: i * minute,
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
    toMs: 180 * minute,
    priceScale: { mode: 'manual', minPrice: 50, maxPrice: 150 },
  });
  const errors: Error[] = [];
  let last: DrawingInteractionState | null = null;
  const controller = new DrawingController({
    registry: runtime.drawingRegistry,
    state: () => runtime.state(),
    execute: (command, rev) => runtime.execute(command, rev),
    changed: state => (last = state),
    error: error => errors.push(error),
  });
  runtime.subscribe(state => controller.sync(state));
  const context: DrawingContext = {
    geometry: createGeometry(runtime.state(), 1000, 600),
    intervalMs: minute,
    formatPrice: p => p.toFixed(2),
  };
  const g = context.geometry;
  // Three trend lines at separate heights, back to front.
  for (const [id, price] of [
    ['a', 70],
    ['b', 100],
    ['c', 130],
  ] as const)
    runtime.execute({
      type: 'drawing.add',
      drawing: {
        id,
        type: 'trendline',
        points: [
          { timeMs: 30 * minute, price },
          { timeMs: 90 * minute, price },
        ],
      },
    });
  /** A point on the middle of a line. */
  const on = (price: number) => ({ x: g.x(60 * minute), y: g.y(price) });
  const click = (p: { x: number; y: number }, modifiers = {}) => {
    controller.down(p, context, modifiers);
    controller.up(p, context, modifiers);
  };
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }, modifiers = {}) => {
    controller.down(from, context, modifiers);
    controller.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, context, modifiers);
    controller.up(to, context, modifiers);
  };
  const ids = () => controller.inspect().selection.map(d => d.id);
  const drawings = () => runtime.exportDocument().drawings;
  return {
    runtime,
    controller,
    context,
    errors,
    on,
    click,
    drag,
    ids,
    drawings,
    last: () => last,
  };
}

test('Ctrl, Command or Shift click adds and removes drawings from the selection', () => {
  const { runtime, controller, context, on, click, ids, errors, last } = fixture();
  click(on(70));
  assert.deepEqual(ids(), ['a']);
  click(on(130), { toggle: true, clone: true });
  assert.deepEqual(ids(), ['a', 'c']);
  // The last drawing added is `selected`, so single-selection hosts follow the click.
  assert.equal(controller.inspect().selected?.id, 'c');
  assert.deepEqual(
    last()?.selection.map(d => d.id),
    ['a', 'c'],
  );
  click(on(100), { toggle: true, shift: true });
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  click(on(70), { toggle: true });
  assert.deepEqual(ids(), ['b', 'c']);
  assert.equal(controller.inspect().selected?.id, 'b');
  // A toggle click changes no document state.
  assert.equal(runtime.exportDocument().drawings.length, 3);
  // A plain click on one of the selection keeps the set, so it can be dragged.
  click(on(100));
  assert.deepEqual(ids(), ['b', 'c']);
  assert.equal(controller.inspect().selected?.id, 'b');
  // A plain click elsewhere selects one drawing; a click on empty plot clears.
  click(on(70));
  assert.deepEqual(ids(), ['a']);
  const empty = { x: context.geometry.x(150 * minute), y: context.geometry.y(140) };
  assert.equal(controller.down(empty, context), false);
  assert.deepEqual(ids(), []);
  controller.select(['a', 'b']);
  assert.deepEqual(ids(), ['a', 'b']);
  // Escape returns to the cursor, which clears the selection.
  controller.setTool('cursor');
  assert.deepEqual(ids(), []);
  assert.throws(() => controller.select(['a', 'missing']), /DRAWING_NOT_FOUND/);
  assert.deepEqual(errors, []);
  runtime.dispose();
});

test('dragging one selected drawing moves the whole selection as one undo step', () => {
  const { runtime, controller, context, on, drag, drawings, ids } = fixture();
  controller.select(['a', 'b']);
  const revision = runtime.inspect().documentRevision;
  const dy = context.geometry.y(100) - context.geometry.y(110);
  drag(on(70), { x: on(70).x, y: on(70).y - dy });
  assert.equal(runtime.inspect().documentRevision, revision + 1);
  const [a, b, c] = drawings();
  assert.ok(Math.abs(a.points[0].price - 80) < 0.5);
  assert.ok(Math.abs(b.points[0].price - 110) < 0.5);
  assert.equal(c.points[0].price, 130);
  assert.deepEqual(ids(), ['a', 'b']);
  runtime.execute({ type: 'history.undo' });
  assert.deepEqual(
    drawings().map(d => d.points[0].price),
    [70, 100, 130],
  );
  runtime.dispose();
});

test('locked and hidden drawings stay put when the selection moves', () => {
  const { runtime, controller, on, drag, drawings } = fixture();
  runtime.execute([
    { type: 'drawing.update', id: 'b', patch: { locked: true } },
    { type: 'drawing.update', id: 'c', patch: { visible: false } },
  ]);
  controller.select(['a', 'b', 'c']);
  drag(on(70), { x: on(70).x + 100, y: on(70).y });
  const [a, b, c] = drawings();
  assert.notEqual(a.points[0].timeMs, 30 * minute);
  assert.equal(b.points[0].timeMs, 30 * minute);
  assert.equal(c.points[0].timeMs, 30 * minute);
  runtime.dispose();
});

test('a Ctrl drag clones the selection and selects the copies', () => {
  const { runtime, controller, on, drag, drawings, ids } = fixture();
  controller.select(['a', 'c']);
  const revision = runtime.inspect().documentRevision;
  drag(on(70), { x: on(70).x + 80, y: on(70).y }, { clone: true, toggle: true });
  assert.equal(runtime.inspect().documentRevision, revision + 1);
  assert.equal(drawings().length, 5);
  assert.deepEqual(
    drawings()
      .slice(0, 3)
      .map(d => d.points[0].timeMs),
    [30 * minute, 30 * minute, 30 * minute],
  );
  assert.equal(ids().length, 2);
  assert.ok(ids().every(id => !['a', 'b', 'c'].includes(id)));
  runtime.execute({ type: 'history.undo' });
  assert.equal(drawings().length, 3);
  runtime.dispose();
});

test('delete, duplicate, copy and paste act on the selection in one undo step each', () => {
  const { runtime, controller, drawings, ids } = fixture();
  runtime.execute({ type: 'drawing.update', id: 'b', patch: { locked: true } });
  controller.select(['a', 'b']);
  controller.duplicate();
  assert.equal(drawings().length, 5);
  assert.equal(ids().length, 2);
  runtime.execute({ type: 'history.undo' });
  assert.equal(drawings().length, 3);
  controller.select(['a', 'c']);
  controller.copy();
  const revision = runtime.inspect().documentRevision;
  controller.paste();
  assert.equal(runtime.inspect().documentRevision, revision + 1);
  assert.equal(drawings().length, 5);
  const pasted = ids();
  assert.equal(pasted.length, 2);
  assert.deepEqual(
    drawings()
      .filter(d => pasted.includes(d.id))
      .map(d => d.points[0].timeMs),
    [33 * minute, 33 * minute],
  );
  // A second paste steps right again.
  controller.paste();
  assert.equal(drawings().length, 7);
  runtime.execute({ type: 'history.undo' });
  runtime.execute({ type: 'history.undo' });
  controller.select(['a', 'b', 'c']);
  const before = runtime.inspect().documentRevision;
  controller.remove();
  assert.equal(runtime.inspect().documentRevision, before + 1);
  // The locked drawing stays, still selected.
  assert.deepEqual(
    drawings().map(d => d.id),
    ['b'],
  );
  assert.deepEqual(ids(), ['b']);
  runtime.execute({ type: 'history.undo' });
  assert.equal(drawings().length, 3);
  runtime.dispose();
});

test('a modifier drag on empty plot selects the drawings it touches', () => {
  const { runtime, controller, context, on, drag, ids } = fixture();
  const g = context.geometry;
  controller.select('c');
  // A box from above b's left end down across a; it never reaches c.
  drag({ x: g.x(20 * minute), y: g.y(105) }, { x: g.x(40 * minute), y: g.y(60) }, { toggle: true });
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  assert.equal(controller.marquee, null);
  // Without a modifier the plot pans instead.
  assert.equal(controller.down({ x: g.x(20 * minute), y: g.y(105) }, context), false);
  // A box that catches nothing keeps the selection.
  controller.select('a');
  drag({ x: g.x(100 * minute), y: g.y(140) }, { x: g.x(120 * minute), y: g.y(60) }, { toggle: true });
  assert.deepEqual(ids(), ['a']);
  controller.down({ x: g.x(100 * minute), y: g.y(140) }, context, { toggle: true });
  controller.move({ x: g.x(110 * minute), y: g.y(90) }, context);
  assert.ok(controller.marquee && controller.marquee.right > controller.marquee.left);
  controller.cancel();
  assert.equal(controller.marquee, null);
  void on;
  runtime.dispose();
});

test('groups persist, gather their members and prune deleted drawings', () => {
  const { runtime, drawings } = fixture();
  const plain = runtime.exportDocument();
  assert.equal('drawingGroups' in plain, false);
  const result = runtime.execute({ type: 'drawing.group', id: 'g', drawingIds: ['c', 'a'] });
  assert.deepEqual(result.created, ['g']);
  let doc = runtime.exportDocument();
  assert.deepEqual(doc.drawingGroups, [{ id: 'g', name: 'Group 1', drawings: ['c', 'a'] }]);
  // Members stack together at the frontmost member.
  assert.deepEqual(
    drawings().map(d => d.id),
    ['b', 'a', 'c'],
  );
  runtime.execute({ type: 'drawing.updateGroup', id: 'g', name: '  Levels  ' });
  assert.equal(runtime.exportDocument().drawingGroups![0].name, 'Levels');
  runtime.execute({ type: 'drawing.group', id: 'h', drawingIds: ['b', 'a'] });
  doc = runtime.exportDocument();
  assert.deepEqual(
    doc.drawingGroups!.map(g => [g.id, g.name, g.drawings]),
    [
      ['g', 'Levels', ['c']],
      ['h', 'Group 1', ['b', 'a']],
    ],
  );
  // Saved and restored, groups round-trip; deleting the last member drops a group.
  const restored = new ChartRuntime(createSimulatedFeed({ seed: 42 }));
  restored.restoreDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored.exportDocument().drawingGroups, doc.drawingGroups);
  restored.dispose();
  runtime.execute({ type: 'drawing.remove', id: 'c' });
  assert.deepEqual(
    runtime.exportDocument().drawingGroups!.map(g => g.id),
    ['h'],
  );
  runtime.execute({ type: 'history.undo' });
  assert.equal(runtime.exportDocument().drawingGroups!.length, 2);
  runtime.execute({ type: 'drawing.ungroup', id: 'g' });
  runtime.execute({ type: 'drawing.clear' });
  assert.equal('drawingGroups' in runtime.exportDocument(), false);
  runtime.dispose();
});

test('group and reorder commands validate before changing anything', () => {
  const { runtime } = fixture();
  runtime.execute({ type: 'drawing.group', id: 'g', drawingIds: ['a'] });
  const before = runtime.inspect();
  const cases: [ChartCommand, string, string?][] = [
    [{ type: 'drawing.group', id: 'g', drawingIds: ['b'] }, 'DRAWING_GROUP_EXISTS', 'id'],
    [{ type: 'drawing.group', id: '', drawingIds: ['b'] }, 'INVALID_DRAWING_GROUP', 'id'],
    [{ type: 'drawing.group', id: 'n', drawingIds: [] }, 'INVALID_DRAWING_GROUP', 'drawingIds'],
    [{ type: 'drawing.group', id: 'n', drawingIds: ['b', 'b'] }, 'INVALID_DRAWING_GROUP', 'drawingIds'],
    [{ type: 'drawing.group', id: 'n', drawingIds: ['b', 'x'] }, 'DRAWING_NOT_FOUND', 'drawingIds.1'],
    [{ type: 'drawing.group', id: 'n', drawingIds: ['b'], name: ' ' }, 'INVALID_DRAWING_GROUP', 'name'],
    [
      { type: 'drawing.group', id: 'n', drawingIds: ['b'], name: 'x'.repeat(65) },
      'INVALID_DRAWING_GROUP',
      'name',
    ],
    [{ type: 'drawing.updateGroup', id: 'x', name: 'A' }, 'DRAWING_GROUP_NOT_FOUND', 'id'],
    [{ type: 'drawing.updateGroup', id: 'g' }, 'INVALID_DRAWING_GROUP'],
    [{ type: 'drawing.ungroup', id: 'x' }, 'DRAWING_GROUP_NOT_FOUND', 'id'],
    [{ type: 'drawing.reorder', ids: ['a', 'b'] }, 'INVALID_DRAWING_ORDER', 'ids'],
    [{ type: 'drawing.reorder', ids: ['a', 'b', 'b'] }, 'INVALID_DRAWING_ORDER', 'ids'],
    [{ type: 'drawing.reorder', ids: ['a', 'b', 'x'] }, 'INVALID_DRAWING_ORDER', 'ids'],
  ];
  for (const [command, code, path] of cases)
    assert.throws(
      () => runtime.execute(command),
      { code, ...(path ? { path } : {}) },
      JSON.stringify(command),
    );
  assert.deepEqual(runtime.inspect(), before);
  runtime.execute({ type: 'drawing.reorder', ids: ['c', 'b', 'a'] });
  assert.deepEqual(
    runtime.exportDocument().drawings.map(d => d.id),
    ['c', 'b', 'a'],
  );
  for (const type of ['drawing.reorder', 'drawing.group', 'drawing.updateGroup', 'drawing.ungroup'])
    assert.ok(chartCommandTypes.includes(type as ChartCommand['type']));
  runtime.dispose();
});

test('saved groups load leniently from older and edited layouts', () => {
  const { runtime } = fixture();
  const doc = runtime.exportDocument();
  const restored = new ChartRuntime(createSimulatedFeed({ seed: 42 }));
  // Version 3 layouts have no groups and still load.
  restored.restoreDocument({ ...doc, version: 3, indicators: undefined });
  assert.equal('drawingGroups' in restored.exportDocument(), false);
  // Unknown members and repeats are dropped; empty groups disappear.
  restored.restoreDocument({
    ...doc,
    drawingGroups: [
      { id: 'one', name: 'One', drawings: ['a', 'gone', 'a'] },
      { id: 'two', name: 'Two', drawings: ['a', 'b'] },
      { id: 'empty', name: 'Empty', drawings: ['gone'] },
    ],
  });
  assert.deepEqual(restored.exportDocument().drawingGroups, [
    { id: 'one', name: 'One', drawings: ['a'] },
    { id: 'two', name: 'Two', drawings: ['b'] },
  ]);
  for (const drawingGroups of [
    {},
    [{ id: 'x', name: 'X' }],
    [{ id: 'x', name: '', drawings: [] }],
    [
      { id: 'x', name: 'X', drawings: [] },
      { id: 'x', name: 'Y', drawings: [] },
    ],
  ])
    assert.throws(() => restored.restoreDocument({ ...doc, drawingGroups }), {
      code: 'INVALID_DRAWING_GROUPS',
    });
  restored.dispose();
  runtime.dispose();
});

test('clicking a grouped drawing selects and drags its whole group', () => {
  const { runtime, controller, on, click, drag, ids, drawings } = fixture();
  runtime.execute({ type: 'drawing.group', id: 'g', drawingIds: ['a', 'c'] });
  click(on(70));
  assert.deepEqual(ids().sort(), ['a', 'c']);
  assert.equal(controller.inspect().selected?.id, 'a');
  // A modifier click on a member removes the whole group, and adds it back.
  click(on(100), { toggle: true });
  assert.deepEqual(ids().sort(), ['a', 'b', 'c']);
  click(on(130), { toggle: true });
  assert.deepEqual(ids(), ['b']);
  click(on(130));
  drag(on(130), { x: on(130).x + 50, y: on(130).y });
  const moved = drawings().filter(d => d.points[0].timeMs !== 30 * minute);
  assert.deepEqual(moved.map(d => d.id).sort(), ['a', 'c']);
  // Exact selection from a host stays exact.
  controller.select('c');
  assert.deepEqual(ids(), ['c']);
  runtime.dispose();
});

test('copying a whole group pastes a new group, and ungroup keeps the drawings', () => {
  const { runtime, controller, ids } = fixture();
  runtime.execute({ type: 'drawing.group', id: 'g', drawingIds: ['a', 'b'], name: 'Pair' });
  controller.select(['a', 'b', 'c']);
  controller.copy();
  controller.paste();
  const groups = runtime.exportDocument().drawingGroups!;
  assert.equal(groups.length, 2);
  assert.equal(groups[1].name, 'Pair');
  assert.deepEqual(groups[1].drawings.slice().sort(), ids().slice(0, 2).sort());
  runtime.execute({ type: 'history.undo' });
  controller.select(['a', 'c']);
  const id = controller.group('Mixed');
  assert.ok(id);
  assert.deepEqual(runtime.exportDocument().drawingGroups, [
    { id: 'g', name: 'Pair', drawings: ['b'] },
    { id, name: 'Mixed', drawings: ['a', 'c'] },
  ]);
  controller.ungroup();
  assert.deepEqual(
    runtime.exportDocument().drawingGroups!.map(g => g.id),
    ['g'],
  );
  assert.deepEqual(ids(), ['a', 'c']);
  runtime.dispose();
});

test('the Objects tree lists groups at their front member and moves rows with commands', () => {
  const { runtime, drawings } = fixture();
  runtime.execute({
    type: 'drawing.add',
    drawing: { id: 'd', type: 'vertical-line', points: [{ timeMs: 0, price: 100 }] },
  });
  runtime.execute({ type: 'drawing.group', id: 'g', drawingIds: ['a', 'b'] });
  const groups = () => runtime.exportDocument().drawingGroups ?? [];
  assert.deepEqual(drawingTree(drawings(), groups()), [
    { kind: 'drawing', id: 'd' },
    { kind: 'drawing', id: 'c' },
    { kind: 'group', id: 'g', members: ['b', 'a'] },
  ]);
  const move = (source: string, target: string, where: 'before' | 'after') => {
    const commands = treeMoveCommands(drawings(), groups(), source, { target, where });
    if (commands.length) runtime.execute(commands);
    return commands;
  };
  // Beside a member, a drawing joins the group in one undo step.
  const revision = runtime.inspect().documentRevision;
  move('d', 'b', 'after');
  assert.equal(runtime.inspect().documentRevision, revision + 1);
  assert.deepEqual(drawingTree(drawings(), groups()), [
    { kind: 'drawing', id: 'c' },
    { kind: 'group', id: 'g', members: ['b', 'd', 'a'] },
  ]);
  // Beside a top-level row, it leaves.
  move('d', 'c', 'before');
  assert.deepEqual(drawingTree(drawings(), groups()), [
    { kind: 'drawing', id: 'd' },
    { kind: 'drawing', id: 'c' },
    { kind: 'group', id: 'g', members: ['b', 'a'] },
  ]);
  // A group moves as a block and never nests.
  move('g', 'd', 'before');
  assert.deepEqual(
    drawings().map(d => d.id),
    ['c', 'd', 'a', 'b'],
  );
  move('g', 'c', 'after');
  assert.deepEqual(
    drawings().map(d => d.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(move('g', 'a', 'before'), []);
  assert.deepEqual(move('c', 'c', 'after'), []);
  // Moving the last member out removes its group.
  runtime.execute({ type: 'drawing.updateGroup', id: 'g', drawingIds: ['a'] });
  move('a', 'd', 'before');
  assert.equal(groups().length, 0);
  runtime.execute({ type: 'history.undo' });
  assert.equal(groups().length, 1);
  runtime.dispose();
});
