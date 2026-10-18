import { ChartError, toChartError } from './errors.ts';
import { indicatorColor, resolveTheme, themeColor, themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme, ThemeInput } from './themes.ts';
import { createGeometry, geometryForRanges, geometryLayout, stateTimeScale } from './geometry.ts';
import type { TimeScale } from './time-scale.ts';
import type { IndicatorDefinition } from './indicators.ts';
import { createTimeFormats } from './time-format.ts';
import { priceTicks, timeTicks, valueTicks, zoneOffsets, TICK_RANK } from './axis-ticks.ts';
import { isTimeInterval } from './intervals.ts';
import {
  copyMarkers,
  copyPriceLines,
  hitCloseBox,
  hitPriceLine,
  renderMarkers,
  renderPriceLines,
} from './chart-overlays.ts';
import { renderBubbles } from './bubble-scene.ts';
import { renderIndicatorDots } from './dot-scene.ts';
import { renderFlowSignals } from './signal-scene.ts';
import type {
  ChartMarker,
  PriceLine,
  PriceLineActionListener,
  PriceLineCloseBox,
  PriceLineDragEvent,
  PriceLineDragListener,
} from './chart-overlays.ts';
import type { AxisTick } from './axis-ticks.ts';
import type { ChartGeometry } from './geometry.ts';
import { ChartRuntime } from './runtime.ts';
import type {
  CommandResult,
  DataQuery,
  DataResult,
  ExecuteOptions,
  PreviewResult,
  RestoreOptions,
} from './runtime.ts';
import { PanMotion } from './pan-motion.ts';
import { ScaleMotion } from './scale-motion.ts';
import { CandleMotion } from './candle-motion.ts';
import { DrawingController } from './drawing-controller.ts';
import { DRAWING_HOTKEYS } from './drawing-tools.ts';
import { renderDrawings, type DrawingAxisPainter } from './drawing-scene.ts';
import { renderProfiles } from './profile-scene.ts';
import { renderFootprints } from './footprint-scene.ts';
import type { FootprintCache } from './footprint-scene.ts';
import type { ProfileCache } from './profile-scene.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingInteractionState,
  DrawingModifiers,
  DrawingOptionsPatch,
  DrawingStyle,
  DrawingToolDefinition,
} from './drawing-types.ts';
import { dragTimeScale, panTimeScale, PRICE_WHEEL_HEIGHT, priceAxisMath } from './scales.ts';
import { WebGL2Renderer } from './webgl-renderer.ts';
import type { ChartRenderer, RendererStats } from './webgl-renderer.ts';
import type {
  Candle,
  ChartCommand,
  ChartDocument,
  FeedAdapter,
  IndicatorPlugin,
  RuntimeState,
} from './types.ts';

export interface ChartOptions {
  feed: FeedAdapter;
  theme?: ThemeInput;
  onThemeChange?: (theme: ResolvedChartTheme) => void;
  heatmap?: boolean;
  indicators?: readonly IndicatorPlugin[];
  renderer?: ChartRenderer;
  /** Extra indicator kinds for `indicator.add`, saved layouts and the widget's indicator menu. */
  indicatorDefinitions?: readonly IndicatorDefinition[];
  /** Candles kept in memory, including paged history. Default 10,000. */
  maxCandles?: number;
  /** IANA zone for axis and crosshair labels, such as `America/New_York`. Default `UTC`. */
  timeZone?: string;
  /** Eased plot dragging and release momentum. Default true; honors reduced motion. */
  panMotion?: boolean;
  /** Ease zoom, axis resizing and autoscale changes. Default true; honors reduced motion. */
  scaleMotion?: boolean;
  /** Ease the forming candle between ticks. Default true; honors reduced motion. */
  candleMotion?: boolean;
  /** Keep an auto price scale fitted to visible candles while dragging the plot. Default false. */
  autoscaleOnPan?: boolean;
  onStats?: (stats: RendererStats) => void;
  onHover?: (bar: Candle | null) => void;
  drawingTools?: readonly DrawingToolDefinition[];
  onToolChange?: (tool: string) => void;
  onDrawingChange?: (state: DrawingInteractionState) => void;
  /** Owned drawing copy. Annotations open after placement; any drawing opens on double-click or Enter. */
  onDrawingEdit?: (drawing: Drawing) => void;
  onError?: (error: ChartError) => void;
}
export interface ChartApi {
  setTheme(theme: ThemeInput): void;
  /** Changes the label time zone. Throws `INVALID_TIME_ZONE` for unknown zones. */
  setTimeZone(timeZone: string): void;
  getTheme(): ResolvedChartTheme;
  replaceFeed(feed: FeedAdapter, expectedRevision?: number): void;
  /** One command, or an atomic batch that is a single undo step. See `ChartRuntime.execute`. */
  execute(
    command: ChartCommand | readonly ChartCommand[],
    expectedRevision?: number,
    options?: ExecuteOptions,
  ): CommandResult;
  /** Dry-runs commands and returns the resulting document or the first error. */
  preview(commands: readonly ChartCommand[], expectedRevision?: number): PreviewResult;
  /** Candles and indicator values for a range. */
  query(request?: DataQuery): DataResult;
  inspect(): ReturnType<ChartRuntime['inspect']>;
  exportDocument(): ChartDocument;
  restoreDocument(document: unknown, expectedRevision?: number, options?: RestoreOptions): void;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  /**
   * Shows a vertical time line, such as the crosshair of a linked chart. `null` hides it.
   * The local pointer takes precedence; `onHover` reports the bar under the line.
   */
  setCrosshair(timeMs: number | null): void;
  /** Reports the hovered bar's open time while the pointer is over this plot, then `null`. */
  subscribeCrosshair(listener: (timeMs: number | null) => void): () => void;
  setTool(tool: string): void;
  selectDrawing(id: string | null): void;
  drawingState(): DrawingInteractionState;
  drawingTools(): readonly DrawingToolDefinition[];
  setDrawingOptions(options: DrawingOptionsPatch): void;
  capture(): string;
  /** Requests candles before the first loaded bar. The chart also does this when panning near it. */
  loadOlderHistory(): boolean;
  /**
   * Replaces the host's price lines, such as working orders or a position's entry.
   * View state only: not saved, not undoable and not editable in the chart.
   */
  setPriceLines(lines: readonly PriceLine[]): void;
  /** Replaces the host's markers, such as fills or large trades. View state only. */
  setMarkers(markers: readonly ChartMarker[]): void;
  /** Reports drags of price lines that have `drag` set. See `PriceLineDragListener`. */
  subscribePriceLineDrag(listener: PriceLineDragListener): () => void;
  /** Reports clicks on the × box of `closable` price lines. */
  subscribePriceLineAction(listener: PriceLineActionListener): () => void;
  /**
   * The price and time under a point in viewport (client) coordinates, with the price
   * snapped to the tick size. Null outside the price plot.
   */
  priceAt(clientX: number, clientY: number): { price: number; timeMs: number } | null;
  dispose(): void;
}

/** Mounts a chart-only view. All controls can be supplied by the host application. */

export function createChart(container: HTMLElement, options: ChartOptions): ChartApi {
  let theme = resolveTheme(options.theme);
  const runtime = new ChartRuntime(options.feed, options.indicators, {
    heatmap: options.heatmap,
    drawingTools: options.drawingTools,
    maxCandles: options.maxCandles,
    indicatorDefinitions: options.indicatorDefinitions,
  });
  const renderer = options.renderer ?? new WebGL2Renderer();
  const root = document.createElement('div');
  root.className = 'cf-chart';
  Object.assign(root.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    touchAction: 'none',
    overscrollBehavior: 'contain',
  });
  root.tabIndex = 0;
  root.setAttribute('role', 'group');
  root.setAttribute(
    'aria-label',
    'Interactive price chart. Arrow keys pan, plus and minus zoom, Home returns to live, Escape cancels drawing.',
  );
  const timeAxis = document.createElement('div'),
    priceAxis = document.createElement('div');
  for (const [axis, name, cursor] of [
    [timeAxis, 'Time', 'ew-resize'],
    [priceAxis, 'Price', 'ns-resize'],
  ] as const) {
    axis.tabIndex = 0;
    axis.setAttribute('role', 'button');
    axis.setAttribute(
      'aria-label',
      `${name} scale. Drag to resize, arrow keys to adjust, double-click or Home to reset.`,
    );
    axis.title = `${name} scale: drag to resize, double-click to reset`;
    Object.assign(axis.style, { position: 'absolute', cursor, touchAction: 'none' });
  }
  const canvas = document.createElement('canvas');
  canvas.dataset.renderer = renderer.name;
  canvas.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('canvas');
  overlay.setAttribute('aria-hidden', 'true');
  const cursorCanvas = document.createElement('canvas');
  cursorCanvas.setAttribute('aria-hidden', 'true');
  for (const element of [canvas, overlay, cursorCanvas])
    Object.assign(element.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, {
    position: 'absolute',
    top: '48%',
    left: '10%',
    right: '10%',
    borderStyle: 'solid',
    textAlign: 'center',
    display: 'none',
  });
  function reflectTheme() {
    root.style.background = theme.palette.background;
    Object.assign(notice.style, {
      color: theme.palette.text,
      background: theme.palette.surface,
      borderColor: theme.palette.borderStrong,
      borderWidth: `${theme.effects.borderWidth}px`,
      padding: `${theme.layout.panelPadding}px`,
      borderRadius: `${theme.effects.radius}px`,
      font: `${theme.typography.uiWeight} ${theme.typography.uiSize}px ${theme.typography.uiFamily}`,
    });
  }
  reflectTheme();
  root.append(canvas, overlay, cursorCanvas, timeAxis, priceAxis, notice);
  container.append(root);
  const ctx = overlay.getContext('2d');
  const cursorCtx = cursorCanvas.getContext('2d');
  if (!ctx || !cursorCtx) {
    root.remove();
    throw new ChartError('CANVAS2D_UNAVAILABLE');
  }
  let state = runtime.state();
  let formatPrice = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: state.feed.instrument.pricePrecision,
    maximumFractionDigits: state.feed.instrument.pricePrecision,
  });
  let timeZone = options.timeZone ?? 'UTC';
  let timeFormats = createTimeFormats(state.feed.intervalMs, timeZone);
  let geometry: ChartGeometry;
  let frame = 0;
  let drawing = false;
  let redrawRequested = false;
  const candleMotion = new CandleMotion();
  let marketDirty = true,
    overlayDirty = true;
  let width = 1,
    height = 1;
  let disposed = false;
  let renderError: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let lastHover: Candle | null | undefined;
  // Time line mirrored from another chart; hidden while this chart has the pointer.
  let syncedTime: number | null = null,
    lastCrosshair: number | null = null;
  const crosshairListeners = new Set<(timeMs: number | null) => void>();
  let drag: {
    kind: 'pan' | 'time' | 'price';
    pointerId: number;
    started: number;
    x: number;
    y: number;
    from: number;
    to: number;
    min: number;
    max: number;
    width: number;
    height: number;
    moved?: boolean;
  } | null = null;
  let pan: {
    motion: PanMotion;
    scale: TimeScale;
    from: number;
    to: number;
    min: number;
    max: number;
    width: number;
    height: number;
    x: number;
    y: number;
    appliedX: number;
    appliedY: number;
    /** Price follows the visible candles, so vertical drag is ignored. */
    autoscale: boolean;
  } | null = null;
  let scaleMotion: ScaleMotion | null = null;
  let drawingPointerId: number | null = null;
  let pendingTextEdit: string | null = null;
  const drawings = new DrawingController({
    registry: runtime.drawingRegistry,
    state: () => state,
    execute: (command, revision) => {
      runtime.execute(command, revision);
    },
    changed(value) {
      options.onToolChange?.(value.tool);
      options.onDrawingChange?.(value);
      invalidate('overlay');
    },
    error(error) {
      options.onError?.(toChartError(error));
    },
  });
  const abort = new AbortController();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function showError(message: string | null): void {
    renderError = message;
    notice.textContent = message ?? '';
    notice.style.display = message ? 'block' : 'none';
  }

  function invalidate(layer: 'market' | 'overlay' | 'cursor' = 'market'): void {
    if (disposed) return;
    if (layer === 'market') marketDirty = true;
    if (layer !== 'cursor') overlayDirty = true;
    if (drawing) {
      redrawRequested = true;
      return;
    }
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function draw(now = performance.now()): void {
    frame = 0;
    if (disposed || width < 50 || height < 100) return;
    drawing = true;
    try {
      const wasPanning = !!pan;
      applyPan(now);
      const paintMarket =
        marketDirty || wasPanning || !!scaleMotion?.active || candleMotion.active || !geometry;
      const paintOverlay = overlayDirty || paintMarket;
      if (paintMarket) {
        const target = createGeometry(state, width, height, theme.chart);
        if (
          !scaleMotion ||
          wasPanning ||
          options.scaleMotion === false ||
          reducedMotion.matches ||
          !state.candles.length
        )
          scaleMotion = new ScaleMotion(target);
        else scaleMotion.retarget(target, now, drag ? 40 : 90);
        const ranges = scaleMotion.sample(now);
        geometry = geometryForRanges(
          ranges,
          width,
          height,
          theme.chart,
          stateTimeScale(state),
          geometryLayout(state, ranges.fromMs, ranges.toMs),
        );
        timeAxis.hidden = priceAxis.hidden = !state.candles.length;
        Object.assign(timeAxis.style, {
          left: `${geometry.left}px`,
          bottom: '0',
          width: `${geometry.plotWidth}px`,
          height: `${theme.chart.timeAxisHeight}px`,
        });
        Object.assign(priceAxis.style, {
          left: `${geometry.left + geometry.plotWidth}px`,
          top: `${geometry.top}px`,
          right: '0',
          height: `${geometry.plotHeight}px`,
        });
      }
      // Pan publications above are included in this frame. Host callbacks below
      // may make further edits that still need their own redraw.
      redrawRequested = false;
      marketDirty = overlayDirty = false;
      // The forming candle may be mid-glide; everything else draws the exact state.
      const forming = candleMotion.sample(now);
      const shown =
        forming && forming !== state.candles.at(-1)
          ? { ...state, candles: [...state.candles.slice(0, -1), forming] }
          : state;
      if (paintMarket) {
        ticks = axisTicks(geometry);
        const stats = renderer.render({
          state: shown,
          geometry,
          heatmap: runtime.heatmap,
          theme,
          grid: {
            x: ticks.time.map(tick => tick.position),
            y: [
              ...ticks.price.map(tick => tick.position),
              ...[...ticks.panes.values()].flatMap(list => list.map(tick => tick.position)),
            ],
          },
        });
        options.onStats?.(stats);
      }
      if (paintOverlay) drawOverlay(shown.candles.at(-1));
      drawCursor();
      updateHover();
    } catch (error) {
      cancelPan();
      scaleMotion = null;
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      drawing = false;
      if (redrawRequested || pan?.motion.active || scaleMotion?.active) invalidate('cursor');
      else if (candleMotion.active) invalidate();
    }
  }

  function drawingContext(): DrawingContext {
    return {
      geometry,
      theme,
      intervalMs: state.feed.intervalMs,
      tickSize: state.feed.instrument.tickSize,
      candles: state.candles,
      formatPrice: value => formatPrice.format(value),
      formatTime: value => timeFormats.full(value),
      measureText(text, font) {
        ctx!.save();
        ctx!.font = font;
        const measured = ctx!.measureText(text).width;
        ctx!.restore();
        return measured;
      },
    };
  }
  /** Shift snaps angles; Alt, Ctrl or Command drags a copy. */
  function modifiers(event: PointerEvent): DrawingModifiers {
    return { shift: event.shiftKey, clone: event.altKey || event.ctrlKey || event.metaKey };
  }
  function cancelDrawing(): void {
    pendingTextEdit = null;
    const previous = drawingPointerId;
    drawingPointerId = null;
    drawings.cancel();
    if (previous !== null && root.hasPointerCapture(previous)) root.releasePointerCapture(previous);
  }

  function cancelPan(): void {
    pan?.motion.cancel();
    pan = null;
    const previous = drag;
    drag = null;
    if (previous && root.hasPointerCapture(previous.pointerId))
      root.releasePointerCapture(previous.pointerId);
    root.style.cursor = 'crosshair';
  }

  function applyPan(now: number): void {
    if (!pan) return;
    const current = pan;
    const offset = current.motion.sample(now);
    if (offset.x !== current.appliedX || offset.y !== current.appliedY) {
      current.appliedX = offset.x;
      current.appliedY = offset.y;
      const from = current.scale.logical(current.from),
        to = current.scale.logical(current.to);
      const shift = (offset.x / current.width) * (to - from);
      runtime.execute({
        type: 'viewport.set',
        fromMs: current.scale.time(from - shift),
        toMs: current.scale.time(to - shift),
        ...(current.autoscale
          ? {}
          : {
              priceScale: {
                mode: 'manual' as const,
                ...axis().pan(current.min, current.max, offset.y, current.height),
              },
            }),
      });
    }
    if (!drag && !current.motion.active && pan === current) pan = null;
  }

  function autoscalesOnPan(): boolean {
    return !!options.autoscaleOnPan && state.document.priceScale.mode === 'auto';
  }

  function grabDisplayedRanges(): void {
    if (!scaleMotion || !geometry) {
      geometry = createGeometry(state, width, height, theme.chart);
      return;
    }
    const target = createGeometry(state, width, height, theme.chart);
    const timeChanged = geometry.fromMs !== target.fromMs || geometry.toMs !== target.toMs;
    const priceChanged =
      !autoscalesOnPan() && (geometry.minPrice !== target.minPrice || geometry.maxPrice !== target.maxPrice);
    // Start a grab at the rendered position, not at an unfinished zoom destination.
    if (timeChanged)
      runtime.execute({
        type: 'viewport.set',
        fromMs: geometry.fromMs,
        toMs: geometry.toMs,
        ...(priceChanged
          ? {
              priceScale: {
                mode: 'manual' as const,
                minPrice: geometry.minPrice,
                maxPrice: geometry.maxPrice,
              },
            }
          : {}),
      });
    else if (priceChanged)
      runtime.execute({ type: 'priceScale.set', minPrice: geometry.minPrice, maxPrice: geometry.maxPrice });
    scaleMotion = new ScaleMotion(geometry);
  }

  /** `local` is false for a bar shown because of `setCrosshair`; only local hovers reach crosshair listeners. */
  function publishHover(bar: Candle | null, local = true): void {
    if (bar !== lastHover) {
      lastHover = bar;
      options.onHover?.(bar);
    }
    const time = local && bar ? bar.timeMs : null;
    if (time !== lastCrosshair) {
      lastCrosshair = time;
      for (const listener of crosshairListeners) listener(time);
    }
  }
  /** The loaded bar containing `timeMs`, if any. */
  function barAt(timeMs: number): Candle | null {
    const bars = state.candles;
    let lo = 0,
      hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (bars[mid].timeMs <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    const bar = bars[lo];
    // Tick and range bars have no fixed length: a bar lasts until the next one starts.
    const end = isTimeInterval(state.feed.interval)
      ? bar?.timeMs + state.feed.intervalMs
      : (bars[lo + 1]?.timeMs ?? Infinity);
    return bar && bar.timeMs <= timeMs && timeMs < end ? bar : null;
  }
  function updateHover(): void {
    if (!options.onHover && !crosshairListeners.size) return;
    if (
      pointer &&
      state.candles.length &&
      pointer.x >= geometry.left &&
      pointer.y >= geometry.top &&
      pointer.x <= geometry.left + geometry.plotWidth &&
      pointer.y <= geometry.top + geometry.plotHeight &&
      !['time', 'price'].includes(drag?.kind ?? '')
    ) {
      const anchor = geometry.anchor(pointer.x, pointer.y);
      const bars = state.candles,
        time = anchor.timeMs - state.feed.intervalMs / 2;
      let lo = 0,
        hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (bars[mid].timeMs < time) lo = mid + 1;
        else hi = mid;
      }
      const best = lo > 0 && time - bars[lo - 1].timeMs <= bars[lo].timeMs - time ? bars[lo - 1] : bars[lo];
      publishHover(best);
    } else if (!pointer && syncedTime !== null) publishHover(barAt(syncedTime), false);
    else publishHover(null);
  }

  function labelWidth(ctx: CanvasRenderingContext2D, text: string): number {
    ctx.font = `${theme.typography.markerSize}px ${theme.typography.numberFamily}`;
    return ctx.measureText(text).width + theme.chart.markerPadding * 2;
  }
  function label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color = theme.palette.markerText,
    background = theme.palette.markerBackground,
  ): void {
    const w = labelWidth(ctx, text),
      h = theme.chart.markerHeight;
    ctx.fillStyle = background;
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + theme.chart.markerPadding, y + theme.typography.markerSize * 0.35);
  }

  /** Readable text over a drawing's own colour on the axis. */
  function inkFor(color: string): string {
    const hex = color.slice(1),
      full = hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c).join('') : hex.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#0b0f14' : '#ffffff';
  }
  function drawingAxis(ctx: CanvasRenderingContext2D, g: ChartGeometry): DrawingAxisPainter {
    const axisLeft = g.left + g.plotWidth + theme.effects.borderWidth,
      timeTop = height - theme.chart.timeAxisHeight;
    return {
      tag(axis, value, color, text) {
        if (axis === 'price') {
          const y = g.y(value);
          if (y < g.top || y > g.top + g.plotHeight) return;
          label(ctx, text ?? formatPrice.format(value), axisLeft, y, inkFor(color), color);
        } else {
          const x = g.x(value);
          if (x < g.left || x > g.left + g.plotWidth) return;
          const shown = text ?? timeFormats.full(value),
            w = labelWidth(ctx, shown);
          label(
            ctx,
            shown,
            Math.max(g.left, Math.min(g.left + g.plotWidth - w, x - w / 2)),
            timeTop + theme.chart.timeAxisHeight / 2,
            inkFor(color),
            color,
          );
        }
      },
      band(axis, from, to, color) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.18;
        if (axis === 'price') {
          const top = Math.max(g.top, g.y(to)),
            bottom = Math.min(g.top + g.plotHeight, g.y(from));
          if (bottom > top) ctx.fillRect(axisLeft, top, width - axisLeft, bottom - top);
        } else {
          const left = Math.max(g.left, g.x(from)),
            right = Math.min(g.left + g.plotWidth, g.x(to));
          if (right > left) ctx.fillRect(left, timeTop, right - left, theme.chart.timeAxisHeight);
        }
        ctx.restore();
      },
    };
  }

  function clearOverlay(target: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (target.width !== Math.round(width * dpr) || target.height !== Math.round(height * dpr)) {
      target.width = Math.round(width * dpr);
      target.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
  }
  const profiles: ProfileCache = new Map();
  const footprints: FootprintCache = new WeakMap();
  let priceLines: PriceLine[] = [];
  let markers: ChartMarker[] = [];
  const lineDragListeners = new Set<PriceLineDragListener>();
  const lineActionListeners = new Set<PriceLineActionListener>();
  /** Where the × boxes were drawn last, for click and hover tests. */
  let closeBoxes: PriceLineCloseBox[] = [];
  let lineDrag: {
    line: PriceLine;
    pointerId: number;
    price: number;
    label: string | null;
  } | null = null;

  /** Tells listeners about a line drag; the last string returned labels the dragged line. */
  function emitLineDrag(phase: PriceLineDragEvent['phase']): void {
    if (!lineDrag) return;
    const event: PriceLineDragEvent = {
      id: lineDrag.line.id!,
      phase,
      mode: lineDrag.line.drag!,
      fromPrice: lineDrag.line.price,
      price: lineDrag.price,
    };
    for (const listener of lineDragListeners) {
      const label = listener(event);
      if (typeof label === 'string') lineDrag.label = label;
    }
  }

  /** The host's lines with the dragged one moved, or a copy added, while a drag runs. */
  function shownPriceLines(): readonly PriceLine[] {
    if (!lineDrag) return priceLines;
    const { line, price, label } = lineDrag;
    const dragged: PriceLine = { ...line, price, style: 'dashed', label: label ?? line.label };
    return line.drag === 'move'
      ? priceLines.map(other => (other.id === line.id ? dragged : other))
      : [...priceLines, dragged];
  }

  function endLineDrag(phase: 'end' | 'cancel'): void {
    if (!lineDrag) return;
    emitLineDrag(phase);
    if (root.hasPointerCapture(lineDrag.pointerId)) root.releasePointerCapture(lineDrag.pointerId);
    lineDrag = null;
    root.style.cursor = 'crosshair';
    invalidate('overlay');
  }
  function drawOverlay(latest = state.candles.at(-1)): void {
    if (!ctx) return;
    clearOverlay(overlay, ctx);
    if (!state.candles.length) return;
    const g = geometry;
    renderFootprints(ctx, state, g, theme, footprints);
    renderProfiles(ctx, state, g, theme, profiles, timeZone);
    renderIndicatorDots(ctx, state, g, theme);
    renderBubbles(ctx, state, g, theme);
    renderFlowSignals(ctx, state, g, theme);
    ctx.font = `${theme.typography.axisSize}px ${theme.typography.numberFamily}`;
    ctx.fillStyle = themeColor(theme, theme.chart.axisColor);
    ctx.textAlign = 'left';
    const size = theme.typography.axisSize;
    for (const tick of ticks.price) {
      // Keep labels whole inside the plot's vertical extent.
      if (tick.position < g.top + size * 0.4 || tick.position > g.top + g.plotHeight - size * 0.2) continue;
      ctx.fillText(
        tick.label,
        g.left + g.plotWidth + theme.chart.axisLabelPadding,
        tick.position + size * 0.4,
      );
    }
    drawPanes(g);
    const timeBaseline = height - theme.chart.timeAxisHeight / 2 + size * 0.2;
    const regular = `${size}px ${theme.typography.numberFamily}`,
      bold = `${Math.min(900, Number(theme.typography.uiWeight) + 200) || 600} ${size}px ${theme.typography.numberFamily}`;
    ctx.textAlign = 'center';
    for (const tick of ticks.time) {
      // Day, month and year boundaries stand out from clock times.
      ctx.font = tick.rank >= TICK_RANK.day ? bold : regular;
      const half = ctx.measureText(tick.label).width / 2;
      const x = Math.max(g.left + half, Math.min(g.left + g.plotWidth - half, tick.position));
      ctx.fillText(tick.label, x, timeBaseline);
    }
    ctx.font = regular;
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.palette.textFaint;
    if (state.document.layers.volume && g.volumeHeight > 0)
      ctx.fillText(
        `VOLUME · ${state.feed.instrument.base}`,
        g.left + theme.chart.axisLabelPadding * 0.4,
        g.volumeTop + theme.typography.axisSize * 0.9,
      );
    ctx.fillText(timeFormats.zone, g.left + g.plotWidth + theme.chart.axisLabelPadding, timeBaseline);
    ctx.strokeStyle = theme.palette.border;
    ctx.lineWidth = theme.effects.borderWidth;
    if (theme.effects.borderWidth > 0) {
      ctx.beginPath();
      ctx.moveTo(g.left, g.volumeTop - theme.chart.volumeGap / 2);
      ctx.lineTo(g.left + g.plotWidth, g.volumeTop - theme.chart.volumeGap / 2);
      ctx.stroke();
    }
    if (state.olderHistory.status === 'loading' && g.x(state.candles[0].timeMs) > g.left) {
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.palette.textFaint;
      ctx.fillText(
        'Loading history…',
        g.left + theme.chart.axisLabelPadding,
        g.top + theme.typography.axisSize * 1.4,
      );
    }
    renderMarkers(ctx, markers, state.candles, state.feed.intervalMs, g, theme);
    if (latest) {
      const y = g.y(latest.close);
      if (y >= g.top && y <= g.top + g.plotHeight) {
        ctx.strokeStyle = themeColorCSS(theme, theme.chart.lastPriceColor, theme.chart.lastPriceOpacity);
        ctx.lineWidth = theme.chart.lastPriceWidth;
        ctx.setLineDash([...theme.chart.lastPriceDash]);
        if (theme.chart.lastPriceWidth > 0) {
          ctx.beginPath();
          ctx.moveTo(g.left, y);
          ctx.lineTo(g.left + g.plotWidth, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // The marker glides with the candle; its text is always the last traded price.
        const exact = state.candles.at(-1)?.close ?? latest.close;
        label(ctx, formatPrice.format(exact), g.left + g.plotWidth + theme.effects.borderWidth, y);
      }
    }
    // Orders and positions sit above the last-price line, so their tags stay legible.
    closeBoxes = renderPriceLines(ctx, shownPriceLines(), g, theme, price => formatPrice.format(price));
    renderDrawings(
      ctx,
      drawings.visible(),
      runtime.drawingRegistry,
      drawingContext(),
      drawings.selectionId(),
      {
        hoverId: drawings.hoverId,
        axis: drawingAxis(ctx, g),
      },
    );
    ctx.font = `${theme.typography.uiWeight} ${theme.typography.watermarkSize}px ${theme.typography.uiFamily}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = themeColorCSS(theme, '@watermark', theme.chart.watermarkOpacity);
    ctx.fillText(
      theme.chart.watermarkText,
      g.left + g.plotWidth - theme.chart.axisLabelPadding,
      g.top + g.plotHeight - theme.chart.axisLabelPadding,
    );
  }

  let ticks: { price: AxisTick[]; time: AxisTick[]; panes: Map<string, AxisTick[]> } = {
    price: [],
    time: [],
    panes: new Map(),
  };
  let zoneOffset = zoneOffsets(timeZone);
  /** Round-value price marks and calendar-aligned time marks that move with the data. */
  /** Average time per bar across the bars in view, for tick and range bars. */
  function visibleBarMs(g: ChartGeometry): number | undefined {
    const bars = state.candles;
    const from = Math.max(0, Math.floor(g.timeScale.logical(g.fromMs)));
    const to = Math.min(bars.length - 1, Math.ceil(g.timeScale.logical(g.toMs)));
    return to > from ? (bars[to].timeMs - bars[from].timeMs) / (to - from) : undefined;
  }

  function axisTicks(g: ChartGeometry) {
    const size = theme.typography.axisSize;
    ctx!.font = `${size}px ${theme.typography.numberFamily}`;
    const widest = Math.max(...['00:00', '2026', 'Sept', '28'].map(sample => ctx!.measureText(sample).width));
    const spacing = Math.max(size * 2.4, theme.chart.axisLabelPadding * 2) + 6;
    return {
      price: priceTicks(g, value => formatPrice.format(value), spacing),
      time: timeTicks(g, {
        candles: state.candles,
        intervalMs: state.feed.intervalMs,
        barMs: isTimeInterval(state.feed.interval) ? undefined : visibleBarMs(g),
        offset: zoneOffset,
        label: (time, rank) => timeFormats.tick(time, rank),
        spacing: Math.max(56, widest + theme.chart.axisLabelPadding * 3),
      }),
      panes: new Map(
        g.panes.map(pane => [
          pane.id,
          valueTicks(
            pane.min,
            pane.max,
            pane.height,
            pane.y,
            value => formatValue(value, pane.max - pane.min),
            32,
          ),
        ]),
      ),
    };
  }
  /** Titles, latest values, guide levels and axis labels for indicator panes. */
  function drawPanes(g: ChartGeometry): void {
    if (!ctx || !g.panes.length) return;
    const pad = theme.chart.axisLabelPadding,
      size = theme.typography.axisSize;
    for (const pane of g.panes) {
      const item = state.indicators.find(i => i.plugin.id === pane.id);
      if (!item) continue;
      const { plugin, series } = item;
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.left, pane.top, g.plotWidth, pane.height);
      ctx.clip();
      ctx.strokeStyle = themeColorCSS(theme, theme.chart.axisColor, 0.45);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      for (const level of plugin.levels ?? []) {
        const y = Math.round(pane.y(level)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.left + g.plotWidth, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      ctx.font = `${size}px ${theme.typography.numberFamily}`;
      ctx.textAlign = 'left';
      let x = g.left + pad * 0.4;
      const baseline = pane.top + size * 1.1;
      ctx.fillStyle = theme.palette.textFaint;
      ctx.fillText(plugin.name, x, baseline);
      x += ctx.measureText(plugin.name).width + pad;
      if (plugin.display === 'candles') {
        // Candle panes show the latest close, colored by the bar's direction.
        const close = series[3]?.at(-1),
          open = series[0]?.at(-1);
        if (close !== undefined && open !== undefined && Number.isFinite(close)) {
          ctx.fillStyle = close >= open ? theme.palette.positive : theme.palette.negative;
          ctx.fillText(formatValue(close, pane.max - pane.min), x, baseline);
        }
      } else
        (plugin.outputs?.length ? plugin.outputs : [{ name: '', color: plugin.color }]).forEach((_, k) => {
          const value = series[k]?.at(-1);
          if (value === undefined || !Number.isFinite(value)) return;
          const [r, gr, b] = indicatorColor(theme, plugin, k);
          ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(gr * 255)} ${Math.round(b * 255)})`;
          const text = formatValue(value, pane.max - pane.min);
          ctx.fillText(text, x, baseline);
          x += ctx.measureText(text).width + pad * 0.75;
        });
      ctx.fillStyle = themeColor(theme, theme.chart.axisColor);
      const marks = plugin.levels?.length
        ? plugin.levels.map(value => ({ value, position: pane.y(value) }))
        : (ticks.panes.get(pane.id) ?? []);
      for (const { value, position } of marks) {
        if (position < pane.top + size * 0.5 || position > pane.top + pane.height - size * 0.2) continue;
        ctx.fillText(
          formatValue(value, pane.max - pane.min),
          g.left + g.plotWidth + pad,
          position + size * 0.4,
        );
      }
    }
  }
  /** Pane values span many magnitudes (RSI 0 to 100, MACD fractions); keep four significant digits. */
  function formatValue(value: number, span: number): string {
    if (!Number.isFinite(value)) return '—';
    // Enough decimals to tell apart values a hundredth of the pane apart.
    const digits = Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(Math.max(1e-9, span)))));
    return value.toFixed(digits);
  }
  function drawCursor(): void {
    if (!cursorCtx) return;
    const ctx = cursorCtx,
      g = geometry;
    clearOverlay(cursorCanvas, ctx);
    if (!state.candles.length) return;
    const inPrice = !!pointer && pointer.y >= g.top && pointer.y <= g.top + g.plotHeight;
    const at = pointer;
    const pane = at && g.panes.find(p => at.y >= p.top && at.y <= p.top + p.height);
    if (pointer && pointer.x >= g.left && pointer.x <= g.left + g.plotWidth && (inPrice || pane)) {
      ctx.strokeStyle = themeColorCSS(theme, theme.chart.crosshairColor, theme.chart.crosshairOpacity);
      ctx.lineWidth = theme.chart.crosshairWidth;
      ctx.setLineDash([...theme.chart.crosshairDash]);
      if (theme.chart.crosshairWidth > 0) {
        ctx.beginPath();
        ctx.moveTo(pointer.x, g.top);
        ctx.lineTo(pointer.x, g.bottom);
        ctx.moveTo(g.left, pointer.y);
        ctx.lineTo(g.left + g.plotWidth, pointer.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const anchor = g.anchor(pointer.x, pointer.y);
      const text = themeColor(theme, theme.chart.crosshairLabelText),
        background = themeColor(theme, theme.chart.crosshairLabelBackground);
      label(
        ctx,
        pane ? formatValue(pane.value(pointer.y), pane.max - pane.min) : formatPrice.format(anchor.price),
        g.left + g.plotWidth + theme.effects.borderWidth,
        pointer.y,
        text,
        background,
      );
      const time = timeFormats.full(anchor.timeMs),
        w = labelWidth(ctx, time);
      label(
        ctx,
        time,
        Math.max(g.left, Math.min(g.left + g.plotWidth - w, pointer.x - w / 2)),
        height - theme.chart.timeAxisHeight / 2,
        text,
        background,
      );
    } else if (!pointer && syncedTime !== null) drawSyncedTime(ctx, g, syncedTime);
  }
  function drawSyncedTime(ctx: CanvasRenderingContext2D, g: ChartGeometry, timeMs: number): void {
    const bar = barAt(timeMs);
    const x = bar ? g.x(bar.timeMs + state.feed.intervalMs / 2) : g.x(timeMs);
    if (!(x >= g.left && x <= g.left + g.plotWidth)) return;
    if (theme.chart.crosshairWidth > 0) {
      ctx.strokeStyle = themeColorCSS(theme, theme.chart.crosshairColor, theme.chart.crosshairOpacity);
      ctx.lineWidth = theme.chart.crosshairWidth;
      ctx.setLineDash([...theme.chart.crosshairDash]);
      ctx.beginPath();
      ctx.moveTo(x, g.top);
      ctx.lineTo(x, g.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const time = timeFormats.full(bar?.timeMs ?? timeMs),
      w = labelWidth(ctx, time);
    label(
      ctx,
      time,
      Math.max(g.left, Math.min(g.left + g.plotWidth - w, x - w / 2)),
      height - theme.chart.timeAxisHeight / 2,
      themeColor(theme, theme.chart.crosshairLabelText),
      themeColor(theme, theme.chart.crosshairLabelBackground),
    );
  }

  let olderRequest = false;
  /** Pages history once the view comes within 50 bars of the first loaded bar. */
  function requestOlderIfNear(next: RuntimeState): void {
    if (olderRequest || next.olderHistory.status !== 'idle' || !next.candles.length) return;
    if (stateTimeScale(next).logical(next.document.viewport.fromMs) > 50) return;
    olderRequest = true;
    // Defer: this runs inside a runtime publication.
    queueMicrotask(() => {
      olderRequest = false;
      if (!disposed) runtime.loadOlderHistory();
    });
  }
  function point(event: MouseEvent): { x: number; y: number } {
    const r = root.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  /** Price-axis math for the current scale type. */
  function axis() {
    return priceAxisMath(!!state.document.priceScale.log, state.feed.instrument.tickSize);
  }
  /** Runs a time-range calculation in bar units and converts the result back to time. */
  function inBars(
    fromMs: number,
    toMs: number,
    change: (from: number, to: number) => { fromMs: number; toMs: number },
  ): { fromMs: number; toMs: number } {
    const scale = stateTimeScale(state);
    const next = change(scale.logical(fromMs), scale.logical(toMs));
    return { fromMs: scale.time(next.fromMs), toMs: scale.time(next.toMs) };
  }
  function dragTime(fromMs: number, toMs: number, dx: number, plotWidth: number) {
    return inBars(fromMs, toMs, (from, to) => dragTimeScale(from, to, dx, plotWidth, 1));
  }
  function zoom(factor: number, anchorFraction = 0.5): void {
    const v = state.document.viewport;
    runtime.execute({
      type: 'viewport.set',
      ...inBars(v.fromMs, v.toMs, (from, to) => {
        const span = Math.min(2200, Math.max(25, (to - from) * factor));
        const anchor = from + (to - from) * anchorFraction;
        return { fromMs: anchor - span * anchorFraction, toMs: anchor + span * (1 - anchorFraction) };
      }),
    });
  }

  root.addEventListener(
    'wheel',
    event => {
      // The chart owns wheel gestures while hovered, including trackpad pinch.
      // Cancel before checking geometry so loading charts cannot scroll the page either.
      event.preventDefault();
      if (!geometry || !state.candles.length) return;
      cancelPan();
      cancelDrawing();
      const targetGeometry = createGeometry(state, width, height, theme.chart);
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? height
            : 1;
      const delta = Math.max(-100, Math.min(100, (event.deltaY || event.deltaX) * unit));
      if (event.target === priceAxis) {
        runtime.execute({
          type: 'priceScale.set',
          ...axis().drag(targetGeometry.minPrice, targetGeometry.maxPrice, delta, PRICE_WHEEL_HEIGHT),
        });
      } else
        zoom(
          Math.exp(delta * 0.002),
          Math.max(0, Math.min(1, (point(event).x - geometry.left) / geometry.plotWidth)),
        );
    },
    { passive: false, signal: abort.signal },
  );
  root.addEventListener(
    'pointerdown',
    event => {
      if (!geometry || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      if (!state.candles.length) return;
      cancelPan();
      if (!drawings.interacting) grabDisplayedRanges();
      (event.target === timeAxis ? timeAxis : event.target === priceAxis ? priceAxis : root).focus({
        preventScroll: true,
      });
      const p = point(event);
      pointer = p;
      if (event.target === timeAxis || event.target === priceAxis) {
        cancelDrawing();
        drag = {
          kind: event.target === timeAxis ? 'time' : 'price',
          pointerId: event.pointerId,
          started: performance.now(),
          x: p.x,
          y: p.y,
          from: state.document.viewport.fromMs,
          to: state.document.viewport.toMs,
          min: geometry.minPrice,
          max: geometry.maxPrice,
          width: geometry.plotWidth,
          height: geometry.plotHeight,
        };
        root.setPointerCapture(event.pointerId);
        root.style.cursor = drag.kind === 'time' ? 'ew-resize' : 'ns-resize';
        return;
      }
      if (
        p.x < geometry.left ||
        p.y < geometry.top ||
        p.x > geometry.left + geometry.plotWidth ||
        p.y > geometry.top + geometry.plotHeight
      )
        return;
      const closeBox =
        drawings.currentTool === 'cursor' && !lineDrag ? hitCloseBox(closeBoxes, p.x, p.y) : null;
      if (closeBox) {
        for (const listener of lineActionListeners) listener({ id: closeBox.id, action: 'close' });
        return;
      }
      const grabbed = drawings.currentTool === 'cursor' ? hitPriceLine(priceLines, geometry, p.x, p.y) : null;
      if (grabbed) {
        lineDrag = { line: grabbed, pointerId: event.pointerId, price: grabbed.price, label: null };
        root.setPointerCapture(event.pointerId);
        root.style.cursor = 'ns-resize';
        emitLineDrag('start');
        invalidate('overlay');
        return;
      }
      const placing = drawings.currentTool !== 'cursor';
      if (drawings.down(p, drawingContext(), modifiers(event))) {
        if (
          placing &&
          !drawings.interacting &&
          drawings.selected &&
          runtime.drawingRegistry.get(drawings.selected.type)?.editableText
        )
          pendingTextEdit = drawings.selected.id;
        drawingPointerId = event.pointerId;
        root.setPointerCapture(event.pointerId);
        root.style.cursor = drawings.cursor(p, drawingContext());
        invalidate('overlay');
        return;
      }
      drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        started: performance.now(),
        x: p.x,
        y: p.y,
        from: state.document.viewport.fromMs,
        to: state.document.viewport.toMs,
        min: geometry.minPrice,
        max: geometry.maxPrice,
        width: geometry.plotWidth,
        height: geometry.plotHeight,
      };
      root.setPointerCapture(event.pointerId);
      root.style.cursor = 'grabbing';
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointermove',
    event => {
      if (!geometry || !event.isPrimary) return;
      pointer = point(event);
      if (lineDrag) {
        const tick = state.feed.instrument.tickSize;
        const price = Math.round(geometry.price(pointer.y) / tick) * tick;
        const snapped = Number(price.toFixed(state.feed.instrument.pricePrecision));
        if (snapped !== lineDrag.price) {
          lineDrag.price = snapped;
          emitLineDrag('move');
          invalidate('overlay');
        }
        return;
      }
      const hovered = drawings.hoverId;
      if (!drag)
        root.style.cursor =
          drawings.currentTool === 'cursor' && hitCloseBox(closeBoxes, pointer.x, pointer.y)
            ? 'pointer'
            : drawings.currentTool === 'cursor' && hitPriceLine(priceLines, geometry, pointer.x, pointer.y)
              ? 'ns-resize'
              : drawings.cursor(pointer, drawingContext());
      if (drawings.hoverId !== hovered) invalidate('overlay');
      if (!drag && drawings.move(pointer, drawingContext(), modifiers(event))) {
        invalidate('overlay');
        return;
      }
      if (drag?.kind === 'time') {
        runtime.execute({
          type: 'viewport.set',
          ...dragTime(drag.from, drag.to, pointer.x - drag.x, drag.width),
        });
      } else if (drag?.kind === 'price') {
        runtime.execute({
          type: 'priceScale.set',
          ...axis().drag(drag.min, drag.max, pointer.y - drag.y, drag.height),
        });
      } else if (drag) {
        const dx = pointer.x - drag.x,
          dy = pointer.y - drag.y;
        // A click must not disable live following or autoscale. Once dragging starts,
        // use the pointer-down ranges so autoscale and feed ticks cannot fight it.
        drag.moved ||= Math.hypot(dx, dy) >= 3;
        if (drag.moved) {
          if (!pan) {
            const origin = drag;
            // Pan in bar units so session gaps scroll past at the same speed as bars.
            const scale = stateTimeScale(state);
            const from = scale.logical(origin.from),
              to = scale.logical(origin.to);
            const history = {
              firstMs: scale.logical(state.candles[0].timeMs),
              lastMs: scale.logical(state.candles.at(-1)!.timeMs),
              intervalMs: 1,
            };
            const priceMath = axis();
            const autoscale = autoscalesOnPan();
            const motion = new PanMotion(origin.started, {
              smooth: options.panMotion !== false && !reducedMotion.matches,
              constrain(offset) {
                const time = panTimeScale(from, to, offset.x, origin.width, history);
                const x = ((from - time.fromMs) / (to - from)) * origin.width;
                if (autoscale) return { x, y: 0 };
                const price = priceMath.pan(origin.min, origin.max, offset.y, origin.height);
                return {
                  x,
                  y: priceMath.offset({ minPrice: origin.min, maxPrice: origin.max }, price, origin.height),
                };
              },
            });
            pan = { ...origin, motion, scale, appliedX: 0, appliedY: 0, autoscale };
          }
          const now = performance.now();
          pan.motion.move(pointer.x - pan.x, pointer.y - pan.y, now);
          // Consume pointer overshoot at both limits, so reversing responds immediately.
          pan.x = pointer.x;
          pan.y = pointer.y;
          if (options.panMotion === false || reducedMotion.matches) applyPan(now);
        }
      }
      invalidate('cursor');
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointerup',
    event => {
      if (lineDrag?.pointerId === event.pointerId) {
        endLineDrag('end');
        return;
      }
      if (drawingPointerId === event.pointerId) {
        const placing = drawings.currentTool !== 'cursor';
        drawingPointerId = null;
        drawings.up(point(event), drawingContext(), modifiers(event));
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        root.style.cursor = 'crosshair';
        invalidate('overlay');
        const editId = pendingTextEdit;
        pendingTextEdit = null;
        if ((editId && drawings.selected?.id === editId) || (placing && !drawings.interacting))
          editSelectedDrawing(true);
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      pan?.motion.release(performance.now());
      drag = null;
      root.style.cursor = 'crosshair';
      invalidate();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointercancel',
    () => {
      endLineDrag('cancel');
      cancelPan();
      cancelDrawing();
      invalidate();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'lostpointercapture',
    () => {
      endLineDrag('cancel');
      if (drag) cancelPan();
      if (drawingPointerId !== null) cancelDrawing();
      invalidate();
    },
    { signal: abort.signal },
  );
  window.addEventListener(
    'blur',
    () => {
      cancelPan();
      cancelDrawing();
      invalidate();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelPan();
        cancelDrawing();
      }
    },
    { signal: abort.signal },
  );
  reducedMotion.addEventListener(
    'change',
    () => {
      cancelPan();
      scaleMotion = null;
      invalidate();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'pointerleave',
    () => {
      if (!drag) {
        pointer = null;
        if (drawings.hoverId) {
          drawings.leave();
          invalidate('overlay');
        }
        publishHover(null);
        invalidate('cursor');
      }
    },
    { signal: abort.signal },
  );
  function editSelectedDrawing(placement = false): boolean {
    const selected = drawings.selected;
    if (!selected?.visible || selected.locked || drawings.interacting || !options.onDrawingEdit) return false;
    const definition = runtime.drawingRegistry.get(selected.type);
    // Placement opens only the annotation editor; activation opens any registered tool's settings.
    if (!definition || (placement && !definition.editableText)) return false;
    options.onDrawingEdit(structuredClone(selected));
    return true;
  }
  root.addEventListener(
    'dblclick',
    event => {
      if (event.target !== timeAxis && event.target !== priceAxis && editSelectedDrawing()) {
        event.preventDefault();
        return;
      }
      if (
        event.target !== timeAxis &&
        event.target !== priceAxis &&
        (drawings.currentTool !== 'cursor' || drawings.selected)
      ) {
        drawings.finish();
        editSelectedDrawing();
        invalidate();
        return;
      }
      cancelDrawing();
      cancelPan();
      const p = point(event);
      const onPriceAxis =
        geometry &&
        p.x >= geometry.left + geometry.plotWidth &&
        p.y >= geometry.top &&
        p.y <= geometry.top + geometry.plotHeight;
      runtime.execute({ type: onPriceAxis ? 'priceScale.reset' : 'viewport.reset' });
      if (!onPriceAxis && p.y < height - theme.chart.timeAxisHeight)
        runtime.execute({ type: 'priceScale.reset' });
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    event => {
      const modifier = event.metaKey || event.ctrlKey,
        key = event.key.toLowerCase();
      // Alt hotkeys pick common tools. Codes, not keys, because Option changes the key on macOS.
      const hotkey = event.altKey && !modifier && !event.shiftKey ? DRAWING_HOTKEYS[event.code] : undefined;
      if (hotkey && runtime.drawingRegistry.get(hotkey)) {
        event.preventDefault();
        cancelPan();
        cancelDrawing();
        drawings.setTool(hotkey);
        invalidate('overlay');
        return;
      }
      if (event.key === 'Enter' && event.target !== timeAxis && event.target !== priceAxis) {
        event.preventDefault();
        if (!editSelectedDrawing()) {
          drawings.finish();
          editSelectedDrawing();
        }
        invalidate();
        return;
      }
      if (['Delete', 'Backspace'].includes(event.key) && drawings.selected) {
        event.preventDefault();
        if (!drawings.selected.locked) runtime.execute({ type: 'drawing.remove', id: drawings.selected.id });
        return;
      }
      if (modifier && ['c', 'v', 'd', 'y'].includes(key)) {
        event.preventDefault();
        cancelPan();
        try {
          if (key === 'c') drawings.copy();
          else if (key === 'v') drawings.paste();
          else if (key === 'y') {
            cancelDrawing();
            runtime.execute({ type: 'history.redo' });
          } else if (drawings.selected) {
            const id = crypto.randomUUID();
            runtime.execute({
              type: 'drawing.duplicate',
              id: drawings.selected.id,
              newId: id,
              offset: { timeMs: state.feed.intervalMs * 3, price: 0 },
            });
            drawings.select(id);
          }
        } catch (error) {
          options.onError?.(toChartError(error));
        }
        invalidate();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key))
        cancelDrawing();
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '=',
          '-',
          'Home',
          'Enter',
          'Escape',
        ].includes(event.key) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')
      ) {
        cancelPan();
      }
      if ((event.target === timeAxis || event.target === priceAxis) && geometry) {
        if (['Home', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'Home' || event.key === 'Enter')
            runtime.execute({ type: event.target === priceAxis ? 'priceScale.reset' : 'viewport.reset' });
          else if (event.target === timeAxis) {
            const v = state.document.viewport;
            const dx = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 25 : -25;
            runtime.execute({
              type: 'viewport.set',
              ...dragTime(v.fromMs, v.toMs, dx, geometry.plotWidth),
            });
          } else {
            const dy = ['ArrowRight', 'ArrowUp'].includes(event.key) ? -25 : 25;
            const target = createGeometry(state, width, height, theme.chart);
            runtime.execute({
              type: 'priceScale.set',
              ...axis().drag(target.minPrice, target.maxPrice, dy, geometry.plotHeight),
            });
          }
          return;
        }
      }
      const v = state.document.viewport;
      if (
        ['ArrowLeft', 'ArrowRight', '+', '=', '-', 'Home', 'Escape'].includes(event.key) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')
      )
        event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        runtime.execute({
          type: 'viewport.set',
          ...inBars(v.fromMs, v.toMs, (from, to) => {
            const step = (to - from) * 0.1 * direction;
            return { fromMs: from + step, toMs: to + step };
          }),
        });
      } else if (event.key === '+' || event.key === '=') zoom(0.8);
      else if (event.key === '-') zoom(1.25);
      else if (event.key === 'Home') runtime.execute({ type: 'viewport.reset' });
      else if (event.key === 'Escape') {
        endLineDrag('cancel');
        cancelDrawing();
        drawings.setTool('cursor');
        invalidate();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        cancelDrawing();
        runtime.execute({ type: event.shiftKey ? 'history.redo' : 'history.undo' });
      }
    },
    { signal: abort.signal },
  );

  try {
    renderer.mount(canvas, invalidate, showError);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
  const resize = new ResizeObserver(entries => {
    cancelPan();
    cancelDrawing();
    scaleMotion = null;
    width = entries[0].contentRect.width;
    height = entries[0].contentRect.height;
    invalidate();
  });
  resize.observe(root);
  document.fonts?.addEventListener('loadingdone', () => invalidate(), { signal: abort.signal });
  function loadCanvasFonts(): void {
    const fonts = document.fonts;
    if (!fonts) return;
    // Canvas-only fonts may not otherwise be requested by the browser.
    const requests = [
      `${theme.typography.axisSize}px ${theme.typography.numberFamily}`,
      `${theme.chart.drawingFontSize}px ${theme.typography.annotationFamily}`,
      `${theme.typography.uiWeight} ${theme.typography.watermarkSize}px ${theme.typography.uiFamily}`,
    ].map(font => fonts.load(font));
    void Promise.allSettled(requests).then(() => {
      if (!disposed) invalidate();
    });
  }
  loadCanvasFonts();
  let unsubscribe = () => {};
  try {
    drawings.configure({
      style: {
        color: theme.palette.drawing,
        width: theme.chart.drawingWidth,
        fontSize: theme.chart.drawingFontSize,
        fillOpacity: theme.chart.drawingFillOpacity,
      },
    });
    unsubscribe = runtime.subscribe(next => {
      if (next.generation !== state.generation || (!state.candles.length && next.candles.length))
        scaleMotion = null;
      if (next.generation !== state.generation) {
        cancelPan();
        cancelDrawing();
        pointer = null;
        publishHover(null);
      }
      if (next.feed.intervalMs !== state.feed.intervalMs)
        timeFormats = createTimeFormats(next.feed.intervalMs, timeZone);
      if (next.feed.instrument.pricePrecision !== state.feed.instrument.pricePrecision)
        formatPrice = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: next.feed.instrument.pricePrecision,
          maximumFractionDigits: next.feed.instrument.pricePrecision,
        });
      // A tick inside the same bar glides; a new bar or a market change snaps.
      candleMotion.retarget(
        next.generation === state.generation ? next.candles.at(-1) : undefined,
        performance.now(),
        options.candleMotion === false || reducedMotion.matches ? 0 : 180,
      );
      if (next.generation !== state.generation) candleMotion.retarget(next.candles.at(-1), 0, 0);
      state = next;
      drawings.sync(next);
      requestOlderIfNear(next);
      if (!renderError) {
        const message = next.candles.length
          ? null
          : (next.error ?? (next.paused ? 'Paused. Resume to load this market.' : 'Loading market history…'));
        notice.textContent = message ?? '';
        notice.style.display = message ? 'block' : 'none';
      }
      invalidate();
    });
    runtime.start();
  } catch (error) {
    disposed = true;
    cancelAnimationFrame(frame);
    abort.abort();
    resize.disconnect();
    unsubscribe();
    runtime.dispose();
    renderer.dispose();
    root.remove();
    throw error;
  }
  return {
    setTheme(value) {
      const next = resolveTheme(value);
      const defaults = drawings.inspect().options.style,
        patch: Partial<DrawingStyle> = {};
      if (defaults.color === theme.palette.drawing) patch.color = next.palette.drawing;
      if (defaults.width === theme.chart.drawingWidth) patch.width = next.chart.drawingWidth;
      if (defaults.fontSize === theme.chart.drawingFontSize) patch.fontSize = next.chart.drawingFontSize;
      if (defaults.fillOpacity === theme.chart.drawingFillOpacity)
        patch.fillOpacity = next.chart.drawingFillOpacity;
      cancelPan();
      cancelDrawing();
      scaleMotion = null;
      theme = next;
      geometry = createGeometry(state, width, height, theme.chart);
      reflectTheme();
      loadCanvasFonts();
      invalidate();
      try {
        if (Object.keys(patch).length) drawings.configure({ style: patch });
      } finally {
        options.onThemeChange?.(structuredClone(theme));
      }
    },
    getTheme: () => structuredClone(theme),
    setTimeZone(value) {
      timeFormats = createTimeFormats(state.feed.intervalMs, value);
      zoneOffset = zoneOffsets(value);
      timeZone = value;
      invalidate('overlay');
    },
    replaceFeed: (feed, revision) => {
      cancelPan();
      cancelDrawing();
      runtime.replaceFeed(feed, revision);
    },
    execute: (command, revision, executeOptions) => {
      cancelPan();
      cancelDrawing();
      return runtime.execute(command, revision, executeOptions);
    },
    preview: (commands, revision) => runtime.preview(commands, revision),
    query: request => runtime.query(request),
    inspect: () => runtime.inspect(),
    exportDocument: () => runtime.exportDocument(),
    restoreDocument: (value, revision, restoreOptions) => {
      cancelPan();
      cancelDrawing();
      runtime.restoreDocument(value, revision, restoreOptions);
    },
    subscribe: listener => runtime.subscribe(listener),
    setPriceLines(lines) {
      priceLines = copyPriceLines(lines);
      invalidate('overlay');
    },
    setMarkers(next) {
      markers = copyMarkers(next);
      invalidate('overlay');
    },
    subscribePriceLineDrag(listener) {
      lineDragListeners.add(listener);
      return () => void lineDragListeners.delete(listener);
    },
    subscribePriceLineAction(listener) {
      lineActionListeners.add(listener);
      return () => void lineActionListeners.delete(listener);
    },
    priceAt(clientX, clientY) {
      if (!geometry) return null;
      const box = root.getBoundingClientRect();
      const x = clientX - box.left,
        y = clientY - box.top;
      const g = geometry;
      if (x < g.left || x > g.left + g.plotWidth || y < g.top || y > g.top + g.plotHeight) return null;
      const { tickSize, pricePrecision } = state.feed.instrument;
      const price = Number((Math.round(g.price(y) / tickSize) * tickSize).toFixed(pricePrecision));
      return { price, timeMs: g.anchor(x, y).timeMs };
    },
    setCrosshair(timeMs) {
      const next = timeMs === null || !Number.isFinite(timeMs) ? null : timeMs;
      if (next === syncedTime) return;
      syncedTime = next;
      invalidate('cursor');
    },
    subscribeCrosshair(listener) {
      crosshairListeners.add(listener);
      return () => void crosshairListeners.delete(listener);
    },
    setTool(value) {
      cancelPan();
      cancelDrawing();
      drawings.setTool(value);
      root.style.cursor = 'crosshair';
      invalidate();
    },
    selectDrawing(id) {
      cancelPan();
      cancelDrawing();
      drawings.select(id);
      invalidate();
    },
    drawingState: () => drawings.inspect(),
    drawingTools: () => runtime.drawingRegistry.list(),
    setDrawingOptions(value) {
      drawings.configure(value);
      invalidate();
    },
    loadOlderHistory: () => runtime.loadOlderHistory(),
    capture() {
      if (renderError) throw new ChartError('RENDERER_UNAVAILABLE');
      // Copy synchronously after drawing, before the browser clears the default framebuffer.
      cancelAnimationFrame(frame);
      marketDirty = overlayDirty = true;
      draw();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const exportCtx = exportCanvas.getContext('2d')!;
      exportCtx.drawImage(canvas, 0, 0);
      exportCtx.drawImage(overlay, 0, 0);
      exportCtx.drawImage(cursorCanvas, 0, 0);
      return exportCanvas.toDataURL('image/png');
    },
    dispose() {
      if (disposed) return;
      cancelPan();
      cancelDrawing();
      disposed = true;
      cancelAnimationFrame(frame);
      abort.abort();
      resize.disconnect();
      unsubscribe();
      crosshairListeners.clear();
      runtime.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
