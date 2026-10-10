import { ChartError, toChartError } from './errors.ts';
import { resolveTheme, themeColor, themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme, ThemeInput } from './themes.ts';
import { createGeometry, geometryForRanges, geometryLayout, stateTimeScale } from './geometry.ts';
import type { TimeScale } from './time-scale.ts';
import type { IndicatorDefinition } from './indicators.ts';
import { createTimeFormats } from './time-format.ts';
import type { ChartGeometry } from './geometry.ts';
import { ChartRuntime } from './runtime.ts';
import type { CommandResult, DataQuery, DataResult, ExecuteOptions, PreviewResult } from './runtime.ts';
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
import { dragTimeScale, panTimeScale, priceAxisMath } from './scales.ts';
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
  /** Requests candles before the first loaded bar. The chart also does this when panning near it. */
  loadOlderHistory(): boolean;
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
      // Grid rows are evenly spaced in pixels; on a log axis the prices between them are not.
      const y = g.top + (g.plotHeight / theme.chart.gridRows) * i;
      ctx.fillText(
        formatPrice.format(g.price(y)),
        g.left + g.plotWidth + theme.chart.axisLabelPadding,
        y + theme.typography.axisSize * 0.4,
      );
    }
    drawPanes(g);
    ctx.textAlign = 'center';
    const spanMs = g.toMs - g.fromMs;
    const tickWidth =
      ctx.measureText(timeFormats.axis(g.fromMs, spanMs)).width + theme.chart.axisLabelPadding * 2;
    const timeTicks = Math.max(1, Math.min(theme.chart.gridColumns, Math.floor(g.plotWidth / tickWidth)));
    const timeBaseline = height - theme.chart.timeAxisHeight / 2 + theme.typography.axisSize * 0.2;
    for (let i = 0; i <= timeTicks; i++) {
      // Sample the scale at evenly spaced pixels; with session gaps, time is not linear in x.
      const x = g.left + (g.plotWidth / timeTicks) * i;
      ctx.textAlign = i === 0 ? 'left' : i === timeTicks ? 'right' : 'center';
      ctx.fillText(timeFormats.axis(g.anchor(x, g.top).timeMs, spanMs), x, timeBaseline);
    }
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
      (plugin.outputs?.length ? plugin.outputs : [{ name: '', color: plugin.color }]).forEach((output, k) => {
        const value = series[k]?.at(-1);
        if (value === undefined || !Number.isFinite(value)) return;
        const [r, gr, b] = output.color;
        ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(gr * 255)} ${Math.round(b * 255)})`;
        const text = formatValue(value, pane.max - pane.min);
        ctx.fillText(text, x, baseline);
        x += ctx.measureText(text).width + pad * 0.75;
      });
      ctx.fillStyle = themeColor(theme, theme.chart.axisColor);
      const marks = plugin.levels?.length ? plugin.levels : [pane.max, (pane.max + pane.min) / 2, pane.min];
      for (const value of marks) {
        const y = Math.max(
          pane.top + size * 0.5,
          Math.min(pane.top + pane.height - size * 0.2, pane.y(value)),
        );
        ctx.fillText(formatValue(value, pane.max - pane.min), g.left + g.plotWidth + pad, y + size * 0.4);
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
    }
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
          ...axis().drag(targetGeometry.minPrice, targetGeometry.maxPrice, delta, geometry.plotHeight),
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
      runtime.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
