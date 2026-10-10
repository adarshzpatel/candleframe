import type { Drawing, DrawingInput, DrawingPatch } from './drawing-types.ts';

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
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
export interface IndicatorPlugin {
  readonly id: string;
  readonly name: string;
  readonly color: readonly [number, number, number, number];
  /** Opt into a theme token; otherwise the explicit plugin color is preserved. */
  readonly themeColor?: 'indicator';
  calculate(candles: readonly Candle[], previous: readonly number[], changedIndex: number): number[];
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
export type PriceScale = { mode: 'auto' } | { mode: 'manual'; minPrice: number; maxPrice: number };
export interface ChartDocument {
  version: 3;
  feedId: string;
  symbol: string;
  interval: Interval;
  layers: Record<Layer, boolean>;
  intensity: number;
  viewport: { fromMs: number; toMs: number; following: boolean };
  priceScale: PriceScale;
  drawings: Drawing[];
}
export type ChartCommand =
  | { type: 'layer.set'; layer: Layer; visible: boolean }
  | { type: 'heatmap.intensity'; value: number }
  | { type: 'viewport.set'; fromMs: number; toMs: number; priceScale?: PriceScale }
  | { type: 'viewport.reset' }
  | { type: 'priceScale.set'; minPrice: number; maxPrice: number }
  | { type: 'priceScale.reset' }
  | { type: 'drawing.add'; drawing: DrawingInput | TrendLine }
  | { type: 'drawing.update'; id: string; patch: DrawingPatch }
  | { type: 'drawing.remove'; id: string }
  | { type: 'drawing.duplicate'; id: string; newId: string; offset?: { timeMs: number; price: number } }
  | { type: 'drawing.order'; id: string; where: 'front' | 'back' }
  | { type: 'drawing.lockAll'; locked: boolean }
  | { type: 'drawing.clear' }
  | { type: 'history.undo' }
  | { type: 'history.redo' }
  | { type: 'feed.pause'; paused: boolean };
export interface BookView {
  status: 'waiting' | 'live' | 'stale';
  sequence: number;
  bids: readonly Level[];
  asks: readonly Level[];
}
export interface RuntimeState {
  feed: FeedDescriptor;
  generation: number;
  streams: Readonly<Record<Stream, StreamHealth>>;
  candles: readonly Candle[];
  document: Readonly<ChartDocument>;
  book: BookView;
  indicators: readonly { plugin: IndicatorPlugin; values: readonly number[] }[];
  paused: boolean;
  dataRevision: number;
  documentRevision: number;
  history: { canUndo: boolean; canRedo: boolean };
  olderHistory: OlderHistory;
  unsupportedDrawingTypes: readonly string[];
  error: string | null;
}
