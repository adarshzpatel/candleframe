import type {
  BrokerAdapter,
  BrokerFill,
  BrokerOrder,
  BrokerPosition,
  BrokerState,
  OrderRequest,
  OrderResult,
} from './trading-types.ts';

export interface PaperBrokerOptions {
  accounts?: readonly string[];
  /** Money per point for P&L, per symbol. Default 1. */
  pointValue?: (symbol: string) => number | undefined;
  maxQuantity?: number;
}

export interface PaperBroker extends BrokerAdapter {
  /**
   * Feeds the latest traded price. Market orders fill at it; limits fill when price
   * reaches them, stops when it trades through. The trading layer calls this with each
   * chart's last price.
   */
  onMarketPrice(symbol: string, price: number, timeMs: number): void;
}

/**
 * A simulated broker for demos and tests: orders fill against the prices it is fed, with
 * positions, average prices and fills kept in memory. No slippage, fees or partial fills.
 */
export function createPaperBroker(options: PaperBrokerOptions = {}): PaperBroker {
  const accounts = options.accounts ?? ['Paper'];
  const orders = new Map<string, BrokerOrder>();
  const positions = new Map<string, BrokerPosition>();
  const fills: BrokerFill[] = [];
  const last = new Map<string, { price: number; timeMs: number }>();
  const listeners = new Set<(state: BrokerState) => void>();
  let nextId = 1;

  const snapshot = (): BrokerState => ({
    connected: true,
    tradingEnabled: true,
    ...(options.maxQuantity ? { maxQuantity: options.maxQuantity } : {}),
    accounts,
    orders: [...orders.values()],
    positions: [...positions.values()].filter(p => p.quantity !== 0),
    fills: [...fills],
  });
  const publish = () => {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const refuse = (error: string): OrderResult => ({ ok: false, error });

  function fill(
    account: string,
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    price: number,
    timeMs: number,
  ) {
    const key = `${account}|${symbol}`;
    const held = positions.get(key) ?? { account, symbol, quantity: 0, averagePrice: 0 };
    const signed = side === 'buy' ? quantity : -quantity;
    const after = held.quantity + signed;
    let average = held.averagePrice;
    if (held.quantity === 0 || Math.sign(held.quantity) === Math.sign(signed))
      average = (held.averagePrice * Math.abs(held.quantity) + price * quantity) / Math.abs(after);
    else if (Math.sign(after) !== Math.sign(held.quantity) && after !== 0) average = price;
    positions.set(key, { account, symbol, quantity: after, averagePrice: after === 0 ? 0 : average });
    fills.push({ account, symbol, side, price, quantity, timeMs });
  }

  /** Fills working orders the price has reached. */
  function match(symbol: string, price: number, timeMs: number) {
    for (const order of [...orders.values()]) {
      if (order.symbol !== symbol) continue;
      const reached =
        order.type === 'limit'
          ? order.side === 'buy'
            ? price <= order.price
            : price >= order.price
          : order.type === 'stop'
            ? order.side === 'buy'
              ? price >= order.price
              : price <= order.price
            : false;
      if (!reached) continue;
      orders.delete(order.id);
      // A limit fills at its price or better; a stop becomes a market order.
      fill(
        order.account,
        symbol,
        order.side,
        order.quantity,
        order.type === 'limit' ? order.price : price,
        timeMs,
      );
    }
  }

  return {
    currency: '$',
    pointValue: symbol => options.pointValue?.(symbol) ?? 1,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => void listeners.delete(listener);
    },
    async placeOrder(request: OrderRequest) {
      if (!accounts.includes(request.account)) return refuse(`No account ${request.account}.`);
      if (!(Number.isFinite(request.quantity) && request.quantity > 0))
        return refuse('Quantity must be above 0.');
      if (options.maxQuantity && request.quantity > options.maxQuantity)
        return refuse(`Quantity must be at most ${options.maxQuantity}.`);
      const held = positions.get(`${request.account}|${request.symbol}`)?.quantity ?? 0;
      if (request.reduceOnly) {
        const reduces = (held > 0 && request.side === 'sell') || (held < 0 && request.side === 'buy');
        if (!reduces || request.quantity > Math.abs(held))
          return refuse('A reduce-only order must close part of the position.');
      }
      const market = last.get(request.symbol);
      const id = `P${nextId++}`;
      if (request.type === 'market') {
        if (!market) return refuse(`No price for ${request.symbol} yet.`);
        fill(request.account, request.symbol, request.side, request.quantity, market.price, market.timeMs);
      } else {
        if (!Number.isFinite(request.price)) return refuse('A limit or stop order needs a price.');
        orders.set(id, {
          id,
          account: request.account,
          symbol: request.symbol,
          side: request.side,
          type: request.type,
          quantity: request.quantity,
          price: request.price!,
        });
        if (market) match(request.symbol, market.price, market.timeMs);
      }
      publish();
      return { ok: true, orderId: id };
    },
    async modifyOrder(account, orderId, change) {
      const order = orders.get(orderId);
      if (!order || order.account !== account) return refuse(`Order ${orderId} is not working.`);
      if (change.quantity !== undefined && !(change.quantity > 0)) return refuse('Quantity must be above 0.');
      orders.set(orderId, { ...order, ...change });
      const market = last.get(order.symbol);
      if (market) match(order.symbol, market.price, market.timeMs);
      publish();
      return { ok: true, orderId };
    },
    async cancelOrder(account, orderId) {
      const order = orders.get(orderId);
      if (!order || order.account !== account) return refuse(`Order ${orderId} is not working.`);
      orders.delete(orderId);
      publish();
      return { ok: true, orderId };
    },
    onMarketPrice(symbol, price, timeMs) {
      const before = orders.size;
      last.set(symbol, { price, timeMs });
      match(symbol, price, timeMs);
      if (orders.size !== before) publish();
    },
  };
}
