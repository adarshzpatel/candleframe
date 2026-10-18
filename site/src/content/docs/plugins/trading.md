---
title: Trading plugin
description: Add an order panel and on-chart order entry with attachTrading, try it with the paper broker, and connect a real broker through an adapter.
---

The trading plugin turns a chart into an order ticket. It adds a floating order panel, draws working orders, the position and fills on the chart, and lets the user place, move and cancel orders with the mouse. Orders go to a broker through an adapter you supply.

This page shows how to attach the plugin, what the user gets, how the paper broker behaves, and how to write an adapter for a real broker.

## Attach it

Trading lives in its own entry, `candleframe/trading`. The widget and the bare chart know nothing about orders. You attach the plugin to either one.

```ts
import { attachTrading, createPaperBroker } from 'candleframe/trading';
import { createChartWidget } from 'candleframe/widget';

const widget = createChartWidget(host, { feed, storageKey: 'desk' });
const trading = attachTrading(widget, {
  broker: createPaperBroker(),
  host,
  storageKey: 'desk',
});

// Later: detach trading before disposing the chart.
trading.dispose();
widget.dispose();
```

:::note
Older versions took a `trading` option on `createChartWidget`. That option is gone. Import `attachTrading`, `createPaperBroker`, the order helpers and the broker types from `candleframe/trading`. The root `candleframe` entry still exports them too.
:::

`attachTrading(chartOrWidget, options)` works the same on a chart from `createChart`. With a widget, it draws on every chart in the grid and sends panel orders for the active chart.

| Option | Default | What it does |
| --- | --- | --- |
| `broker` | required | The `BrokerAdapter` that receives orders and reports state. |
| `host` | required | The element the charts fill. The panel floats over it, and right-clicks on it open the order menu. |
| `confirm` | `true` | Show a confirm ticket before every order. Enter confirms, Escape cancels. |
| `account` | last used, then first | The account to start with. |
| `storageKey` | `'candleframe'` | Namespace in browser storage for the panel position, the chosen account, the Show fills switch and the Trading switch. Use the widget's `storageKey` to keep them together. |
| `syncExits` | `true` | Keep a single TP and a single SL sized to the whole position. See [Exits follow the position](#exits-follow-the-position). |

It returns a `TradingLayer` with two methods. `setConfirm(on)` turns the confirm ticket on or off. `dispose()` removes the panel, clears the lines and markers, and unsubscribes from the broker.

While attached, the plugin owns each chart's price lines and markers. It replaces whatever you set with `setPriceLines` or `setMarkers`.

## What the user gets

- **The order panel.** It floats over the chart and drags by its header. It has the account picker, a Trading switch, a Show fills switch, the position and its P&L, a quantity field that takes whole numbers from 1, Buy MKT and Sell MKT, a limit price field with Buy LMT and Sell LMT, Cancel all and Flatten all.
- **Lines on every chart of the symbol.** A limit that would close the position reads TP and a stop that would close it reads SL, each with the P&L at its price. Other orders read by side and type, such as BUY LIMIT. The position line shows the running P&L. Fills show as B and S badges.
- **Mouse entry.** Drag the position line away to place a TP or SL for the whole position. Drag an order line to move it. The × on a line cancels the order, or flattens the position at market. Right-click the plot for buy and sell orders at that price. Drag Buy LMT or Sell LMT from the panel onto the chart.

Placed by price, a buy below the market rests as a limit and a buy above it as a stop. Sells are the other way round. Dropping the position line beyond the market in the position's favour places a limit (TP), and against it a stop (SL).

Nothing is sent until the user turns on Trading in the panel. The switch is kept for the browser tab's session, so it starts off in every new tab. When the adapter reports `connected: false`, the panel says "Broker not connected" and nothing is sent. With `tradingEnabled: false` it is read only.

## The paper broker

`createPaperBroker()` is a complete in-memory broker for demos and tests.

```ts
import { createPaperBroker } from 'candleframe/trading';

const broker = createPaperBroker({
  accounts: ['Paper'], // default
  pointValue: symbol => (symbol === 'MNQ' ? 2 : 1), // money per point; default 1
  maxQuantity: 10, // optional cap on orders that add risk
});
```

It fills against the prices it is fed through `onMarketPrice`. The trading layer feeds it each chart's last price.

- Market orders fill at the last price. Before the first price arrives they are refused with "No price for MNQ yet."
- Limits fill at their own price once the market reaches them.
- Stops fill at the market price once it trades through them.
- Reduce-only orders that would open or add to a position are refused. `maxQuantity` applies only to orders that are not reduce-only.

There is no slippage, no fees and no partial fills. Positions, average prices and fills live in memory and are gone on reload.

## The adapter interface

A broker adapter implements `BrokerAdapter`. State comes in through `subscribe`. Actions go out as promises.

| Member | Required | What it does |
| --- | --- | --- |
| `subscribe(listener)` | yes | Call `listener` with the current `BrokerState` at once, then on every change. Return an unsubscribe function. |
| `placeOrder(order)` | yes | Send an `OrderRequest`. Resolve to an `OrderResult`. |
| `modifyOrder(account, orderId, change)` | yes | Change a working limit or stop order's `price`, `quantity` or both. |
| `cancelOrder(account, orderId)` | yes | Cancel a working order. |
| `pointValue(symbol)` | no | Money per point of price for one unit. Without it, or when it returns `undefined`, P&L reads in points. |
| `currency` | no | The P&L currency label. Default `$`. |
| `onMarketPrice(symbol, price, timeMs)` | no | Receives each chart's last price. Simulated brokers fill against it. Brokers with their own market data can leave it out. |

`BrokerState` is the whole picture the plugin draws from:

| Field | What it holds |
| --- | --- |
| `connected` | `false` while the adapter cannot reach its broker. The panel says so and sends nothing. |
| `tradingEnabled` | `false` makes the plugin read only. |
| `maxQuantity` | Optional largest quantity for an order that opens or adds to a position. The panel's quantity field is capped at it. |
| `accounts` | Account ids for the picker. |
| `orders` | Working orders: `id`, `account`, `symbol`, `side`, `type` (`market`, `limit`, `stop` or `other`), remaining `quantity` and resting `price`. |
| `positions` | Open positions: `account`, `symbol`, signed `quantity` (positive long), `averagePrice`. Flat positions may be left out. |
| `fills` | Executions: `account`, `symbol`, `side`, `price`, `quantity`, `timeMs`. Each draws a badge on its bar. |

Orders of type `other`, such as a stop limit, are drawn as "BUY ORDER" or "SELL ORDER" and cannot be dragged. Limits and stops can.

Symbols are the chart's instrument symbols, such as `MNQ` or `BTC/USDT`. Mapping a symbol to the contract it trades, such as `MNQZ6`, is the adapter's job.

### What the plugin sends

| User action | Call |
| --- | --- |
| Buy MKT, Sell MKT | `placeOrder` with `type: 'market'` |
| Buy LMT, Sell LMT, right-click menu, dragging a limit button | `placeOrder` with `type: 'limit'` or `'stop'` and a `price` |
| Drag the position line out | `placeOrder` with `reduceOnly: true`, a limit (TP) or stop (SL), for the whole position |
| × on the position line | `placeOrder` with `type: 'market'` and `reduceOnly: true` |
| Drag an order line | `modifyOrder` with `{ price }` |
| × on an order line | `cancelOrder` |
| Cancel all | `cancelOrder` for every working order of the symbol on the account, in parallel |
| Flatten all | Cancel all, then the flatten order if every cancel succeeded |

An order result with `ok: true` shows a notice such as "Buy market: accepted (order 42)". With `ok: false` the notice shows your `error` text, so write it for the user: "Quantity must be at most 5." A rejected promise shows as "Order failed:" and the error's message. Resolve with `{ ok: false, error }` for refusals you expect, and let only real failures reject.

### Exits follow the position

With `syncExits` on, the plugin watches each position. When the selected account has exactly one TP and or exactly one SL for a symbol, and its quantity differs from the position size, the plugin calls `modifyOrder` with `{ quantity }` to match. Several TPs or SLs mean the user is scaling out on purpose, so the plugin leaves them alone. It only does this while Trading is on. It asks once per order and size, reports a failed resize in a notice, and does not retry it.

## Order logic helpers

The plugin's order logic is exported, so adapters, custom panels and tests can use the same rules.

| Helper | Returns |
| --- | --- |
| `positionOf(state, account, symbol)` | The non-flat position, or `null`. |
| `pnlAt(position, price, pointValue = 1)` | P&L if the position closed at `price`: points × quantity × point value. |
| `formatPnl(value, currency = '$', pointValue?)` | `+$16.00` with a point value, `+4.00 pts` without one. |
| `describeOrder(order, position, price, pointValue?, currency?)` | How an order reads at a price: `{ kind: 'TP', label: 'TP +$24.00', tone: 'positive' }`, or `kind: 'entry'` with a label such as `BUY LIMIT`. |
| `exitAt(position, last, price)` | The exit a drop at `price` places: `{ kind: 'TP', side: 'sell', type: 'limit', quantity: 2 }` for a long dropped above the market. |
| `entryTypeAt(side, price, last)` | `'limit'` or `'stop'` for an entry at `price`. Without a last price, `'limit'`. |
| `positionEffect(net, side, quantity)` | The order's effect in words: "Opens long 1", "Adds to your long: 3 after", "Reduces your long to 1", "Closes your position", "Reverses to short 1". |

```ts
import { createPaperBroker, describeOrder, positionOf, type BrokerState } from 'candleframe/trading';

const broker = createPaperBroker({ pointValue: () => 2 });
let state!: BrokerState;
broker.subscribe(next => (state = next));

broker.onMarketPrice('MNQ', 100, Date.now());
await broker.placeOrder({ account: 'Paper', symbol: 'MNQ', side: 'buy', quantity: 2, type: 'market' });

const position = positionOf(state, 'Paper', 'MNQ'); // { quantity: 2, averagePrice: 100, ... }
describeOrder({ side: 'sell', type: 'limit' }, position, 106, 2).label; // 'TP +$24.00'
```

## Write an adapter for a real broker

An adapter sits between the plugin and your broker connection. Most of the work is translation:

- **Keep one state object and replace it on every change.** Merge account snapshots, order updates and fills from the broker into a new `BrokerState`, then call every listener with it. Do not mutate a state you already handed out.
- **Report the connection state.** Set `connected: false` when the socket drops, and back to `true` once state is fresh again. Set `tradingEnabled: false` for read-only logins.
- **Map symbols both ways.** Translate the chart symbol to a contract on the way out, and contracts back to chart symbols in orders, positions and fills.
- **Enforce `reduceOnly`.** TPs, SLs and flatten orders carry `reduceOnly: true`. Use the broker's own reduce-only flag if it has one. If not, refuse orders that would open or add to a position.
- **Return results, don't throw.** Turn broker rejections into `{ ok: false, error }` with a message the user can act on.
- **Give `pointValue` for futures and CFDs.** Without it P&L reads in points.
- **Leave out `onMarketPrice`** unless the adapter simulates fills. A real broker fills on its own prices.

The browser holds everything in your page, so keep broker credentials on a server you control and have the adapter talk to it.

This skeleton wraps a connection object that stands in for your broker's SDK or a relay on your server:

```ts
import {
  positionOf,
  type BrokerAdapter,
  type BrokerState,
  type OrderChange,
  type OrderRequest,
  type OrderResult,
} from 'candleframe/trading';

/** Your link to the broker: its SDK, or a relay on your own server. */
export interface BrokerConnection {
  /** Streams account snapshots and connection changes. Returns a function that stops it. */
  watch(
    onSnapshot: (snapshot: Pick<BrokerState, 'accounts' | 'orders' | 'positions' | 'fills'>) => void,
    onConnected: (connected: boolean) => void,
  ): () => void;
  /** Resolves to the broker's order id, or rejects with a reason. */
  submit(order: OrderRequest & { contract: string }): Promise<string>;
  replace(account: string, orderId: string, change: OrderChange): Promise<void>;
  cancel(account: string, orderId: string): Promise<void>;
}

/** Chart symbol to the contract the broker trades, with its money per point. */
const CONTRACTS: Record<string, { contract: string; pointValue: number }> = {
  MNQ: { contract: 'MNQZ6', pointValue: 2 },
};

export function createMyBroker(connection: BrokerConnection): BrokerAdapter {
  const listeners = new Set<(state: BrokerState) => void>();
  let state: BrokerState = {
    connected: false,
    tradingEnabled: true,
    accounts: [],
    orders: [],
    positions: [],
    fills: [],
  };
  let stop: (() => void) | null = null;

  const publish = (change: Partial<BrokerState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener(state);
  };
  const run = async (action: () => Promise<string | void>, orderId?: string): Promise<OrderResult> => {
    try {
      return { ok: true, orderId: (await action()) ?? orderId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const refuse = async (error: string): Promise<OrderResult> => ({ ok: false, error });

  return {
    currency: '$',
    pointValue: symbol => CONTRACTS[symbol]?.pointValue,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      // Connect with the first subscriber and disconnect after the last.
      stop ??= connection.watch(
        snapshot => publish(snapshot),
        connected => publish({ connected }),
      );
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stop?.();
          stop = null;
        }
      };
    },
    placeOrder(order) {
      const contract = CONTRACTS[order.symbol]?.contract;
      if (!contract) return refuse(`${order.symbol} is not tradable on this account.`);
      if (order.reduceOnly) {
        const held = positionOf(state, order.account, order.symbol)?.quantity ?? 0;
        const closes = (held > 0 && order.side === 'sell') || (held < 0 && order.side === 'buy');
        if (!closes || order.quantity > Math.abs(held))
          return refuse('A reduce-only order must close part of the position.');
      }
      return run(() => connection.submit({ ...order, contract }));
    },
    modifyOrder: (account, orderId, change) => run(() => connection.replace(account, orderId, change), orderId),
    cancelOrder: (account, orderId) => run(() => connection.cancel(account, orderId), orderId),
  };
}
```

The snapshots from `watch` must already use chart symbols. Do that mapping where you parse the broker's messages. To try the adapter without a broker, pass a fake `BrokerConnection` whose methods resolve or reject on cue, subscribe, and assert on the states and results you get back. The paper broker's tests in `tests/paper-broker.test.ts` follow the same pattern.

Then attach it like the paper broker:

```ts
import { attachTrading, type BrokerAdapter } from 'candleframe/trading';

declare function createMyBroker(connection: unknown): BrokerAdapter; // from the skeleton above
declare const connection: unknown;

const trading = attachTrading(chart, { broker: createMyBroker(connection), host, confirm: true });
```
