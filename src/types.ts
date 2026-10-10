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
export type Interval = '1m' | '5m' | '15m' | '1h';
export const INTERVAL_MS: Readonly<Record<Interval, number>> = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
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
  depth: { kind: 'snapshots' | 'sequenced'; levels: number };
}
export type Stream = 'candles' | 'depth';
export interface StreamHealth {
  status: 'loading' | 'live' | 'stale' | 'error' | 'paused';
  message: string | null;
  receivedAtMs: number | null;
}
export type FeedEvent =
  | { type: 'instrument'; instrument: Instrument }
  | { type: 'candles.history'; candles: readonly Candle[] }
  | { type: 'candle'; candle: Candle }
  | { type: 'depth.snapshot'; book: DepthSnapshot }
  | { type: 'depth.delta'; book: DepthDelta }
  | { type: 'stream.status'; stream: Stream; status: 'loading' | 'stale' | 'error'; message?: string }
  | { type: 'heatmap.history'; grid: HeatmapGrid; columns: readonly DepthColumn[] };
export interface FeedConnection {
  setPaused(paused: boolean): void;
  requestSnapshot(): void;
  dispose(): void;
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
  unsupportedDrawingTypes: readonly string[];
  error: string | null;
}
