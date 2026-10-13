import type { BrokerOrder, BrokerPosition, BrokerState, OrderSide, TradeOrderType } from './trading-types.ts';

/** The account's position in a symbol, or null when flat. */
export function positionOf(state: BrokerState, account: string, symbol: string): BrokerPosition | null {
  return state.positions.find(p => p.account === account && p.symbol === symbol && p.quantity !== 0) ?? null;
}

/** P&L of a position if closed at `price`: points times quantity times the point value. */
export function pnlAt(position: BrokerPosition, price: number, pointValue = 1): number {
  return (price - position.averagePrice) * position.quantity * pointValue;
}

/** `+$12.50` or, without a point value, `+12.5 pts`. */
export function formatPnl(value: number, currency = '$', pointValue?: number): string {
  const sign = value >= 0 ? '+' : '−';
  return pointValue === undefined
    ? `${sign}${Math.abs(value).toFixed(2)} pts`
    : `${sign}${currency}${Math.abs(value).toFixed(2)}`;
}

/** An order that would close the position, at least partly. */
export function closesPosition(side: OrderSide, position: BrokerPosition | null): boolean {
  return (
    !!position && ((position.quantity > 0 && side === 'sell') || (position.quantity < 0 && side === 'buy'))
  );
}

export interface OrderLook {
  /** `TP` and `SL` close the position; `entry` orders open or add to it. */
  kind: 'TP' | 'SL' | 'entry';
  label: string;
  tone: 'positive' | 'negative';
}

/**
 * How an order reads on the chart at `price` (its own, or where it is being dragged).
 * A limit that closes the position is a TP and a stop that closes it an SL, both with
 * the P&L at that price; others are named by side and type.
 */
export function describeOrder(
  order: Pick<BrokerOrder, 'side' | 'type'>,
  position: BrokerPosition | null,
  price: number,
  pointValue?: number,
  currency?: string,
): OrderLook {
  if (closesPosition(order.side, position) && (order.type === 'limit' || order.type === 'stop')) {
    const kind = order.type === 'limit' ? 'TP' : 'SL';
    const pnl = formatPnl(pnlAt(position!, price, pointValue ?? 1), currency, pointValue);
    return { kind, label: `${kind} ${pnl}`, tone: kind === 'TP' ? 'positive' : 'negative' };
  }
  const type = order.type === 'other' ? 'ORDER' : order.type.toUpperCase();
  return {
    kind: 'entry',
    label: `${order.side.toUpperCase()} ${type}`,
    tone: order.side === 'buy' ? 'positive' : 'negative',
  };
}

/**
 * What dropping a line dragged out of the position at `price` places: beyond the market
 * in the position's favor a TP limit, against it an SL stop, for the whole position.
 */
export function exitAt(position: BrokerPosition, last: number, price: number) {
  const long = position.quantity > 0;
  const target = long ? price > last : price < last;
  return {
    kind: target ? ('TP' as const) : ('SL' as const),
    side: long ? ('sell' as const) : ('buy' as const),
    type: target ? ('limit' as const) : ('stop' as const),
    quantity: Math.abs(position.quantity),
  };
}

/**
 * How an entry at `price` rests: a buy below the market (or at it) is a limit and above
 * it a stop; a sell the other way round. Without a last price it is a limit.
 */
export function entryTypeAt(
  side: OrderSide,
  price: number,
  last: number | null,
): Exclude<TradeOrderType, 'market'> {
  if (last === null) return 'limit';
  return (side === 'buy' ? price <= last : price >= last) ? 'limit' : 'stop';
}

/** What an order does to the position, in words: "Opens long 1", "Closes your position". */
export function positionEffect(net: number, side: OrderSide, quantity: number): string {
  const after = net + (side === 'buy' ? quantity : -quantity);
  const word = (n: number) => (n > 0 ? 'long' : 'short');
  if (net === 0) return `Opens ${word(after)} ${Math.abs(after)}`;
  if (after === 0) return 'Closes your position';
  if (Math.sign(after) !== Math.sign(net)) return `Reverses to ${word(after)} ${Math.abs(after)}`;
  return Math.abs(after) > Math.abs(net)
    ? `Adds to your ${word(net)}: ${Math.abs(after)} after`
    : `Reduces your ${word(net)} to ${Math.abs(after)}`;
}

/**
 * TPs and SLs to resize so they cover the whole position, after it grew or shrank. Only
 * for a symbol with exactly one TP and/or exactly one SL: several targets mean the user
 * scales out on purpose, so they are left alone.
 */
export function exitResizes(state: BrokerState, account: string): { orderId: string; quantity: number }[] {
  const resizes: { orderId: string; quantity: number }[] = [];
  for (const position of state.positions) {
    if (position.account !== account || position.quantity === 0) continue;
    const size = Math.abs(position.quantity);
    const exits = state.orders.filter(
      o => o.account === account && o.symbol === position.symbol && closesPosition(o.side, position),
    );
    for (const type of ['limit', 'stop'] as const) {
      const ofType = exits.filter(o => o.type === type);
      if (ofType.length === 1 && ofType[0]!.quantity !== size)
        resizes.push({ orderId: ofType[0]!.id, quantity: size });
    }
  }
  return resizes;
}
