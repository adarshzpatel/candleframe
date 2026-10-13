/**
 * DOM-free entry: runtime, documents, commands, feeds without sockets, indicators and
 * schemas. Safe to import in Node, workers and tests. `candleframe/core`.
 */
export { ChartError, isChartError, toChartError } from './errors.ts';
export { chartCommandSchema, chartCommandBatchSchema, chartCommandTypes } from './command-schema.ts';
export { ChartRuntime, parseDocument } from './runtime.ts';
export type {
  RuntimeOptions,
  CommandResult,
  DataQuery,
  DataResult,
  ExecuteOptions,
  RestoreOptions,
  PreviewResult,
} from './runtime.ts';
export { createSimulatedFeed } from './simulated-feed.ts';
export { createStaticFeed } from './static-feed.ts';
export type { StaticFeed, StaticFeedOptions } from './static-feed.ts';
export { INTERVAL_MS } from './types.ts';
export {
  intervalToMs,
  isInterval,
  alignTime,
  parseInterval,
  isTimeInterval,
  intervalLabel,
  TRADE_BAR_SLOT_MS,
} from './intervals.ts';
export type { IntervalSpec, TimeIntervalUnit, TradeIntervalUnit } from './intervals.ts';
export { TradeBarBuilder } from './trade-bars.ts';
export type { BarRule, Trade, TradeBarOptions } from './trade-bars.ts';
export { createTimeScale } from './time-scale.ts';
export type { TimeScale } from './time-scale.ts';
export { createTimeFormats } from './time-format.ts';
export type { TimeFormats } from './time-format.ts';
export {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  cvd,
  volumeProfile,
  priceDelta,
  bigTrades,
  builtInIndicators,
  IndicatorRegistry,
} from './indicators.ts';
export { buildProfile, profileStep } from './profiles.ts';
export type { PriceProfile, ProfileRow } from './profiles.ts';
export type { IndicatorDefinition, IndicatorInputSpec, SeriesIndicator } from './indicators.ts';
export { OrderBook } from './order-book.ts';
export { DrawingRegistry, builtInDrawingTools, DEFAULT_DRAWING_STYLE } from './drawing-tools.ts';
export type * from './types.ts';
export type * from './drawing-types.ts';
