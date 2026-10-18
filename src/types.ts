import type { Drawing, DrawingGroup, DrawingInput, DrawingPatch } from './drawing-types.ts';
import type { FlowSignalOptions } from './flow-signals.ts';

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Volume from aggressive (taker) buyers; the rest of `volume` was sold. Optional. */
  buyVolume?: number;
  /** Optional volume at price, ascending by price. Each price is the low edge of an equal-width bucket. */
  footprint?: readonly FootprintLevel[];
  /**
   * Lowest and highest running buy minus sell volume inside the bar, measured from its
   * open. Optional; CVD candles use it for wicks and draw bodies only without it.
   */
  deltaRange?: readonly [low: number, high: number];
  /**
   * Large aggressive prints inside the bar, oldest first. Optional; the feed decides the
   * smallest size it keeps, and the big trades indicator filters further.
   */
  largeTrades?: readonly LargeTrade[];
}
/** Volume traded inside one price bucket of a candle, split by aggressor side. */
export type FootprintLevel = readonly [price: number, buyVolume: number, sellVolume: number];
/**
 * One aggressive print: `side` 1 for a buyer lifting offers, -1 for a seller hitting bids.
 * A sweep through several prices is one print at its volume-weighted price.
 */
export type LargeTrade = readonly [price: number, size: number, side: 1 | -1, timeMs: number];
export type Level = readonly [price: number, quantity: number];
export interface DepthSnapshot {
  sequence: number;
  bids: readonly Level[];
  asks: readonly Level[];
}
export interface DepthDelta extends DepthSnapshot {
  previousSequence: number;
}
export interface DepthColumn {
  timeMs: number;
  values: Float32Array;
  valid: boolean;
}
export interface HeatmapGrid {
  minPrice: number;
  binSize: number;
  rows: number;
  intervalMs: number;
}
import type { Interval } from './intervals.ts';
export type { Interval, IntervalUnit } from './intervals.ts';
/** Common intervals, for pickers. Any `intervalToMs`-parseable interval is accepted. */
export const INTERVAL_MS: Readonly<Record<string, number>> = {
  '1s': 1000,
  '1m': 60000,
  '3m': 180000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '2h': 7200000,
  '4h': 14400000,
  '6h': 21600000,
  '12h': 43200000,
  '1d': 86400000,
  '3d': 259200000,
  '1w': 604800000,
};
export interface Instrument {
  symbol: string;
  name: string;
  base: string;
  quote: string;
  tickSize: number;
  pricePrecision: number;
  quantityPrecision: number;
}
export interface FeedDescriptor {
  id: string;
  label: string;
  instrument: Instrument;
  interval: Interval;
  intervalMs: number;
  simulated: boolean;
  /** `none` (with `levels: 0`) for feeds without an order book. */
  depth: { kind: 'snapshots' | 'sequenced' | 'none'; levels: number };
  /**
   * True when history may skip intervals: exchange sessions, weekends, holidays.
   * The time axis then collapses the gaps, and candle times need only ascend.
   */
  gaps?: boolean;
}
export type Stream = 'candles' | 'depth';
export interface StreamHealth {
  /** `unavailable` marks the depth stream of a feed declared with `depth.kind: 'none'`. */
  status: 'loading' | 'live' | 'stale' | 'error' | 'paused' | 'unavailable';
  message: string | null;
  receivedAtMs: number | null;
}
export type FeedEvent =
  | { type: 'instrument'; instrument: Instrument }
  | { type: 'candles.history'; candles: readonly Candle[] }
  /**
   * Older candles, in reply to `FeedConnection.loadOlder`. They must end before the
   * first loaded candle. `exhausted` means no older data exists; `error` reports a
   * failed request without affecting the live stream.
   */
  | { type: 'candles.prepend'; candles: readonly Candle[]; exhausted?: boolean; error?: string }
  | { type: 'candle'; candle: Candle }
  | { type: 'depth.snapshot'; book: DepthSnapshot }
  | { type: 'depth.delta'; book: DepthDelta }
  | { type: 'stream.status'; stream: Stream; status: 'loading' | 'stale' | 'error'; message?: string }
  | { type: 'heatmap.history'; grid: HeatmapGrid; columns: readonly DepthColumn[] };
export interface FeedConnection {
  setPaused(paused: boolean): void;
  requestSnapshot(): void;
  dispose(): void;
  /** Optional. Load candles that end before `beforeMs`, then emit `candles.prepend`. */
  loadOlder?(beforeMs: number): void;
}
/** Paging state for history older than the loaded candles. */
export interface OlderHistory {
  status: 'unavailable' | 'idle' | 'loading' | 'exhausted' | 'error';
  message: string | null;
}
/** One immutable market selection; each connection owns its transport and recovery state. */
export interface FeedAdapter {
  readonly descriptor: FeedDescriptor;
  connect(emit: (event: FeedEvent) => void): FeedConnection;
}
/** Theme palette slots for indicator series, in the order built-ins use them. */
export type IndicatorColorSlot =
  'indicator' | 'indicator2' | 'indicator3' | 'indicator4' | 'indicator5' | 'indicator6';
export interface IndicatorOutput {
  readonly id: string;
  readonly name: string;
  readonly color: readonly [number, number, number, number];
  /** Use this theme slot instead of `color`; the alpha of `color` still applies. */
  readonly themeColor?: IndicatorColorSlot;
  /**
   * `histogram` draws bars from zero, toned by sign. `column` draws bars from zero in the
   * output's own color. `dot` draws a small circle at each finite value. `candles` is not
   * drawn or fitted: its values index `palette` and recolor the price candles, NaN keeping
   * the theme color. `none` is not drawn but still feeds fills and the fitted range.
   * Default `line`.
   */
  readonly style?: 'line' | 'histogram' | 'column' | 'dot' | 'candles' | 'none';
  /** With `style: 'dot'`: radius in pixels. Default 3. */
  readonly radius?: number;
  /** With `style: 'candles'`: the candle colors its values index. */
  readonly palette?: readonly (readonly [number, number, number, number])[];
}
export interface IndicatorPlugin {
  readonly id: string;
  readonly name: string;
  readonly color: readonly [number, number, number, number];
  /** Opt into a theme slot for a single-series plugin; otherwise `color` is kept. */
  readonly themeColor?: IndicatorColorSlot;
  /**
   * `price` overlays the candles (default). `separate` gets its own pane below.
   * `profile` draws on the price plot from the visible bars without a series: rows
   * against the price axis (`profile`), trade bubbles (`bubbles`) or absorption and
   * aggression markers (`flowSignals`).
   */
  readonly pane?: IndicatorPane;
  /** With `pane: 'profile'`: rows against the price axis. */
  readonly profile?: ProfileOptions;
  /** With `pane: 'profile'`: bubbles for the candles' `largeTrades`. */
  readonly bubbles?: BubbleOptions;
  /** With `pane: 'profile'`: absorption and aggression markers on the bars. */
  readonly flowSignals?: FlowSignalOptions;
  /** Fixed pane range, such as RSI's 0 to 100. Otherwise the pane fits the visible values. */
  readonly range?: { readonly min: number; readonly max: number };
  /** Guide values drawn across the pane, such as RSI 30 and 70. */
  readonly levels?: readonly number[];
  /** Registry kind and inputs, set by built-ins and `IndicatorDefinition.create`. */
  readonly kind?: string;
  readonly inputs?: Readonly<Record<string, number>>;
  /** `candles` draws four outputs (open, high, low, close) as candles in the pane. */
  readonly display?: 'candles';
  /**
   * Shade between pairs of outputs, under the candles, in the upper output's color at
   * `opacity`. Like lines, a fill spans from one bar to the next where both have values.
   */
  readonly fills?: readonly { readonly upper: number; readonly lower: number; readonly opacity: number }[];
  /** Several series. With `outputs`, the runtime calls `calculateOutputs` instead of `calculate`. */
  readonly outputs?: readonly IndicatorOutput[];
  /** One value per candle; NaN means warmup or missing. Recompute from `changedIndex`. */
  calculate?(candles: readonly Candle[], previous: readonly number[], changedIndex: number): number[];
  /** One array per output, each with one value per candle. */
  calculateOutputs?(
    candles: readonly Candle[],
    previous: readonly (readonly number[])[],
    changedIndex: number,
  ): number[][];
}
export type IndicatorPane = 'price' | 'separate' | 'profile';
/** How a profile indicator aggregates and draws the visible bars. */
export interface ProfileOptions {
  /** Draw the volume column: buy and sell volume at each price, with POC and value area. */
  readonly volume: boolean;
  /** Draw the delta column: buy minus sell volume at each price. */
  readonly delta: boolean;
  /** Target row height in pixels. Rows snap to round prices so they stay put while panning. */
  readonly rowHeight: number;
  /** Share of the plot width, 0.05 to 0.5. The delta column takes half when both show. */
  readonly width: number;
  /** Share of volume inside the value area, such as 0.7. */
  readonly valueArea?: number;
  /**
   * `visible` profiles the bars in view against the price axis. `today` (the calendar day in
   * the chart time zone) and `session` (bars since the last trading gap) draw only that
   * profile, over its own bars, with no axis column or past sessions. Default `visible`.
   */
  readonly range?: 'visible' | 'today' | 'session';
  /** Also draw a fixed-range profile over each of this many past days. Default 0. */
  readonly sessions?: number;
}
export interface BubbleOptions {
  /** Smallest print shown, in contracts or units. */
  readonly minSize: number;
  /** Radius of the largest bubble in view, in pixels. */
  readonly maxRadius: number;
}
/** An indicator saved in a layout. The runtime resolves `kind` through its indicator registry. */
export interface DocumentIndicator {
  id: string;
  kind: string;
  inputs: Record<string, number>;
  visible: boolean;
}
export type Layer = 'heatmap' | 'candles' | 'volume' | 'indicator';
export interface Anchor {
  timeMs: number;
  price: number;
}
export interface TrendLine {
  id: string;
  start: Anchor;
  end: Anchor;
}
/** `log: true` spaces prices by ratio, so equal percentage moves have equal height. */
export type PriceScale =
  { mode: 'auto'; log?: boolean } | { mode: 'manual'; minPrice: number; maxPrice: number; log?: boolean };
/** What each footprint cell shows: sell × buy volume, buy minus sell, or a volume bar. */
export type FootprintMode = 'bidAsk' | 'delta' | 'volume';
export interface FootprintOptions {
  mode: FootprintMode;
  /** Highlight rows where one side beats the diagonal opposite side 3 to 1. */
  imbalance: boolean;
  /** Outline each bar's heaviest row. */
  poc: boolean;
  /** Bar delta and volume under each bar. */
  summary: boolean;
}
/**
 * `footprint` draws each bar's `footprint` levels as price cells beside a thin candle.
 * Bars without levels, and views zoomed out past readable cells, draw as candles.
 */
export type ChartType = 'candles' | 'footprint';
export interface ChartDocument {
  version: 4;
  feedId: string;
  symbol: string;
  interval: Interval;
  layers: Record<Layer, boolean>;
  intensity: number;
  viewport: { fromMs: number; toMs: number; following: boolean };
  priceScale: PriceScale;
  /** Omitted means candles. Builds without footprint support ignore it. */
  chartType?: ChartType;
  /** Footprint cell settings, kept while candles show. Omitted means the defaults. */
  footprint?: FootprintOptions;
  /** Active indicators, in pane order. Version 3 layouts migrate to the host's defaults. */
  indicators: DocumentIndicator[];
  drawings: Drawing[];
  /** Omitted when there are no groups, so documents without groups serialize as before. */
  drawingGroups?: DrawingGroup[];
}
export type ChartCommand =
  | { type: 'layer.set'; layer: Layer; visible: boolean }
  | { type: 'heatmap.intensity'; value: number }
  | { type: 'viewport.set'; fromMs: number; toMs: number; priceScale?: PriceScale }
  | { type: 'viewport.reset' }
  | { type: 'priceScale.set'; minPrice: number; maxPrice: number }
  | { type: 'priceScale.reset' }
  | { type: 'priceScale.log'; enabled: boolean }
  | { type: 'chartType.set'; chartType: ChartType; footprint?: Partial<FootprintOptions> }
  | { type: 'indicator.add'; indicator: { id?: string; kind: string; inputs?: Record<string, number> } }
  | { type: 'indicator.update'; id: string; inputs?: Record<string, number>; visible?: boolean }
  | { type: 'indicator.remove'; id: string }
  | { type: 'drawing.add'; drawing: DrawingInput | TrendLine }
  | { type: 'drawing.update'; id: string; patch: DrawingPatch }
  | { type: 'drawing.remove'; id: string }
  | { type: 'drawing.duplicate'; id: string; newId: string; offset?: { timeMs: number; price: number } }
  | { type: 'drawing.order'; id: string; where: 'front' | 'back' }
  | { type: 'drawing.lockAll'; locked: boolean }
  | { type: 'drawing.clear' }
  /** Every drawing id, back to front. */
  | { type: 'drawing.reorder'; ids: string[] }
  | { type: 'drawing.group'; id: string; drawingIds: string[]; name?: string }
  | { type: 'drawing.updateGroup'; id: string; name?: string; drawingIds?: string[] }
  | { type: 'drawing.ungroup'; id: string }
  | { type: 'history.undo' }
  | { type: 'history.redo' }
  | { type: 'feed.pause'; paused: boolean };
export interface BookView {
  status: 'waiting' | 'live' | 'stale';
  sequence: number;
  bids: readonly Level[];
  asks: readonly Level[];
}
export interface ActiveIndicator {
  plugin: IndicatorPlugin;
  /** The first output, one value per candle. */
  values: readonly number[];
  series: readonly (readonly number[])[];
  visible: boolean;
}
export interface RuntimeState {
  feed: FeedDescriptor;
  generation: number;
  streams: Readonly<Record<Stream, StreamHealth>>;
  candles: readonly Candle[];
  document: Readonly<ChartDocument>;
  book: BookView;
  /** Active indicators with computed values. `series` holds one array per output. */
  indicators: readonly ActiveIndicator[];
  paused: boolean;
  dataRevision: number;
  documentRevision: number;
  history: { canUndo: boolean; canRedo: boolean };
  olderHistory: OlderHistory;
  /** Saved indicator kinds that this runtime cannot compute. They stay in the document. */
  unsupportedIndicatorKinds: readonly string[];
  unsupportedDrawingTypes: readonly string[];
  error: string | null;
}
