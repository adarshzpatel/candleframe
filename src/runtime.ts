import { ChartError } from './errors.ts';
import { binBook, HeatmapStore } from './heatmap.ts';
import { OrderBook } from './order-book.ts';
import { DrawingRegistry, translateDrawing } from './drawing-tools.ts';
import type { DrawingToolDefinition } from './drawing-types.ts';
import { intervalToMs, isAligned } from './intervals.ts';
import { createTimeScale } from './time-scale.ts';
import { IndicatorRegistry } from './indicators.ts';
import type { IndicatorDefinition } from './indicators.ts';

interface IndicatorSlot {
  entry: DocumentIndicator;
  plugin?: IndicatorPlugin;
  series: number[][];
}
const sameInputs = (a: Readonly<Record<string, number>> = {}, b: Readonly<Record<string, number>> = {}) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
import type { TimeScale } from './time-scale.ts';
import type {
  Candle,
  ChartCommand,
  ChartDocument,
  FeedAdapter,
  FeedConnection,
  FeedDescriptor,
  FeedEvent,
  IndicatorPlugin,
  Instrument,
  ActiveIndicator,
  DocumentIndicator,
  OlderHistory,
  RuntimeState,
  Stream,
  StreamHealth,
} from './types.ts';

export interface RuntimeOptions {
  heatmap?: boolean;
  drawingTools?: readonly DrawingToolDefinition[];
  /** Candles kept in memory, including paged history. 100 to 100,000; default 10,000. */
  maxCandles?: number;
  /** Extra indicator kinds that documents, commands and the widget can add. */
  indicatorDefinitions?: readonly IndicatorDefinition[];
}
function validCandle(bar: Candle, intervalMs: number, gaps = false): boolean {
  return (
    [bar.timeMs, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) &&
    bar.timeMs >= 0 &&
    (gaps || isAligned(bar.timeMs, intervalMs)) &&
    bar.low > 0 &&
    bar.volume >= 0 &&
    bar.high >= Math.max(bar.open, bar.close) &&
    bar.low <= Math.min(bar.open, bar.close)
  );
}
function validateInstrument(i: Instrument): void {
  if (
    !i ||
    ![i.symbol, i.name, i.base, i.quote].every(
      s => typeof s === 'string' && s.length > 0 && s.length < 128,
    ) ||
    !Number.isFinite(i.tickSize) ||
    i.tickSize <= 0 ||
    ![i.pricePrecision, i.quantityPrecision].every(n => Number.isInteger(n) && n >= 0 && n <= 12)
  )
    throw new ChartError('INVALID_INSTRUMENT');
}
function validateDescriptor(d: FeedDescriptor): FeedDescriptor {
  if (d && d.intervalMs !== intervalToMs(d.interval))
    throw new ChartError('INVALID_FEED', 'intervalMs does not match interval', {
      path: 'intervalMs',
      details: { interval: d.interval, intervalMs: d.intervalMs },
    });
  if (
    !d ||
    typeof d.id !== 'string' ||
    !d.id ||
    typeof d.label !== 'string' ||
    typeof d.simulated !== 'boolean' ||
    (d.gaps !== undefined && typeof d.gaps !== 'boolean') ||
    !d.depth ||
    !(
      (d.depth.kind === 'none' && d.depth.levels === 0) ||
      (['sequenced', 'snapshots'].includes(d.depth.kind) &&
        Number.isInteger(d.depth.levels) &&
        d.depth.levels >= 1 &&
        d.depth.levels <= 2048)
    )
  )
    throw new ChartError('INVALID_FEED');
  validateInstrument(d.instrument);
  return structuredClone(d);
}
export const MIN_VIEWPORT_BARS = 20;
export const MAX_VIEWPORT_BARS = 2200;
function validateViewport(value: unknown, scale: Pick<TimeScale, 'bars'>): ChartDocument['viewport'] {
  const v = value as ChartDocument['viewport'] | undefined;
  const bars = v && Number.isFinite(v.fromMs) && Number.isFinite(v.toMs) ? scale.bars(v.fromMs, v.toMs) : NaN;
  if (
    !v ||
    !(bars >= MIN_VIEWPORT_BARS - 1e-6 && bars <= MAX_VIEWPORT_BARS + 1e-6) ||
    typeof v.following !== 'boolean'
  )
    throw new ChartError('INVALID_VIEWPORT', 'span must be 20 to 2200 bars', {
      path: 'viewport',
      details: { bars, minBars: MIN_VIEWPORT_BARS, maxBars: MAX_VIEWPORT_BARS },
    });
  return { fromMs: v.fromMs, toMs: v.toMs, following: v.following };
}
function validatePriceScale(value: unknown, tickSize: number): ChartDocument['priceScale'] {
  if (value === undefined) return { mode: 'auto' };
  const scale = value as ChartDocument['priceScale'];
  if (scale && scale.log !== undefined && typeof scale.log !== 'boolean')
    throw new ChartError('INVALID_PRICE_SCALE', 'log must be a boolean', { path: 'priceScale.log' });
  const log = scale?.log ? { log: true } : {};
  if (scale?.mode === 'auto') return { mode: 'auto', ...log };
  if (
    !scale ||
    scale.mode !== 'manual' ||
    !Number.isFinite(scale.minPrice) ||
    !Number.isFinite(scale.maxPrice) ||
    scale.minPrice <= 0 ||
    scale.maxPrice - scale.minPrice < tickSize
  )
    throw new ChartError('INVALID_PRICE_SCALE', 'minPrice must be positive and below maxPrice by a tick', {
      path: 'priceScale',
      details: { tickSize },
    });
  return { mode: 'manual', minPrice: scale.minPrice, maxPrice: scale.maxPrice, ...log };
}
export const MAX_INDICATORS = 16;
function validateIndicators(value: unknown, registry: IndicatorRegistry): DocumentIndicator[] {
  if (!Array.isArray(value) || value.length > MAX_INDICATORS)
    throw new ChartError('INVALID_INDICATORS', `at most ${MAX_INDICATORS} indicators`, {
      path: 'indicators',
    });
  const ids = new Set<string>();
  return value.map((entry: Partial<DocumentIndicator> | null, index) => {
    const path = `indicators.${index}`;
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !/^[\w.:-]{1,64}$/.test(entry.id) ||
      typeof entry.kind !== 'string' ||
      !entry.kind ||
      entry.kind.length > 64 ||
      typeof entry.visible !== 'boolean'
    )
      throw new ChartError('INVALID_INDICATORS', 'each indicator needs an id, kind and visible flag', {
        path,
      });
    if (ids.has(entry.id))
      throw new ChartError('DUPLICATE_INDICATOR_ID', undefined, {
        path: `${path}.id`,
        details: { id: entry.id },
      });
    ids.add(entry.id);
    // Unknown kinds are kept, like unknown drawing types, and reported as unsupported.
    let inputs: Record<string, number>;
    if (registry.get(entry.kind)) inputs = registry.inputs(entry.kind, entry.inputs ?? {});
    else {
      const raw = entry.inputs ?? {};
      if (
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        Object.keys(raw).length > 16 ||
        !Object.values(raw).every(v => typeof v === 'number' && Number.isFinite(v))
      )
        throw new ChartError('INVALID_INDICATOR_INPUT', undefined, { path: `${path}.inputs` });
      inputs = { ...raw };
    }
    return { id: entry.id, kind: entry.kind, inputs, visible: entry.visible };
  });
}
export interface ParseIndicatorOptions {
  registry?: IndicatorRegistry;
  /** Used for version 2 and 3 layouts, which predate saved indicators. */
  defaults?: readonly DocumentIndicator[];
}
export function parseDocument(
  value: unknown,
  feed: FeedDescriptor,
  heatmapEnabled = false,
  registry = new DrawingRegistry(),
  /** Measures the viewport in bars. Defaults to a continuous scale. */
  timeScale: Pick<TimeScale, 'bars'> = createTimeScale([], feed.intervalMs),
  indicatorOptions: ParseIndicatorOptions = {},
): ChartDocument {
  if (!value || typeof value !== 'object') throw new ChartError('INVALID_DOCUMENT');
  // v1 had no provider or interval. Only the original simulated one-minute market is unambiguous.
  const input = value as Record<string, unknown>;
  let normalized = value;
  if (input.version === 1) {
    if (!feed.simulated || feed.interval !== '1m' || feed.instrument.symbol !== 'BTC/USD')
      throw new ChartError('LEGACY_MARKET_MISMATCH');
    normalized = { ...input, version: 2, feedId: feed.id, interval: '1m' };
  }
  const doc = normalized as Partial<Omit<ChartDocument, 'version' | 'drawings'>> & {
    version?: number;
    drawings?: unknown[];
  };
  if (doc.version !== 2 && doc.version !== 3 && doc.version !== 4)
    throw new ChartError('UNSUPPORTED_DOCUMENT_VERSION', undefined, {
      path: 'version',
      details: { version: doc.version, supported: [1, 2, 3, 4] },
    });
  if (doc.symbol !== feed.instrument.symbol)
    throw new ChartError('SYMBOL_MISMATCH', undefined, {
      path: 'symbol',
      details: { expected: feed.instrument.symbol, actual: doc.symbol },
    });
  if (doc.feedId !== feed.id || doc.interval !== feed.interval)
    throw new ChartError('MARKET_MISMATCH', undefined, {
      details: {
        expected: { feedId: feed.id, interval: feed.interval },
        actual: { feedId: doc.feedId, interval: doc.interval },
      },
    });
  if (
    !doc.layers ||
    !['heatmap', 'candles', 'volume', 'indicator'].every(
      k => typeof doc.layers?.[k as keyof ChartDocument['layers']] === 'boolean',
    )
  )
    throw new ChartError('INVALID_LAYERS');
  if (
    typeof doc.intensity !== 'number' ||
    !Number.isFinite(doc.intensity) ||
    doc.intensity < 0.2 ||
    doc.intensity > 2
  )
    throw new ChartError('INVALID_INTENSITY');
  const v = validateViewport(doc.viewport, timeScale);
  const priceScale = validatePriceScale(doc.priceScale, feed.instrument.tickSize);
  const indicatorRegistry = indicatorOptions.registry ?? new IndicatorRegistry();
  const indicators = validateIndicators(
    doc.version === 4 ? doc.indicators : structuredClone(indicatorOptions.defaults ?? []),
    indicatorRegistry,
  );
  if (!Array.isArray(doc.drawings) || doc.drawings.length > 100) throw new ChartError('INVALID_DRAWINGS');
  const drawings = doc.drawings.map(drawing => registry.normalize(drawing));
  if (new Set(drawings.map(d => d.id)).size !== drawings.length) throw new ChartError('DUPLICATE_DRAWING_ID');
  if (
    drawings.reduce((count, drawing) => count + drawing.points.length, 0) > 8192 ||
    new TextEncoder().encode(JSON.stringify(drawings)).byteLength > 256 * 1024
  )
    throw new ChartError('DRAWING_LIMIT_EXCEEDED');
  return structuredClone({
    version: 4,
    feedId: feed.id,
    symbol: feed.instrument.symbol,
    interval: feed.interval,
    layers: { ...doc.layers, heatmap: heatmapEnabled && doc.layers.heatmap },
    intensity: doc.intensity,
    viewport: v,
    priceScale,
    indicators,
    drawings,
  });
}
const loading = (): StreamHealth => ({ status: 'loading', message: null, receivedAtMs: null });

/** Owns one active market generation. Old connections cannot write into a replacement market. */
export class ChartRuntime {
  private candles: Candle[] = [];
  private book = new OrderBook();
  private adapter: FeedAdapter;
  private descriptor: FeedDescriptor;
  private connection?: FeedConnection;
  private listeners = new Set<(state: RuntimeState) => void>();
  private indicators: IndicatorSlot[] = [];
  /** Host-supplied plugin objects, used as-is while their id, kind and inputs match the document. */
  private seeds = new Map<string, IndicatorPlugin>();
  private defaultIndicators: DocumentIndicator[];
  readonly indicatorRegistry: IndicatorRegistry;
  private history: ChartDocument[] = [];
  private future: ChartDocument[] = [];
  private document: ChartDocument;
  private paused = false;
  private dataRevision = 0;
  private documentRevision = 0;
  private disposed = false;
  private started = false;
  private generation = 0;
  private snapshotNeeded = false;
  private initializedViewport = false;
  private streams: Record<Stream, StreamHealth> = { candles: loading(), depth: loading() };
  private olderHistory: OlderHistory = { status: 'unavailable', message: null };
  readonly maxCandles: number;
  private scaleCache?: { candles: readonly Candle[]; descriptor: FeedDescriptor; scale: TimeScale };
  readonly heatmapEnabled: boolean;
  readonly drawingRegistry: DrawingRegistry;
  heatmap?: HeatmapStore;

  constructor(feed: FeedAdapter, plugins: readonly IndicatorPlugin[] = [], options: RuntimeOptions = {}) {
    this.adapter = feed;
    this.descriptor = validateDescriptor(feed.descriptor);
    this.heatmapEnabled = options.heatmap ?? false;
    this.maxCandles = options.maxCandles ?? 10_000;
    if (!Number.isInteger(this.maxCandles) || this.maxCandles < 100 || this.maxCandles > 100_000)
      throw new ChartError('INVALID_OPTION', 'maxCandles must be an integer from 100 to 100000', {
        path: 'maxCandles',
        details: { maxCandles: options.maxCandles },
      });
    this.drawingRegistry = new DrawingRegistry(options.drawingTools);
    if (new Set(plugins.map(p => p.id)).size !== plugins.length) throw new ChartError('DUPLICATE_PLUGIN');
    for (const plugin of plugins) {
      if (
        !plugin ||
        typeof plugin.id !== 'string' ||
        !(
          typeof plugin.calculate === 'function' ||
          (plugin.outputs?.length && typeof plugin.calculateOutputs === 'function')
        )
      )
        throw new ChartError(
          'INVALID_INDICATOR',
          'plugins need calculate, or outputs with calculateOutputs',
          {
            details: { id: plugin?.id },
          },
        );
      this.seeds.set(plugin.id, plugin);
    }
    this.indicatorRegistry = new IndicatorRegistry(options.indicatorDefinitions);
    this.defaultIndicators = plugins.map(plugin => ({
      id: plugin.id,
      kind: plugin.kind ?? 'custom',
      inputs: { ...plugin.inputs },
      visible: true,
    }));
    this.document = this.newDocument();
    this.syncIndicators();
    this.setStatus('depth', 'loading');
  }
  private newDocument(): ChartDocument {
    const d = this.descriptor;
    return {
      version: 4,
      feedId: d.id,
      symbol: d.instrument.symbol,
      interval: d.interval,
      layers: { heatmap: this.heatmapEnabled, candles: true, volume: true, indicator: true },
      intensity: 1,
      viewport: { fromMs: 0, toMs: 180 * d.intervalMs, following: true },
      priceScale: { mode: 'auto' },
      indicators: structuredClone(this.defaultIndicators),
      drawings: [],
    };
  }
  private parse(value: unknown): ChartDocument {
    return parseDocument(
      value,
      this.descriptor,
      this.heatmapEnabled,
      this.drawingRegistry,
      this.timeScale(),
      {
        registry: this.indicatorRegistry,
        defaults: this.defaultIndicators,
      },
    );
  }
  private resolveIndicator(entry: DocumentIndicator): IndicatorPlugin | undefined {
    const seed = this.seeds.get(entry.id);
    if (seed && (seed.kind ?? 'custom') === entry.kind && sameInputs(seed.inputs, entry.inputs)) return seed;
    if (this.indicatorRegistry.get(entry.kind))
      return this.indicatorRegistry.create(entry.kind, entry.inputs, entry.id);
    return undefined;
  }
  /** Matches indicator instances to the document, reusing unchanged ones and computing new ones. */
  private syncIndicators(): void {
    this.indicators = this.slotsFor(this.document);
  }
  /** Computes before anything is assigned, so a failing plugin cannot leave a half-applied edit. */
  private slotsFor(document: ChartDocument): IndicatorSlot[] {
    const previous = new Map(this.indicators.map(slot => [slot.entry.id, slot]));
    return document.indicators.map(entry => {
      const old = previous.get(entry.id);
      if (old && old.entry.kind === entry.kind && sameInputs(old.entry.inputs, entry.inputs))
        return { ...old, entry };
      const plugin = this.resolveIndicator(entry);
      const slot: IndicatorSlot = { entry, plugin, series: [] };
      if (plugin && this.candles.length) slot.series = this.compute(plugin, this.candles, [], 0);
      return slot;
    });
  }
  /** Replaces the document and its indicator instances together. */
  private commit(document: ChartDocument, remember: boolean): void {
    const slots = this.slotsFor(document);
    if (remember) this.remember();
    this.document = document;
    this.indicators = slots;
    this.documentRevision++;
    this.publish();
  }
  private compute(
    plugin: IndicatorPlugin,
    candles: readonly Candle[],
    previous: readonly (readonly number[])[],
    changed: number,
  ): number[][] {
    const series = plugin.outputs?.length
      ? plugin.calculateOutputs!(candles, previous, changed)
      : [plugin.calculate!(candles, previous[0] ?? [], changed)];
    if (
      !Array.isArray(series) ||
      series.length !== (plugin.outputs?.length || 1) ||
      series.some(
        values =>
          !Array.isArray(values) ||
          values.length !== candles.length ||
          values.some(v => typeof v !== 'number' || v === Infinity || v === -Infinity),
      )
    )
      throw new ChartError('INVALID_INDICATOR', `${plugin.id}`, { details: { id: plugin.id } });
    return series;
  }
  /** Time-to-bar mapping for the loaded candles. Shared by validation and the view. */
  timeScale(): TimeScale {
    const cache = this.scaleCache;
    if (cache && cache.candles === this.candles && cache.descriptor === this.descriptor) return cache.scale;
    const { intervalMs, gaps } = this.descriptor;
    let scale = createTimeScale(this.candles, intervalMs, gaps);
    // Before gapped history loads, a saved span cannot be measured in bars. Accept it.
    if (gaps && this.candles.length < 2)
      scale = { ...scale, bars: (from, to) => Math.min(MAX_VIEWPORT_BARS, (to - from) / intervalMs) };
    this.scaleCache = { candles: this.candles, descriptor: this.descriptor, scale };
    return scale;
  }
  /** The default live view: 180 bars ending 12 bars after the latest candle. */
  private liveViewport(span = 180): ChartDocument['viewport'] {
    const scale = this.timeScale();
    const end = scale.logical(this.candles.at(-1)?.timeMs ?? 0) + 12;
    return { fromMs: scale.time(end - span), toMs: scale.time(end), following: true };
  }
  start(): void {
    if (this.disposed) throw new ChartError('DISPOSED');
    if (this.started) return;
    this.started = true;
    if (!this.paused) this.connect();
  }
  private connect(): void {
    const generation = this.generation;
    try {
      const connection = this.adapter.connect(event => {
        if (!this.disposed && !this.paused && generation === this.generation) this.receive(event);
      });
      if (this.disposed || generation !== this.generation) {
        connection.dispose();
        return;
      }
      this.connection = connection;
      if (this.olderHistory.status === 'unavailable' && connection.loadOlder)
        this.olderHistory = { status: 'idle', message: null };
      if (this.snapshotNeeded) {
        this.snapshotNeeded = false;
        connection.requestSnapshot();
      }
      if (this.paused) connection.setPaused(true);
    } catch (error) {
      for (const stream of ['candles', 'depth'] as const) this.setStatus(stream, 'error', String(error));
      this.publish();
    }
  }
  replaceFeed(feed: FeedAdapter, expectedRevision?: number): void {
    this.assertRevision(expectedRevision);
    const descriptor = validateDescriptor(feed.descriptor);
    if (feed === this.adapter) return;
    const sameInstrument =
      descriptor.id === this.descriptor.id &&
      descriptor.instrument.symbol === this.descriptor.instrument.symbol;
    const previous = this.document;
    this.generation++;
    this.connection?.dispose();
    this.connection = undefined;
    this.adapter = feed;
    this.descriptor = descriptor;
    this.candles = [];
    this.book = new OrderBook();
    this.heatmap = undefined;
    this.history = [];
    this.future = [];
    this.indicators.forEach(slot => {
      slot.series = [];
    });
    this.streams = { candles: loading(), depth: loading() };
    this.setStatus('depth', 'loading');
    if (this.paused) for (const stream of ['candles', 'depth'] as const) this.setStatus(stream, 'paused');
    this.snapshotNeeded = false;
    this.initializedViewport = false;
    this.olderHistory = { status: 'unavailable', message: null };
    this.document = {
      ...this.newDocument(),
      layers: { ...previous.layers },
      intensity: previous.intensity,
      // Log scale is a preference like the layers; the range itself refits.
      priceScale: previous.priceScale.log ? { mode: 'auto', log: true } : { mode: 'auto' },
      indicators: structuredClone(previous.indicators),
      drawings: sameInstrument ? structuredClone(previous.drawings) : [],
    };
    this.syncIndicators();
    this.documentRevision++;
    this.dataRevision++;
    this.publish();
    if (this.started && !this.paused) this.connect();
  }
  private setStatus(stream: Stream, status: StreamHealth['status'], message: string | null = null): void {
    if (stream === 'depth' && this.descriptor.depth.kind === 'none') {
      status = 'unavailable';
      message = null;
    }
    this.streams = {
      ...this.streams,
      [stream]: {
        status,
        message,
        receivedAtMs: status === 'live' ? Date.now() : this.streams[stream].receivedAtMs,
      },
    };
    if (stream === 'depth' && status !== 'live') this.book.markStale();
  }
  private requestSnapshot(): void {
    if (this.connection) this.connection.requestSnapshot();
    else this.snapshotNeeded = true;
  }
  private calculate(candles: Candle[], changed: number): void {
    // Compute everything before assigning, so one failing plugin leaves all series unchanged.
    const results = this.indicators.map(slot =>
      slot.plugin ? this.compute(slot.plugin, candles, slot.series, changed) : [],
    );
    this.indicators.forEach((slot, index) => {
      slot.series = results[index];
    });
  }
  private recordDepth(): void {
    const time = this.candles.at(-1)?.timeMs;
    if (this.heatmap && time !== undefined)
      this.heatmap.append(binBook(this.book.inspect(2048), this.heatmap.grid, time));
  }
  private receive(event: FeedEvent): void {
    let stream: Stream =
      event.type.startsWith('depth.') || event.type === 'heatmap.history' ? 'depth' : 'candles';
    if (stream === 'depth' && this.descriptor.depth.kind === 'none') return;
    try {
      switch (event.type) {
        case 'stream.status':
          stream = event.stream;
          this.setStatus(stream, event.status, event.message ?? null);
          this.publish();
          return;
        case 'instrument':
          validateInstrument(event.instrument);
          if (
            event.instrument.symbol !== this.descriptor.instrument.symbol ||
            event.instrument.base !== this.descriptor.instrument.base ||
            event.instrument.quote !== this.descriptor.instrument.quote
          )
            throw new ChartError('INSTRUMENT_MISMATCH');
          this.descriptor = { ...this.descriptor, instrument: { ...event.instrument } };
          this.dataRevision++;
          this.publish();
          return;
        case 'candles.history': {
          if (!event.candles.length || event.candles.length > 100_000 || !this.validSeries(event.candles))
            throw new ChartError('INVALID_HISTORY');
          const candles = event.candles.slice(-this.maxCandles).map(b => ({ ...b }));
          if (this.connection?.loadOlder) this.olderHistory = { status: 'idle', message: null };
          this.calculate(candles, 0);
          this.candles = candles;
          if (!this.initializedViewport || this.document.viewport.following)
            this.resetViewport(!this.initializedViewport);
          this.initializedViewport = true;
          this.setStatus('candles', 'live');
          break;
        }
        case 'candle': {
          if (!validCandle(event.candle, this.descriptor.intervalMs, this.descriptor.gaps))
            throw new ChartError('INVALID_CANDLE');
          const last = this.candles.at(-1);
          if (!last) throw new ChartError('MISSING_HISTORY');
          const candles = this.candles.slice();
          let changed = candles.findIndex(b => b.timeMs === event.candle.timeMs);
          if (changed >= 0) candles[changed] = { ...event.candle };
          else {
            if (event.candle.timeMs < last.timeMs) throw new ChartError('UNKNOWN_CORRECTION');
            if (!this.descriptor.gaps && event.candle.timeMs !== last.timeMs + this.descriptor.intervalMs)
              throw new ChartError('CANDLE_GAP', 'reconnect to refresh history');
            changed = candles.length;
            candles.push({ ...event.candle });
            if (candles.length > this.maxCandles) {
              candles.shift();
              changed = 0;
            }
          }
          this.calculate(candles, changed);
          const before = this.timeScale(),
            viewport = this.document.viewport;
          this.candles = candles;
          if (event.candle.timeMs > last.timeMs && viewport.following) {
            // Keep the span and the right margin in bars; with gaps, a new bar can be days later.
            const span = before.bars(viewport.fromMs, viewport.toMs);
            const margin = before.logical(viewport.toMs) - before.logical(last.timeMs);
            const after = this.timeScale();
            const end = after.logical(event.candle.timeMs) + margin;
            this.document.viewport = {
              fromMs: after.time(end - span),
              toMs: after.time(end),
              following: true,
            };
          }
          this.setStatus('candles', 'live');
          break;
        }
        case 'candles.prepend':
          this.prepend(event);
          break;
        case 'depth.snapshot':
          if (this.book.snapshot(event.book)) this.setStatus('depth', 'live');
          this.recordDepth();
          break;
        case 'depth.delta': {
          const result = this.book.delta(event.book);
          if (result === 'gap') {
            this.setStatus('depth', 'stale', 'Depth sequence gap. Requesting a snapshot.');
            this.requestSnapshot();
          } else if (result === 'applied') this.setStatus('depth', 'live');
          this.recordDepth();
          break;
        }
        case 'heatmap.history': {
          if (!this.heatmapEnabled) return;
          const store = new HeatmapStore(event.grid);
          for (const c of event.columns) store.append({ ...c, values: c.values.slice() });
          this.heatmap = store;
          break;
        }
      }
      this.dataRevision++;
    } catch (error) {
      this.setStatus(stream, 'error', error instanceof Error ? error.message : String(error));
      if (stream === 'depth') this.requestSnapshot();
    }
    this.publish();
  }
  private validSeries(candles: readonly Candle[]): boolean {
    const { intervalMs, gaps } = this.descriptor;
    return candles.every(
      (bar, i) => validCandle(bar, intervalMs, gaps) && (i === 0 || bar.timeMs > candles[i - 1].timeMs),
    );
  }
  private prepend(event: Extract<FeedEvent, { type: 'candles.prepend' }>): void {
    if (this.olderHistory.status !== 'loading') return;
    if (event.error) {
      this.olderHistory = { status: 'error', message: event.error };
      return;
    }
    const first = this.candles[0];
    if (
      !Array.isArray(event.candles) ||
      event.candles.length > 100_000 ||
      !this.validSeries(event.candles) ||
      (first && event.candles.length && event.candles.at(-1)!.timeMs >= first.timeMs)
    ) {
      this.olderHistory = {
        status: 'error',
        message: 'INVALID_HISTORY: older candles overlap or are invalid',
      };
      return;
    }
    const room = this.maxCandles - this.candles.length;
    const older = event.candles.slice(Math.max(0, event.candles.length - room)).map(b => ({ ...b }));
    const limited = older.length < event.candles.length;
    if (older.length) {
      const candles = [...older, ...this.candles];
      // Paged bars shift every index, so indicators recalculate from the start.
      this.calculate(candles, 0);
      this.candles = candles;
    }
    this.olderHistory =
      event.exhausted || limited || this.candles.length >= this.maxCandles
        ? {
            status: 'exhausted',
            message: limited || this.candles.length >= this.maxCandles ? 'Reached maxCandles' : null,
          }
        : { status: 'idle', message: null };
  }
  /**
   * Asks the feed for candles before the first loaded one. Returns false when the
   * feed cannot page, a request is pending, history is exhausted or the limit is reached.
   */
  loadOlderHistory(): boolean {
    if (this.disposed) throw new ChartError('DISPOSED');
    const first = this.candles[0];
    if (
      !first ||
      this.paused ||
      !this.connection?.loadOlder ||
      !['idle', 'error'].includes(this.olderHistory.status) ||
      this.candles.length >= this.maxCandles
    )
      return false;
    this.olderHistory = { status: 'loading', message: null };
    this.publish();
    this.connection.loadOlder(first.timeMs);
    return true;
  }
  private resetViewport(resetSpan = true): void {
    const { fromMs, toMs } = this.document.viewport;
    this.document.viewport = this.liveViewport(resetSpan ? 180 : this.timeScale().bars(fromMs, toMs));
  }
  private assertRevision(expected?: number): void {
    if (this.disposed) throw new ChartError('DISPOSED');
    if (expected !== undefined && expected !== this.documentRevision)
      throw new ChartError('REVISION_CONFLICT', 'the document changed; inspect() again and retry', {
        details: { expected, actual: this.documentRevision },
      });
  }
  execute(command: ChartCommand, expectedRevision?: number): void {
    this.assertRevision(expectedRevision);
    if (command.type === 'feed.pause') {
      if (typeof command.paused !== 'boolean') throw new ChartError('INVALID_COMMAND');
      if (this.paused === command.paused) return;
      this.paused = command.paused;
      // Paused connections drop replies, so a pending page request would never finish.
      if (this.paused && this.olderHistory.status === 'loading')
        this.olderHistory = { status: 'idle', message: null };
      for (const stream of ['candles', 'depth'] as const)
        this.setStatus(stream, this.paused ? 'paused' : 'loading');
      this.publish();
      if (this.connection) this.connection.setPaused(this.paused);
      else if (!this.paused && this.started) this.connect();
      return;
    }
    if (command.type === 'history.undo' || command.type === 'history.redo') {
      const source = command.type === 'history.undo' ? this.history : this.future;
      const destination = command.type === 'history.undo' ? this.future : this.history;
      const previous = source.pop();
      if (previous) {
        const document = {
          ...previous,
          viewport: { ...this.document.viewport },
          priceScale: { ...this.document.priceScale },
        };
        const slots = this.slotsFor(document);
        this.pushHistory(destination);
        this.document = document;
        this.indicators = slots;
        this.documentRevision++;
        this.publish();
      }
      return;
    }
    if (
      command.type === 'viewport.set' ||
      command.type === 'viewport.reset' ||
      command.type === 'priceScale.set' ||
      command.type === 'priceScale.reset' ||
      command.type === 'priceScale.log'
    ) {
      // Navigation runs during animation. Existing content is already validated;
      // retain its identity and do no drawing clones, plugin work or payload scans.
      const next = { ...this.document };
      // Navigation keeps the log setting unless a command sets it.
      const log = this.document.priceScale.log ? { log: true } : {};
      switch (command.type) {
        case 'viewport.set':
          next.viewport = validateViewport(
            { fromMs: command.fromMs, toMs: command.toMs, following: false },
            this.timeScale(),
          );
          if (command.priceScale !== undefined)
            next.priceScale = validatePriceScale(
              { ...log, ...command.priceScale },
              this.descriptor.instrument.tickSize,
            );
          break;
        case 'viewport.reset':
          next.viewport = this.liveViewport();
          break;
        case 'priceScale.set':
          next.priceScale = validatePriceScale(
            { mode: 'manual', minPrice: command.minPrice, maxPrice: command.maxPrice, ...log },
            this.descriptor.instrument.tickSize,
          );
          break;
        case 'priceScale.reset':
          next.priceScale = { mode: 'auto', ...log };
          break;
        case 'priceScale.log': {
          if (typeof command.enabled !== 'boolean')
            throw new ChartError('INVALID_COMMAND', 'enabled must be a boolean', { path: 'enabled' });
          // Switching scale type refits the range; a manual linear range is rarely right on a log axis.
          next.priceScale = command.enabled ? { mode: 'auto', log: true } : { mode: 'auto' };
          break;
        }
      }
      this.document = next;
      this.documentRevision++;
      this.publish();
      return;
    }
    const next = this.exportDocument();
    switch (command.type) {
      case 'layer.set':
        if (!Object.hasOwn(next.layers, command.layer) || typeof command.visible !== 'boolean')
          throw new ChartError('INVALID_LAYER', undefined, {
            path: 'layer',
            details: { layer: command.layer, allowed: Object.keys(next.layers) },
          });
        if (command.layer === 'heatmap' && command.visible && !this.heatmapEnabled)
          throw new ChartError('HEATMAP_DISABLED');
        next.layers[command.layer] = command.visible;
        break;
      case 'heatmap.intensity':
        next.intensity = command.value;
        break;
      case 'drawing.add':
        next.drawings.push(this.drawingRegistry.normalize(command.drawing));
        break;
      case 'drawing.update': {
        const index = this.drawingIndex(next, command.id);
        const drawing = next.drawings[index],
          patch = command.patch;
        if (
          !patch ||
          typeof patch !== 'object' ||
          Array.isArray(patch) ||
          Object.keys(patch).some(
            key => !['points', 'style', 'locked', 'visible', 'text', 'levels'].includes(key),
          )
        )
          throw new ChartError('INVALID_DRAWING_PATCH');
        if (drawing.locked && patch.points !== undefined) throw new ChartError('DRAWING_LOCKED');
        if (
          patch.style !== undefined &&
          (!patch.style || typeof patch.style !== 'object' || Array.isArray(patch.style))
        )
          throw new ChartError('INVALID_DRAWING_STYLE');
        next.drawings[index] = this.drawingRegistry.normalize({
          ...drawing,
          ...patch,
          style: { ...drawing.style, ...patch.style },
        });
        break;
      }
      case 'drawing.remove':
        next.drawings.splice(this.drawingIndex(next, command.id), 1);
        break;
      case 'drawing.duplicate': {
        const drawing = next.drawings[this.drawingIndex(next, command.id)];
        const offset = command.offset ?? { timeMs: this.descriptor.intervalMs * 3, price: 0 };
        if (!offset || !Number.isFinite(offset.timeMs) || !Number.isFinite(offset.price))
          throw new ChartError('INVALID_DRAWING_OFFSET');
        const copied = translateDrawing(
          drawing,
          offset.timeMs,
          offset.price,
          this.descriptor.instrument.tickSize,
        );
        next.drawings.push(
          this.drawingRegistry.normalize({ ...copied, id: command.newId, locked: false, visible: true }),
        );
        break;
      }
      case 'drawing.order': {
        if (command.where !== 'front' && command.where !== 'back')
          throw new ChartError('INVALID_DRAWING_ORDER');
        const [drawing] = next.drawings.splice(this.drawingIndex(next, command.id), 1);
        if (command.where === 'front') next.drawings.push(drawing);
        else next.drawings.unshift(drawing);
        break;
      }
      case 'drawing.lockAll':
        if (typeof command.locked !== 'boolean') throw new ChartError('INVALID_DRAWING_PATCH');
        next.drawings = next.drawings.map(drawing => ({ ...drawing, locked: command.locked }));
        break;
      case 'drawing.clear':
        next.drawings = [];
        break;
      case 'indicator.add': {
        const given = command.indicator;
        if (!given || typeof given !== 'object' || typeof given.kind !== 'string')
          throw new ChartError('INVALID_COMMAND', 'indicator needs a kind', { path: 'indicator.kind' });
        if (!this.indicatorRegistry.get(given.kind))
          throw new ChartError('UNKNOWN_INDICATOR', undefined, {
            path: 'indicator.kind',
            details: { kind: given.kind, available: this.indicatorRegistry.list().map(d => d.kind) },
          });
        if (next.indicators.length >= MAX_INDICATORS)
          throw new ChartError('INDICATOR_LIMIT_EXCEEDED', undefined, { details: { max: MAX_INDICATORS } });
        let id = given.id;
        for (let n = 1; id === undefined; n++) {
          const candidate = n === 1 ? given.kind : `${given.kind}-${n}`;
          if (!next.indicators.some(entry => entry.id === candidate)) id = candidate;
        }
        next.indicators.push({
          id,
          kind: given.kind,
          inputs: this.indicatorRegistry.inputs(given.kind, given.inputs ?? {}),
          visible: true,
        });
        break;
      }
      case 'indicator.update': {
        const index = next.indicators.findIndex(entry => entry.id === command.id);
        if (index < 0)
          throw new ChartError('INDICATOR_NOT_FOUND', undefined, { path: 'id', details: { id: command.id } });
        const entry = next.indicators[index];
        if (command.visible !== undefined && typeof command.visible !== 'boolean')
          throw new ChartError('INVALID_COMMAND', 'visible must be a boolean', { path: 'visible' });
        if (command.inputs !== undefined) {
          if (!this.indicatorRegistry.get(entry.kind))
            throw new ChartError('UNKNOWN_INDICATOR', 'inputs of an unregistered kind cannot change', {
              details: { kind: entry.kind },
            });
          entry.inputs = this.indicatorRegistry.inputs(entry.kind, { ...entry.inputs, ...command.inputs });
        }
        if (command.visible !== undefined) entry.visible = command.visible;
        break;
      }
      case 'indicator.remove': {
        const index = next.indicators.findIndex(entry => entry.id === command.id);
        if (index < 0)
          throw new ChartError('INDICATOR_NOT_FOUND', undefined, { path: 'id', details: { id: command.id } });
        next.indicators.splice(index, 1);
        break;
      }
      default:
        throw new ChartError('UNKNOWN_COMMAND', undefined, {
          path: 'type',
          details: { type: (command as { type?: unknown }).type },
        });
    }
    this.commit(this.parse(next), true);
  }
  private drawingIndex(document: ChartDocument, id: string): number {
    const index = document.drawings.findIndex(drawing => drawing.id === id);
    if (index < 0) throw new ChartError('DRAWING_NOT_FOUND', undefined, { path: 'id', details: { id } });
    return index;
  }
  private pushHistory(stack: ChartDocument[]): void {
    stack.push(this.exportDocument());
    if (stack.length > 40) stack.shift();
  }
  private remember(): void {
    this.pushHistory(this.history);
    this.future = [];
  }
  exportDocument(): ChartDocument {
    return structuredClone(this.document);
  }
  restoreDocument(value: unknown, expectedRevision?: number): void {
    this.assertRevision(expectedRevision);
    this.commit(this.parse(value), true);
  }
  /** Borrowed subscription views must not be mutated. inspect/exportDocument return owned copies. */
  state(): RuntimeState {
    return {
      feed: this.descriptor,
      generation: this.generation,
      streams: this.streams,
      candles: this.candles,
      document: this.document,
      book: this.book.inspect(80),
      indicators: this.indicators.flatMap(({ entry, plugin, series }): ActiveIndicator[] =>
        plugin && series.length ? [{ plugin, values: series[0], series, visible: entry.visible }] : [],
      ),
      unsupportedIndicatorKinds: [
        ...new Set(this.indicators.filter(slot => !slot.plugin).map(slot => slot.entry.kind)),
      ],
      paused: this.paused,
      dataRevision: this.dataRevision,
      documentRevision: this.documentRevision,
      history: { canUndo: this.history.length > 0, canRedo: this.future.length > 0 },
      olderHistory: this.olderHistory,
      unsupportedDrawingTypes: [
        ...new Set(
          this.document.drawings
            .filter(drawing => !this.drawingRegistry.get(drawing.type))
            .map(drawing => drawing.type),
        ),
      ],
      error:
        Object.values(this.streams)
          .filter(s => s.status === 'error')
          .map(s => s.message)
          .filter(Boolean)
          .join(' · ') || null,
    };
  }
  inspect() {
    return structuredClone({
      feed: this.descriptor,
      symbol: this.descriptor.instrument.symbol,
      simulated: this.descriptor.simulated,
      generation: this.generation,
      streams: this.streams,
      capabilities: {
        heatmap: this.heatmapEnabled,
        drawingTools: this.drawingRegistry
          .list()
          .map(({ type, label, group, points, hint, editableText, editableProperties, create }) => ({
            type,
            label,
            group,
            points,
            hint,
            editableText: !!editableText,
            editableProperties: !!editableProperties,
            placement: create ? 'single-click' : points,
          })),
      },
      paused: this.paused,
      dataRevision: this.dataRevision,
      documentRevision: this.documentRevision,
      candleCount: this.candles.length,
      latestCandle: this.candles.at(-1) ?? null,
      book: this.book.inspect(10),
      history: { canUndo: this.history.length > 0, canRedo: this.future.length > 0 },
      olderHistory: this.olderHistory,
      maxCandles: this.maxCandles,
      firstCandleTimeMs: this.candles[0]?.timeMs ?? null,
      unsupportedDrawingTypes: this.state().unsupportedDrawingTypes,
      heatmap: this.heatmap
        ? { columns: this.heatmap.count, capacity: this.heatmap.capacity, rows: this.heatmap.grid.rows }
        : null,
      document: this.document,
      indicators: this.indicators.map(({ entry, plugin, series }) => ({
        ...entry,
        name: plugin?.name ?? entry.kind,
        pane: plugin?.pane ?? 'price',
        supported: !!plugin,
        value: series[0]?.at(-1) ?? null,
        outputs: Object.fromEntries(
          (plugin?.outputs ?? [{ id: 'value' }]).map((output, i) => [output.id, series[i]?.at(-1) ?? null]),
        ),
      })),
      indicatorKinds: this.indicatorRegistry.list().map(({ kind, name, description, pane, inputs }) => ({
        kind,
        name,
        description,
        pane,
        inputs,
      })),
      error: this.state().error,
    });
  }
  subscribe(listener: (state: RuntimeState) => void): () => void {
    if (this.disposed) throw new ChartError('DISPOSED');
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }
  private publish(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.connection?.dispose();
    this.connection = undefined;
    this.listeners.clear();
    this.history = [];
    this.future = [];
  }
}
