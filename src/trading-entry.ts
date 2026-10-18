/**
 * Order entry through a broker adapter, kept out of the chart and widget. `candleframe/trading`.
 * Attach it to a widget or a bare chart with `attachTrading(chart, { broker, host })`.
 */
export { attachTrading } from './trading.ts';
export type { TradingLayer, TradingOptions } from './trading.ts';
export { createPaperBroker } from './paper-broker.ts';
export type { PaperBroker, PaperBrokerOptions } from './paper-broker.ts';
export {
  describeOrder,
  entryTypeAt,
  exitAt,
  formatPnl,
  pnlAt,
  positionEffect,
  positionOf,
} from './trading-logic.ts';
export type * from './trading-types.ts';
