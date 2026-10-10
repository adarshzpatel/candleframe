import { ChartError, toChartError } from './errors.ts';
import { resolveTheme, themeColor, themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme, ThemeInput } from './themes.ts';
import { createGeometry, geometryForRanges } from './geometry.ts';
import type { ChartGeometry } from './geometry.ts';
import { ChartRuntime } from './runtime.ts';
import { PanMotion } from './pan-motion.ts';
import { ScaleMotion } from './scale-motion.ts';
import { DrawingController } from './drawing-controller.ts';
import { renderDrawings } from './drawing-scene.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingInteractionState,
  DrawingOptions,
  DrawingStyle,
  DrawingToolDefinition,
} from './drawing-types.ts';
import { dragPriceScale, dragTimeScale, panPriceScale, panTimeScale } from './scales.ts';
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
  /** Eased plot dragging and release momentum. Default true; honors reduced motion. */
  panMotion?: boolean;
  /** Ease zoom, axis resizing and autoscale changes. Default true; honors reduced motion. */
  scaleMotion?: boolean;
  /** Keep an auto price scale fitted to visible candles while dragging the plot. Default false. */
  autoscaleOnPan?: boolean;
  onStats?: (stats: RendererStats) => void;
  onHover?: (bar: Candle | null) => void;
  drawingTools?: readonly DrawingToolDefinition[];
  onToolChange?: (tool: string) => void;
  onDrawingChange?: (state: DrawingInteractionState) => void;
  /** Owned drawing copy. Text opens after placement; editable properties open on double-click or Enter. */
  onDrawingEdit?: (drawing: Drawing) => void;
  onError?: (error: ChartError) => void;
}
export interface ChartApi {
  setTheme(theme: ThemeInput): void;
  getTheme(): ResolvedChartTheme;
  replaceFeed(feed: FeedAdapter, expectedRevision?: number): void;
  execute(command: ChartCommand, expectedRevision?: number): void;
  inspect(): ReturnType<ChartRuntime['inspect']>;
  exportDocument(): ChartDocument;
  restoreDocument(document: unknown, expectedRevision?: number): void;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  setTool(tool: string): void;
  selectDrawing(id: string | null): void;
  drawingState(): DrawingInteractionState;
  drawingTools(): readonly DrawingToolDefinition[];
  setDrawingOptions(
    options: Partial<Omit<DrawingOptions, 'style'>> & { style?: Partial<DrawingStyle> },
  ): void;
  capture(): string;
  dispose(): void;
}

const formatTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** Mounts a chart-only view. All controls can be supplied by the host application. */
export function createChart(container: HTMLElement, options: ChartOptions): ChartApi {
  let theme = resolveTheme(options.theme);
  const runtime = new ChartRuntime(options.feed, options.indicators, {
    heatmap: options.heatmap,
    drawingTools: options.drawingTools,
  });
  const renderer = options.renderer ?? new WebGL2Renderer();
  const root = document.createElement('div');
  root.className = 'oc-chart';
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
  const formatDateTime = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  let geometry: ChartGeometry;
  let frame = 0;
  let drawing = false;
  let redrawRequested = false;
  let marketDirty = true,
    overlayDirty = true;
  let width = 1,
    height = 1;
  let disposed = false;
  let renderError: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let lastHover: Candle | null | undefined;
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
    execute: (command, revision) => runtime.execute(command, revision),
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
      const paintMarket = marketDirty || wasPanning || !!scaleMotion?.active || !geometry;
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
        geometry = geometryForRanges(scaleMotion.sample(now), width, height, theme.chart);
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
      if (paintMarket) {
        const stats = renderer.render({ state, geometry, heatmap: runtime.heatmap, theme });
        options.onStats?.(stats);
      }
      if (paintOverlay) drawOverlay();
      drawCursor();
      updateHover();
    } catch (error) {
      cancelPan();
      scaleMotion = null;
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      drawing = false;
      if (redrawRequested || pan?.motion.active || scaleMotion?.active) invalidate('cursor');
    }
  }

  function drawingContext(): DrawingContext {
    return {
      geometry,
      theme,
      intervalMs: state.feed.intervalMs,
      tickSize: state.feed.instrument.tickSize,
      formatPrice: value => formatPrice.format(value),
      measureText(text, font) {
        ctx!.save();
        ctx!.font = font;
        const measured = ctx!.measureText(text).width;
        ctx!.restore();
        return measured;
      },
    };
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
      const shift = (offset.x / current.width) * (current.to - current.from);
      runtime.execute({
        type: 'viewport.set',
        fromMs: current.from - shift,
        toMs: current.to - shift,
        ...(current.autoscale
          ? {}
          : {
              priceScale: {
                mode: 'manual' as const,
                ...panPriceScale(
                  current.min,
                  current.max,
                  offset.y,
                  current.height,
                  state.feed.instrument.tickSize,
                ),
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

  function publishHover(bar: Candle | null): void {
    if (bar !== lastHover) {
      lastHover = bar;
      options.onHover?.(bar);
    }
  }
  function updateHover(): void {
    if (
      options.onHover &&
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
    } else publishHover(null);
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

  function clearOverlay(target: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (target.width !== Math.round(width * dpr) || target.height !== Math.round(height * dpr)) {
      target.width = Math.round(width * dpr);
      target.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
  }
  function drawOverlay(): void {
    if (!ctx) return;
    clearOverlay(overlay, ctx);
    if (!state.candles.length) return;
    const g = geometry;
    ctx.font = `${theme.typography.axisSize}px ${theme.typography.numberFamily}`;
    ctx.fillStyle = themeColor(theme, theme.chart.axisColor);
    ctx.textAlign = 'left';
    for (let i = 0; i <= theme.chart.gridRows; i++) {
      const p = g.maxPrice - ((g.maxPrice - g.minPrice) / theme.chart.gridRows) * i;
      ctx.fillText(
        formatPrice.format(p),
        g.left + g.plotWidth + theme.chart.axisLabelPadding,
        g.top + (g.plotHeight / theme.chart.gridRows) * i + theme.typography.axisSize * 0.4,
      );
    }
    ctx.textAlign = 'center';
    const dateLabels = g.toMs - g.fromMs >= 86400000;
    const tickWidth =
      ctx.measureText((dateLabels ? formatDateTime : formatTime).format(g.fromMs)).width +
      theme.chart.axisLabelPadding * 2;
    const timeTicks = Math.max(1, Math.min(theme.chart.gridColumns, Math.floor(g.plotWidth / tickWidth)));
    const timeBaseline = height - theme.chart.timeAxisHeight / 2 + theme.typography.axisSize * 0.2;
    for (let i = 0; i <= timeTicks; i++) {
      const time = g.fromMs + ((g.toMs - g.fromMs) / timeTicks) * i;
      ctx.textAlign = i === 0 ? 'left' : i === timeTicks ? 'right' : 'center';
      ctx.fillText(
        (dateLabels ? formatDateTime : formatTime).format(time),
        g.left + (g.plotWidth / timeTicks) * i,
        timeBaseline,
      );
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.palette.textFaint;
    if (state.document.layers.volume && g.volumeHeight > 0)
      ctx.fillText(
        `VOLUME · ${state.feed.instrument.base}`,
        g.left + theme.chart.axisLabelPadding * 0.4,
        g.volumeTop + theme.typography.axisSize * 0.9,
      );
    ctx.fillText('UTC', g.left + g.plotWidth + theme.chart.axisLabelPadding, timeBaseline);
    ctx.strokeStyle = theme.palette.border;
    ctx.lineWidth = theme.effects.borderWidth;
    if (theme.effects.borderWidth > 0) {
      ctx.beginPath();
      ctx.moveTo(g.left, g.volumeTop - theme.chart.volumeGap / 2);
      ctx.lineTo(g.left + g.plotWidth, g.volumeTop - theme.chart.volumeGap / 2);
      ctx.stroke();
    }
    const latest = state.candles.at(-1);
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
        label(ctx, formatPrice.format(latest.close), g.left + g.plotWidth + theme.effects.borderWidth, y);
      }
    }
    renderDrawings(
      ctx,
      drawings.visible(),
      runtime.drawingRegistry,
      drawingContext(),
      drawings.selectionId(),
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

  function drawCursor(): void {
    if (!cursorCtx) return;
    const ctx = cursorCtx,
      g = geometry;
    clearOverlay(cursorCanvas, ctx);
    if (!state.candles.length) return;
    if (
      pointer &&
      pointer.x >= g.left &&
      pointer.x <= g.left + g.plotWidth &&
      pointer.y >= g.top &&
      pointer.y <= g.top + g.plotHeight
    ) {
      ctx.strokeStyle = themeColorCSS(theme, theme.chart.crosshairColor, theme.chart.crosshairOpacity);
      ctx.lineWidth = theme.chart.crosshairWidth;
      ctx.setLineDash([...theme.chart.crosshairDash]);
      if (theme.chart.crosshairWidth > 0) {
        ctx.beginPath();
        ctx.moveTo(pointer.x, g.top);
        ctx.lineTo(pointer.x, g.volumeTop + g.volumeHeight);
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
        formatPrice.format(anchor.price),
        g.left + g.plotWidth + theme.effects.borderWidth,
        pointer.y,
        text,
        background,
      );
      const time = formatTime.format(anchor.timeMs),
        w = labelWidth(ctx, time);
      label(
        ctx,
        time,
        Math.max(g.left, Math.min(g.left + g.plotWidth - w, pointer.x - w / 2)),
        height - theme.chart.timeAxisHeight / 2,
        text,
        background,
      );
    }
  }

  function point(event: MouseEvent): { x: number; y: number } {
    const r = root.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  function zoom(factor: number, anchorFraction = 0.5): void {
    const v = state.document.viewport;
    const oldSpan = v.toMs - v.fromMs;
    const span = Math.min(
      2200 * state.feed.intervalMs,
      Math.max(25 * state.feed.intervalMs, oldSpan * factor),
    );
    const anchor = v.fromMs + oldSpan * anchorFraction;
    runtime.execute({
      type: 'viewport.set',
      fromMs: anchor - span * anchorFraction,
      toMs: anchor + span * (1 - anchorFraction),
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
          ...dragPriceScale(
            targetGeometry.minPrice,
            targetGeometry.maxPrice,
            delta,
            geometry.plotHeight,
            state.feed.instrument.tickSize,
          ),
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
      const placing = drawings.currentTool !== 'cursor';
      if (drawings.down(p, drawingContext())) {
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
      if (!drag) root.style.cursor = drawings.cursor(pointer, drawingContext());
      if (!drag && drawings.move(pointer, drawingContext())) {
        invalidate('overlay');
        return;
      }
      if (drag?.kind === 'time') {
        runtime.execute({
          type: 'viewport.set',
          ...dragTimeScale(drag.from, drag.to, pointer.x - drag.x, drag.width, state.feed.intervalMs),
        });
      } else if (drag?.kind === 'price') {
        runtime.execute({
          type: 'priceScale.set',
          ...dragPriceScale(
            drag.min,
            drag.max,
            pointer.y - drag.y,
            drag.height,
            state.feed.instrument.tickSize,
          ),
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
            const history = {
              firstMs: state.candles[0].timeMs,
              lastMs: state.candles.at(-1)!.timeMs,
              intervalMs: state.feed.intervalMs,
            };
            const tickSize = state.feed.instrument.tickSize;
            const autoscale = autoscalesOnPan();
            const motion = new PanMotion(origin.started, {
              smooth: options.panMotion !== false && !reducedMotion.matches,
              constrain(offset) {
                const time = panTimeScale(origin.from, origin.to, offset.x, origin.width, history);
                const x = ((origin.from - time.fromMs) / (origin.to - origin.from)) * origin.width;
                if (autoscale) return { x, y: 0 };
                const price = panPriceScale(origin.min, origin.max, offset.y, origin.height, tickSize);
                return { x, y: ((price.minPrice - origin.min) / (origin.max - origin.min)) * origin.height };
              },
            });
            pan = { ...origin, motion, appliedX: 0, appliedY: 0, autoscale };
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
      if (drawingPointerId === event.pointerId) {
        const placing = drawings.currentTool !== 'cursor';
        drawingPointerId = null;
        drawings.up(point(event), drawingContext());
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
      cancelPan();
      cancelDrawing();
      invalidate();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'lostpointercapture',
    () => {
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
    if (!definition?.editableText && (placement || !definition?.editableProperties)) return false;
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
              ...dragTimeScale(v.fromMs, v.toMs, dx, geometry.plotWidth, state.feed.intervalMs),
            });
          } else {
            const dy = ['ArrowRight', 'ArrowUp'].includes(event.key) ? -25 : 25;
            const target = createGeometry(state, width, height, theme.chart);
            runtime.execute({
              type: 'priceScale.set',
              ...dragPriceScale(
                target.minPrice,
                target.maxPrice,
                dy,
                geometry.plotHeight,
                state.feed.instrument.tickSize,
              ),
            });
          }
          return;
        }
      }
      const v = state.document.viewport,
        step = (v.toMs - v.fromMs) * 0.1;
      if (
        ['ArrowLeft', 'ArrowRight', '+', '=', '-', 'Home', 'Escape'].includes(event.key) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')
      )
        event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const d = event.key === 'ArrowLeft' ? -step : step;
        runtime.execute({ type: 'viewport.set', fromMs: v.fromMs + d, toMs: v.toMs + d });
      } else if (event.key === '+' || event.key === '=') zoom(0.8);
      else if (event.key === '-') zoom(1.25);
      else if (event.key === 'Home') runtime.execute({ type: 'viewport.reset' });
      else if (event.key === 'Escape') {
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
      if (next.feed.instrument.pricePrecision !== state.feed.instrument.pricePrecision)
        formatPrice = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: next.feed.instrument.pricePrecision,
          maximumFractionDigits: next.feed.instrument.pricePrecision,
        });
      state = next;
      drawings.sync(next);
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
    replaceFeed: (feed, revision) => {
      cancelPan();
      cancelDrawing();
      runtime.replaceFeed(feed, revision);
    },
    execute: (command, revision) => {
      cancelPan();
      cancelDrawing();
      runtime.execute(command, revision);
    },
    inspect: () => runtime.inspect(),
    exportDocument: () => runtime.exportDocument(),
    restoreDocument: (value, revision) => {
      cancelPan();
      cancelDrawing();
      runtime.restoreDocument(value, revision);
    },
    subscribe: listener => runtime.subscribe(listener),
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
      runtime.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
