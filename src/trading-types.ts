/**
 * The contract between the chart's trading UI and a broker. A broker adapter turns its
 * connection (a relay, a REST API, a paper account) into these shapes, and the chart
 * draws orders and positions, and sends orders, through it. Modeled on TradingView's
 * Broker API: state flows in through `subscribe`, actions go out as promises.
 *
 * Symbols are the chart's instrument symbols (`MNQ`, `BTC/USDT`). Mapping one to the
 * contract it trades (`MNQZ6`) is the adapter's job.
 */

export type OrderSide = 'buy' | 'sell';
/** `stop` is a stop market order: it becomes a market order when price trades through. */
export type TradeOrderType = 'market' | 'limit' | 'stop';

/** A working order: resting, not yet filled or cancelled. */
export interface BrokerOrder {
  id: string;
  account: string;
  symbol: string;
  side: OrderSide;
  /** Types the chart cannot draw, such as stop limits, may be reported as `other`. */
  type: TradeOrderType | 'other';
  /** Quantity still to fill. */
  quantity: number;
  /** The resting price: the limit price, or the trigger price of a stop. */
  price: number;
}

/** An open position. Flat positions may be left out. */
export interface BrokerPosition {
  account: string;
  symbol: string;
  /** Positive long, negative short. */
  quantity: number;
  averagePrice: number;
}

/** An execution, drawn as a B or S badge on the bar it happened in. */
export interface BrokerFill {
  account: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  timeMs: number;
}

export interface BrokerState {
  /** False while the adapter cannot reach its broker; the UI shows it and sends nothing. */
  connected: boolean;
  /** Whether the adapter accepts orders at all. When false the UI is read only. */
  tradingEnabled: boolean;
  /** Largest quantity the adapter accepts per order, if it limits it. */
  maxQuantity?: number;
  accounts: readonly string[];
  orders: readonly BrokerOrder[];
  positions: readonly BrokerPosition[];
  fills: readonly BrokerFill[];
}

export interface OrderRequest {
  account: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  type: TradeOrderType;
  /** The limit price for `limit`, the trigger price for `stop`. */
  price?: number;
  /**
   * True for orders that may only reduce the position: targets, stops and flatten.
   * Adapters should refuse them when they would open or add to a position.
   */
  reduceOnly?: boolean;
}

export interface OrderChange {
  price?: number;
  quantity?: number;
}

export interface OrderResult {
  ok: boolean;
  orderId?: string;
  /** Why the broker or the adapter refused, in words the user can act on. */
  error?: string;
}

export interface BrokerAdapter {
  /** Calls `listener` with the current state at once, then on every change. */
  subscribe(listener: (state: BrokerState) => void): () => void;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  /** Changes a working limit or stop order's price, quantity or both. */
  modifyOrder(account: string, orderId: string, change: OrderChange): Promise<OrderResult>;
  cancelOrder(account: string, orderId: string): Promise<OrderResult>;
  /** Money per point of price for one unit, for P&L. Without it P&L is in points. */
  pointValue?(symbol: string): number | undefined;
  /** Optional currency label for P&L, such as `$` (default). */
  readonly currency?: string;
  /**
   * Optional: receives each chart's last price as it changes. Simulated brokers fill
   * against it; brokers with their own market data can leave it out.
   */
  onMarketPrice?(symbol: string, price: number, timeMs: number): void;
}
