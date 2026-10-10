import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createChart } from '../src/chart.ts';
import type { ChartOptions } from '../src/chart.ts';
import { createSimulatedFeed } from '../src/simulated-feed.ts';
import type { RenderFrame } from '../src/webgl-renderer.ts';
import { chartThemes, createTheme } from '../src/themes.ts';
import type { FeedEvent } from '../src/types.ts';
import type { Drawing, DrawingContext } from '../src/drawing-types.ts';
import { DrawingRegistry } from '../src/drawing-tools.ts';
import { hitDrawings, renderDrawings } from '../src/drawing-scene.ts';
import { geometryForRanges } from '../src/geometry.ts';
import { WebGL2Renderer } from '../src/webgl-renderer.ts';
import { HeatmapStore } from '../src/heatmap.ts';

// A DOM boundary double runs the real chart/controller/scheduler with a counting
// renderer. It verifies which work input schedules, not browser painting speed.
class Element extends EventTarget {
  style: Record<string, unknown> = {};
  dataset: Record<string, string> = {};
  children: Element[] = [];
  width = 0;
  height = 0;
  textContent = '';
  clears = 0;
  copies: unknown[] = [];
  captured = new Set<number>();
  context = new Proxy(
    {
      clearRect: () => {
        this.clears++;
      },
      measureText: (text: string) => ({ width: text.length * 7 }),
      drawImage: (source: unknown) => {
        this.copies.push(source);
      },
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  append(...children: Element[]) {
    this.children.push(...children);
  }
  setAttribute() {}
  focus() {}
  remove() {}
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  getContext() {
    return this.context;
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  toDataURL() {
    return 'data:image/png;base64,fixture';
  }
}

function mount(t: TestContext, extra: Partial<ChartOptions> = {}) {
  let now = 0,
    nextFrame = 0,
    renders = 0,
    emit!: (event: FeedEvent) => void;
  let lastFrame: RenderFrame | undefined;
  const frames = new Map<number, FrameRequestCallback>(),
    created: Element[] = [];
  const media = Object.assign(new EventTarget(), { matches: false });
  const fakeWindow = Object.assign(new EventTarget(), { matchMedia: () => media, devicePixelRatio: 1 });
  const fakeDocument = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => {
      const el = new Element();
      created.push(el);
      return el;
    },
  });
  const globals = {
    window: fakeWindow,
    document: fakeDocument,
    ResizeObserver: class {
      constructor(privateCallback: ResizeObserverCallback) {
        this.callback = privateCallback;
      }
      callback: ResizeObserverCallback;
      observe() {
        this.callback(
          [{ contentRect: { width: 800, height: 500 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    WheelEvent: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  };
  const previous = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.method(performance, 'now', () => now);
  let chart: ReturnType<typeof createChart> | undefined;
  t.after(() => {
    chart?.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const host = new Element();
  chart = createChart(host as unknown as HTMLElement, {
    feed: {
      descriptor: createSimulatedFeed().descriptor,
      connect(callback) {
        emit = callback;
        callback({
          type: 'candles.history',
          candles: Array.from({ length: 360 }, (_, i) => ({
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
    },
    renderer: {
      name: 'counting',
      mount() {},
      render(frame) {
        lastFrame = frame;
        renders++;
        return { cpuMs: 0, drawCalls: 1, instances: 0, textureBytes: 0, status: 'ready' };
      },
      dispose() {},
    },
    ...extra,
  });
  const root = host.children[0],
    [market, overlay, cursor] = root.children;
  function step() {
    now += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  }
  function settle() {
    for (let i = 0; frames.size && i < 100; i++) step();
    assert.equal(frames.size, 0, 'animation must stop');
  }
  function input(type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 400,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      ...values,
    }))
      Object.defineProperty(event, key, { value });
    root.dispatchEvent(event);
  }
  settle();
  return {
    chart,
    root,
    market,
    overlay,
    cursor,
    input,
    step,
    settle,
    emit,
    created,
    lastFrame: () => lastFrame!,
    renders: () => renders,
  };
}

test('hover and drawing previews skip market uploads; navigation, data and capture still repaint', t => {
  let changes = 0,
    hovers = 0;
  const f = mount(t, {
    onDrawingChange() {
      changes++;
    },
    onHover() {
      hovers++;
    },
  });
  const rendered = f.renders(),
    staticPaints = f.overlay.clears,
    cursorPaints = f.cursor.clears,
    beforeHover = hovers;
  assert.ok(rendered > 0, 'renderer works without an onStats callback');
  for (let i = 0; i < 50; i++) {
    f.input('pointermove', { clientY: 150 + i });
    f.step();
  }
  assert.equal(f.renders(), rendered, 'hover must not upload market geometry');
  assert.equal(f.overlay.clears, staticPaints, 'hover must not reproject the drawing catalog');
  assert.equal(f.cursor.clears, cursorPaints + 50);
  assert.equal(hovers, beforeHover + 1, 'same candle must not repeatedly update the host');

  f.chart.setTool('trendline');
  f.settle();
  f.input('pointerdown', { clientX: 200 });
  f.input('pointerup', { clientX: 200 });
  f.settle();
  const beforePreview = f.renders(),
    overlayBeforePreview = f.overlay.clears;
  for (let i = 0; i < 10; i++) {
    f.input('pointermove', { clientX: 300 + i });
    f.step();
  }
  assert.equal(f.renders(), beforePreview);
  assert.equal(f.overlay.clears, overlayBeforePreview + 10);
  f.input('pointerdown');
  f.input('pointerup');
  f.settle();
  assert.equal(f.chart.exportDocument().drawings.length, 1);

  const idleChanges = changes,
    beforeZoom = f.renders();
  f.input('wheel', { deltaY: 50, deltaX: 0, deltaMode: 0 });
  f.settle();
  assert.equal(changes, idleChanges, 'idle wheel cancellation must not rebuild drawing controls');
  assert.ok(f.renders() > beforeZoom);
  const beforeData = f.renders();
  f.emit({
    type: 'candle',
    candle: { timeMs: 360 * 60000, open: 105, high: 115, low: 100, close: 110, volume: 2 },
  });
  f.settle();
  assert.ok(f.renders() > beforeData);
  const beforeCapture = f.renders();
  assert.equal(f.chart.capture(), 'data:image/png;base64,fixture');
  assert.equal(f.renders(), beforeCapture + 1, 'capture must refresh the WebGL backbuffer');
  assert.deepEqual(f.created.at(-1)!.copies, [f.market, f.overlay, f.cursor]);
});

test('a failing initial host callback disposes the mounted renderer', t => {
  let mounted = 0,
    disposed = 0;
  assert.throws(
    () =>
      mount(t, {
        onDrawingChange() {
          throw new Error('HOST_CALLBACK_FAILED');
        },
        renderer: {
          name: 'counting',
          mount() {
            mounted++;
          },
          render() {
            throw new Error('unexpected render');
          },
          dispose() {
            disposed++;
          },
        },
      }),
    /HOST_CALLBACK_FAILED/,
  );
  assert.equal(mounted, 1);
  assert.equal(disposed, 1);
});

test('a host edit during render schedules another market frame instead of getting lost', t => {
  let update: (() => void) | undefined;
  const f = mount(t, {
    onStats() {
      const apply = update;
      update = undefined;
      apply?.();
    },
  });
  update = () => f.chart.execute({ type: 'layer.set', layer: 'volume', visible: false });
  const before = f.renders();
  f.chart.execute({ type: 'priceScale.set', minPrice: 60, maxPrice: 130 });
  f.step();
  assert.equal(f.renders(), before + 1);
  f.step();
  assert.equal(f.renders(), before + 2);
  assert.equal(f.chart.exportDocument().layers.volume, false);
  f.settle();
});

test('changing themes redraws the renderer and exports without editing the chart document', t => {
  const observed: string[] = [];
  const f = mount(t, {
    onThemeChange(theme) {
      observed.push(theme.id);
    },
  });
  f.chart.execute({
    type: 'drawing.add',
    drawing: {
      id: 'theme-line',
      type: 'trendline',
      points: [
        { timeMs: 0, price: 100 },
        { timeMs: 60000, price: 110 },
      ],
      style: { color: '#bb3344' },
    },
  });
  f.chart.selectDrawing('theme-line');
  f.settle();
  const before = f.chart.exportDocument(),
    revision = f.chart.inspect().documentRevision,
    rendered = f.renders();
  f.chart.setTheme('paper');
  f.settle();
  assert.equal(f.lastFrame().theme?.id, 'paper');
  assert.equal(f.renders(), rendered + 1);
  assert.equal(f.chart.drawingState().options.style.color, chartThemes.paper.palette.drawing);
  assert.equal(f.chart.drawingState().selected?.id, 'theme-line');
  assert.deepEqual(f.chart.exportDocument(), before);
  assert.equal(f.chart.inspect().documentRevision, revision);
  assert.deepEqual(observed, ['paper']);
  const copy = f.chart.getTheme();
  Reflect.set(copy.palette, 'background', '#ff0000');
  assert.equal(f.chart.getTheme().palette.background, '#ffffff');
  assert.throws(
    () =>
      f.chart.setTheme({
        ...chartThemes.paper,
        palette: { ...chartThemes.paper.palette, accent: 'url(bad)' },
      }),
    /INVALID_THEME_COLOR/,
  );
  assert.equal(f.chart.getTheme().id, 'paper');
  f.chart.capture();
  assert.equal(f.lastFrame().theme?.palette.background, '#ffffff');
  f.chart.setDrawingOptions({ style: { color: '#aabbcc' } });
  f.chart.setTheme('midnight');
  f.settle();
  assert.equal(
    f.chart.drawingState().options.style.color,
    '#aabbcc',
    'explicit user drawing defaults survive themes',
  );
  assert.deepEqual(f.chart.exportDocument(), before);
});

test('text placement opens editing after release; activation edits without navigation or history changes', t => {
  const edits: Drawing[] = [];
  const f = mount(t, {
    onDrawingEdit(drawing) {
      edits.push(drawing);
      assert.equal(f.root.captured.size, 0);
    },
  });
  f.chart.setTool('text');
  f.input('pointerdown');
  assert.equal(edits.length, 0, 'the editor must not take focus during pointer capture');
  f.input('pointerup');
  f.settle();
  assert.equal(edits.length, 1);
  const id = edits[0].id,
    original = f.chart.exportDocument();
  edits[0].text = 'host mutation';
  assert.equal(f.chart.exportDocument().drawings[0].text, 'Note', 'callback owns its copy');

  const revision = f.chart.inspect().documentRevision;
  for (let i = 0; i < 2; i++) {
    f.input('pointerdown');
    f.input('pointerup');
  }
  f.input('dblclick');
  assert.equal(edits.length, 2);
  f.input('keydown', { key: 'Enter' });
  assert.equal(edits.length, 3);
  assert.equal(f.chart.inspect().documentRevision, revision);
  assert.deepEqual(f.chart.exportDocument(), original);

  f.chart.execute({
    type: 'drawing.update',
    id,
    patch: { text: 'Support\nWatch the close', style: { fontSize: 18 } },
  });
  f.input('keydown', { key: 'Enter' });
  assert.equal(edits.at(-1)!.text, 'Support\nWatch the close');
  f.chart.execute({ type: 'history.undo' });
  assert.equal(f.chart.exportDocument().drawings[0].text, 'Note', 'one undo restores the whole edit');
  assert.equal(f.chart.exportDocument().drawings[0].style.fontSize, original.drawings[0].style.fontSize);

  f.chart.execute({ type: 'drawing.update', id, patch: { locked: true } });
  const count = edits.length;
  f.input('keydown', { key: 'Enter' });
  f.input('dblclick');
  assert.equal(edits.length, count, 'locked annotations cannot activate the direct editor');
});

test('callouts open editing only when all anchors are placed; canceled releases never open it', t => {
  const edits: Drawing[] = [];
  const f = mount(t, { onDrawingEdit: drawing => edits.push(drawing) });
  f.chart.setTool('callout');
  f.input('pointerdown', { clientX: 200 });
  f.input('pointerup', { clientX: 200 });
  assert.equal(edits.length, 0);
  f.input('pointermove', { clientX: 400 });
  f.input('pointerdown');
  f.input('pointerup');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].points.length, 2);
  f.chart.setTool('text');
  f.input('pointerdown', { clientX: 500 });
  f.input('pointercancel');
  f.input('pointerup', { clientX: 500 });
  assert.equal(edits.length, 1);
  f.chart.setTool('horizontal-line');
  f.input('pointerdown');
  f.input('pointerup');
  assert.equal(edits.length, 1, 'non-text tools preserve their existing placement flow');
});

test('position settings open on activation without interrupting one-click placement', t => {
  const edits: Drawing[] = [];
  const f = mount(t, { onDrawingEdit: drawing => edits.push(drawing) });
  f.chart.setTool('long-position');
  f.input('pointerdown');
  f.input('pointerup');
  f.settle();
  const original = f.chart.exportDocument(),
    revision = f.chart.inspect().documentRevision;
  assert.equal(original.drawings.length, 1);
  assert.equal(edits.length, 0, 'placement leaves handles available rather than opening a modal');
  f.input('dblclick');
  f.input('keydown', { key: 'Enter' });
  assert.equal(edits.length, 2);
  assert.equal(edits[0].type, 'long-position');
  assert.equal(f.chart.inspect().documentRevision, revision);
  assert.deepEqual(f.chart.exportDocument(), original);
  f.chart.execute({ type: 'drawing.update', id: original.drawings[0].id, patch: { locked: true } });
  f.input('dblclick');
  assert.equal(edits.length, 2);
});

test('custom layout updates geometry and axis hit targets without persisting view state', t => {
  const f = mount(t);
  const initial = f.lastFrame().geometry;
  assert.deepEqual(
    [
      initial.left,
      initial.top,
      initial.plotWidth,
      initial.plotHeight,
      initial.volumeTop,
      initial.volumeHeight,
    ],
    [14, 16, 708, 388, 422, 46],
  );
  const theme = createTheme('paper', {
    chart: {
      plotLeft: 20,
      plotTop: 24,
      priceAxisWidth: 100,
      timeAxisHeight: 40,
      volumeGap: 12,
      volumeHeight: 60,
      axisGap: 8,
      drawingWidth: 4,
      drawingFontSize: 18,
      drawingFillOpacity: 0.3,
    },
  });
  f.input('pointerdown');
  assert.equal(f.root.captured.size, 1);
  const before = f.chart.exportDocument(),
    revision = f.chart.inspect().documentRevision;
  f.chart.setTheme(theme);
  f.settle();
  assert.equal(f.root.captured.size, 0, 'changing geometry cancels an active gesture');
  const geometry = f.lastFrame().geometry;
  assert.deepEqual(
    [
      geometry.left,
      geometry.top,
      geometry.plotWidth,
      geometry.plotHeight,
      geometry.volumeTop,
      geometry.volumeHeight,
    ],
    [20, 24, 680, 356, 392, 60],
  );
  const [, , , timeAxis, priceAxis] = f.root.children;
  assert.equal(timeAxis.style.height, '40px');
  assert.equal(timeAxis.style.width, '680px');
  assert.equal(priceAxis.style.left, '700px');
  assert.equal(priceAxis.style.height, '356px');
  const p = geometry.anchor(340, 220);
  assert.ok(Math.abs(geometry.x(p.timeMs) - 340) < 1e-8);
  assert.ok(Math.abs(geometry.y(p.price) - 220) < 1e-8);
  assert.deepEqual(f.chart.exportDocument(), before);
  assert.equal(f.chart.inspect().documentRevision, revision);
  assert.equal(f.chart.drawingState().options.style.width, 4);
  assert.equal(f.chart.drawingState().options.style.fontSize, 18);
  assert.equal(f.chart.drawingState().options.style.fillOpacity, 0.3);
  f.chart.setDrawingOptions({ style: { width: 6, fontSize: 20, fillOpacity: 0.4 } });
  f.chart.setTheme('midnight');
  f.settle();
  assert.equal(f.chart.drawingState().options.style.width, 6);
  assert.equal(f.chart.drawingState().options.style.fontSize, 20);
  assert.equal(f.chart.drawingState().options.style.fillOpacity, 0.4);
});

test('annotation font measurement and padding are shared by rendering and hit testing', () => {
  const theme = createTheme('paper', {
    typography: { annotationFamily: 'Georgia, serif' },
    chart: { annotationPadding: 18, annotationOpacity: 0.4, annotationBackground: '#ccddee' },
  });
  const registry = new DrawingRegistry(),
    geometry = geometryForRanges(
      { fromMs: 0, toMs: 1000, minPrice: 0, maxPrice: 100 },
      800,
      500,
      theme.chart,
    );
  const seenFonts: string[] = [],
    rectangles: number[][] = [],
    text: { font: string; x: number; y: number }[] = [];
  const context: DrawingContext = {
    geometry,
    theme,
    intervalMs: 1,
    formatPrice: String,
    measureText(value, font) {
      seenFonts.push(font);
      return value === 'Wide' ? 180 : 30;
    },
  };
  const drawing = registry.normalize({
    id: 'note',
    type: 'text',
    points: [geometry.anchor(100, 200)],
    text: 'Wide\nSmall',
    style: { fontSize: 20 },
  });
  let background: unknown, opacity: unknown;
  const canvas = new Proxy<Record<string, unknown>>(
    {
      fillRect(x: number, y: number, w: number, h: number) {
        rectangles.push([x, y, w, h]);
        background = canvas.fillStyle;
        opacity = canvas.globalAlpha;
      },
      fillText(_value: string, x: number, y: number) {
        text.push({ font: String(canvas.font), x, y });
      },
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  renderDrawings(canvas as unknown as CanvasRenderingContext2D, [drawing], registry, context, null);
  assert.deepEqual(
    rectangles.map(rect => rect.map(value => Math.round(value * 1e6) / 1e6)),
    [[100, 171, 216, 66]],
  );
  assert.deepEqual(
    text.map(row => ({ ...row, y: Math.round(row.y * 1e6) / 1e6 })),
    [
      { font: '20px Georgia, serif', x: 118, y: 200 },
      { font: '20px Georgia, serif', x: 118, y: 224 },
    ],
  );
  assert.equal(background, '#ccddee');
  assert.equal(opacity, 0.4);
  assert.equal(hitDrawings([drawing], registry, context, { x: 313, y: 230 }, null)?.drawing.id, 'note');
  assert.equal(hitDrawings([drawing], registry, context, { x: 324, y: 230 }, null), null);
  assert.ok(seenFonts.every(font => font === '20px Georgia, serif'));
});

test('renderer applies series tokens and heatmap uniforms while preserving explicit indicator colors', t => {
  const f = mount(t);
  const buffers: Float32Array[] = [],
    uniforms = new Map<string, number[]>();
  const gl = new Proxy<Record<string, unknown>>(
    {
      getProgramParameter: () => true,
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      createTexture: () => ({}),
      getUniformLocation: (_program: unknown, name: string) => name,
      uniform4f: (name: string, ...values: number[]) => uniforms.set(name, values),
      uniform1f: (name: string, value: number) => uniforms.set(name, [value]),
      bufferSubData: (_target: unknown, _offset: number, data: Float32Array) => buffers.push(data.slice()),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  const canvas = Object.assign(new EventTarget(), { width: 0, height: 0, getContext: () => gl });
  const renderer = new WebGL2Renderer();
  renderer.mount(
    canvas as unknown as HTMLCanvasElement,
    () => {},
    () => {},
  );
  t.after(() => renderer.dispose());
  const theme = createTheme('paper', {
    chart: {
      gridWidth: 2,
      gridRows: 3,
      gridColumns: 4,
      candleUp: '#0000ff',
      wickUp: '#ff0000',
      wickWidth: 3,
      volumeUp: '#00ff00',
      volumeOpacity: 0.6,
      indicatorWidth: 5,
      heatmapLow: '#123456',
      heatmapUnknown: '#abcdef',
      heatmapUnknownOpacity: 0.2,
      heatmapOpacity: 0.7,
    },
  });
  const frame = f.lastFrame(),
    state = {
      ...frame.state,
      document: { ...frame.state.document, layers: { ...frame.state.document.layers, heatmap: true } },
      indicators: [
        {
          plugin: { id: 'custom', name: 'Custom', color: [1, 0, 1, 1] as const, calculate: () => [] },
          values: frame.state.candles.map(() => 102),
        },
      ],
    };
  const heatmap = new HeatmapStore({ minPrice: 90, binSize: 1, rows: 30, intervalMs: 60000 }, 2);
  heatmap.append({ timeMs: 0, valid: false, values: new Float32Array(30) });
  renderer.render({ ...frame, state, heatmap, theme });
  const data = buffers.at(-1)!,
    instances = Array.from({ length: data.length / 11 }, (_, i) => [...data.slice(i * 11, (i + 1) * 11)]);
  assert.equal(
    instances.filter(row => row[4] === 2).length,
    9,
    'custom row and column counts determine grid instances',
  );
  assert.ok(
    instances.some(row => row[4] === 3 && row[5] === 1 && row[6] === 0 && row[7] === 0),
    'wick has its independent color and width',
  );
  assert.ok(
    instances.some(row => row[5] === 0 && row[6] === 0 && row[7] === 1),
    'body has its independent color',
  );
  assert.ok(
    instances.some(row => row[5] === 0 && row[6] === 1 && row[7] === 0 && Math.abs(row[8] - 0.6) < 1e-6),
    'volume has its own color and opacity',
  );
  assert.ok(
    instances.some(row => row[4] === 5 && row[5] === 1 && row[6] === 0 && row[7] === 1),
    'explicit indicator color survives themed line width',
  );
  assert.deepEqual(uniforms.get('lowColor'), [0x12 / 255, 0x34 / 255, 0x56 / 255, 1]);
  assert.deepEqual(uniforms.get('unknownColor'), [0xab / 255, 0xcd / 255, 0xef / 255, 0.2]);
  assert.deepEqual(uniforms.get('heatOpacity'), [0.7]);
});

test('autoscaleOnPan keeps an auto price scale fitted while dragging the plot', t => {
  for (const autoscaleOnPan of [false, true]) {
    const f = mount(t, { autoscaleOnPan });
    f.input('pointerdown', { clientX: 400, clientY: 200 });
    f.input('pointermove', { clientX: 300, clientY: 260 });
    f.input('pointerup', { clientX: 300, clientY: 260 });
    f.settle();
    const doc = f.chart.exportDocument();
    assert.equal(doc.viewport.following, false, 'the drag pans time either way');
    assert.equal(doc.priceScale.mode, autoscaleOnPan ? 'auto' : 'manual');
    f.chart.dispose();
  }
});

test('autoscaleOnPan leaves a manual price scale free to pan vertically', t => {
  const f = mount(t, { autoscaleOnPan: true });
  f.chart.execute({ type: 'priceScale.set', minPrice: 60, maxPrice: 130 });
  f.settle();
  f.input('pointerdown', { clientX: 400, clientY: 200 });
  f.input('pointermove', { clientX: 300, clientY: 260 });
  f.input('pointerup', { clientX: 300, clientY: 260 });
  f.settle();
  const scale = f.chart.exportDocument().priceScale;
  assert.equal(scale.mode, 'manual');
  assert.ok(scale.mode === 'manual' && scale.minPrice > 60, 'dragging down moves the range up');
});
