---
title: Tick, range and custom bars
description: Build time, tick, range and momentum bars from a trade stream with TradeBarBuilder, and let users type their own intervals.
---

Exchanges often send trades, not candles. `TradeBarBuilder` turns a trade stream into candles, with the order-flow fields that the footprint chart and the order-flow indicators read. This page covers the interval formats, the builder, a feed built on it, and custom intervals in the widget.

```ts
import { TradeBarBuilder, parseInterval } from 'candleframe/core';

const bars = new TradeBarBuilder(parseInterval('500t'), 0.25);
const result = bars.add({ timeMs: Date.now(), price: 21_450.25, size: 2, side: 'buy' });
console.log(result?.candle, result?.opened);
```

## Intervals

An `Interval` is a count followed by a unit.

| Unit | Example | Bar |
| --- | --- | --- |
| `s`, `m`, `h`, `d`, `w` | `30s`, `5m`, `4h`, `1d`, `1w` | Fixed length of time. Count from 1 to 9,999. |
| `t` | `500t` | Closes after 500 trades, whatever their size. |
| `r` | `10r` | Spans at most 10 price increments (tick sizes) from low to high. |
| `mr` | `10mr` | Momentum range. Closes exactly 10 increments from its open, up or down. |

Tick and range counts go from 1 to 999,999. Calendar months are not supported, because they have no fixed length.

Time bars start on multiples of the interval from the Unix epoch. Weekly bars are the exception, and start on Monday 00:00 UTC, as on most exchanges.

### Interval helpers

All of these come from `candleframe/core`:

| Function | Returns |
| --- | --- |
| `parseInterval(interval)` | `{ kind: 'time', ms }`, `{ kind: 'tick', count }`, `{ kind: 'range', ticks }` or `{ kind: 'momentum', ticks }`. Throws `UNSUPPORTED_INTERVAL` for anything else. |
| `intervalToMs(interval)` | The length in milliseconds. Tick and range intervals return `TRADE_BAR_SLOT_MS`. Throws `UNSUPPORTED_INTERVAL`. |
| `isInterval(value)` | `true` if `value` parses. |
| `isTimeInterval(value)` | `true` for time intervals. `false` for tick, range, momentum and invalid values. |
| `intervalLabel(interval)` | Picker text. `500t` reads "500 ticks", `10r` "10 range", `10mr` "10 momentum". Time intervals stay as they are. |
| `alignTime(timeMs, intervalMs)` | The start of the time bar that contains `timeMs`. |

```ts
import { intervalLabel, intervalToMs, isTimeInterval, parseInterval } from 'candleframe/core';

parseInterval('4h'); // { kind: 'time', ms: 14400000 }
parseInterval('10mr'); // { kind: 'momentum', ticks: 10 }
intervalToMs('500t'); // 1
isTimeInterval('10r'); // false
intervalLabel('700t'); // '700 ticks'
```

`parseIntervalInput` and `supportsInterval` come from `candleframe` and `candleframe/widget`. `parseIntervalInput` reads what a user typed and returns an interval or `null`:

```ts
import { parseIntervalInput } from 'candleframe/widget';

parseIntervalInput('3 min'); // '3m'
parseIntervalInput('700 ticks'); // '700t'
parseIntervalInput('15 range'); // '15r'
parseIntervalInput('12 momentum'); // '12mr'
parseIntervalInput('1 month'); // null
```

It reads units in lowercase, so `1M` means one minute, not one month.

## Rules for tick and range feeds

Tick, range and momentum bars start at irregular times. A feed that uses them must:

- declare `gaps: true`, or the runtime throws `INVALID_FEED` with "tick and range intervals need gaps: true";
- set `intervalMs` to `intervalToMs(interval)`, which is `TRADE_BAR_SLOT_MS` (1 millisecond);
- give every bar a whole-millisecond `timeMs` later than the previous bar's.

`TRADE_BAR_SLOT_MS` is the nominal width of one of these bars. The time axis spaces them by bar count, not by time. Labels follow the average duration of the visible bars.

## TradeBarBuilder

```ts
import { TradeBarBuilder, parseInterval, type Trade } from 'candleframe/core';

const builder = new TradeBarBuilder(parseInterval('10r'), 0.25, { largeTradeMin: 20 });

const trade: Trade = {
  timeMs: 1_767_225_600_123, // UTC milliseconds
  price: 21_450.25,
  size: 3,
  side: 'buy', // the aggressor: 'buy' lifted the offer, 'sell' hit the bid
  orderId: 'A17', // optional: the aggressive order, used to merge its fills
};
const result = builder.add(trade);
```

The constructor takes:

- `rule`, the output of `parseInterval`;
- `tickSize`, the instrument's price increment, which must be greater than 0 or it throws a `RangeError`;
- `options.largeTradeMin`, the smallest merged print kept in `largeTrades` (default 0, which keeps none).

`add(trade)` returns `{ candle, opened, changed }`, or `null` when the trade has no bar:

- `candle` is the bar the trade landed in.
- `opened` is `true` when the trade started a new bar.
- `changed` lists every bar the trade touched, oldest first. It is one bar, except for momentum bars, where it starts with each bar the trade completed.

`builder.candles` returns every bar built so far, oldest first. The last one may still be forming.

### How each kind closes

**Time bars** start at `floor(timeMs / ms) * ms`. A late trade updates the bar it belongs to without moving that bar's close. A trade older than the first bar returns `null`, and so does a trade for an empty interval behind the latest bar.

**Tick bars** close after `count` trades. The next trade opens a new bar.

**Range bars** close when the next trade would stretch the bar beyond `ticks` increments from low to high. That trade opens the next bar. With a 0.25 tick and `4r`, a bar from 99.75 to 100.75 is full, and a trade at 99.5 starts a new one.

**Momentum bars** close at exactly `open ± ticks × tickSize`, and the next bar opens at that close. Bodies are equal and there are no gaps between bars. A jump of several ranges fills in the bars between, which is why `changed` can hold more than one bar.

Tick, range and momentum bars take the time of their first trade, rounded down to the millisecond. When two bars would start in the same millisecond, the later one moves forward by 1 ms, so times always ascend.

:::caution
Time bars from the builder start on multiples of the interval from the epoch. For `1w` that is a Thursday, while the runtime expects weekly bars to start on Monday. A `1w` feed without `gaps: true` rejects them. Use the builder for intraday and daily bars.
:::

### Order-flow fields

Every bar the builder makes carries:

| Field | Content |
| --- | --- |
| `buyVolume` | Volume from trades with `side: 'buy'`. |
| `footprint` | `[price, buyVolume, sellVolume]` per price increment, ascending by price. |
| `deltaRange` | Lowest and highest running buy-minus-sell volume inside the bar, measured from its open, so it always includes 0. |
| `largeTrades` | With `largeTradeMin` set: `[price, size, side, timeMs]` for each merged print of at least that size. |

Fills of one aggressive order merge into one print by `orderId`. Without ids, consecutive fills with the same side and time merge. The print's price is the volume-weighted average, rounded to the tick.

The [footprint chart type](../../reference/chart-types/), `cvd()`, `volumeProfile()`, `priceDelta()`, `bigTrades()` and `absorptionAggression()` read these fields.

## A feed built from trades

This adapter takes any trade source, so it works with a WebSocket, a replay file or a test. It declares `gaps: true` for every interval. Tick and range bars need it, and time bars built from trades skip intervals with no trades.

```ts
import {
  TradeBarBuilder,
  intervalToMs,
  parseInterval,
  type FeedAdapter,
  type FeedEvent,
  type Instrument,
  type Interval,
  type Trade,
} from 'candleframe/core';

export interface TradeSource {
  /** Recent trades, oldest first, to seed the first bars. */
  recent(): Promise<Trade[]>;
  /** Calls `onTrade` for every new trade. Returns a function that unsubscribes. */
  subscribe(onTrade: (trade: Trade) => void): () => void;
}

export function createTradeBarFeed(instrument: Instrument, interval: Interval, source: TradeSource): FeedAdapter {
  return {
    descriptor: {
      id: 'trades',
      label: 'Trades',
      instrument,
      interval,
      intervalMs: intervalToMs(interval),
      simulated: false,
      gaps: true,
      depth: { kind: 'none', levels: 0 },
    },
    connect(emit) {
      let disposed = false;
      let paused = false;
      let generation = 0;
      let unsubscribe: (() => void) | undefined;
      const send = (event: FeedEvent) => {
        if (!disposed && !paused) emit(event);
      };
      function stop() {
        generation++;
        unsubscribe?.();
        unsubscribe = undefined;
      }
      function start() {
        stop();
        const run = generation;
        // A fresh builder per start: it keeps every bar it has built.
        const builder = new TradeBarBuilder(parseInterval(interval), instrument.tickSize, { largeTradeMin: 10 });
        let queue: Trade[] | undefined = [];
        let started = false;

        function apply(trade: Trade) {
          const result = builder.add(trade);
          if (!result) return;
          if (!started) {
            started = true;
            send({ type: 'candles.history', candles: builder.candles });
          } else for (const candle of result.changed) send({ type: 'candle', candle });
        }

        send({ type: 'stream.status', stream: 'candles', status: 'loading', message: 'Loading trades' });
        // Subscribe first and queue, so no trade falls between the snapshot and the stream.
        unsubscribe = source.subscribe(trade => {
          if (run !== generation) return;
          if (queue) queue.push(trade);
          else apply(trade);
        });
        source.recent().then(
          trades => {
            if (run !== generation) return;
            for (const trade of trades) builder.add(trade);
            if (builder.candles.length) {
              started = true;
              send({ type: 'candles.history', candles: builder.candles });
            }
            // Skip queued trades the snapshot already had. Compare trade ids if your source has them.
            const lastMs = trades.at(-1)?.timeMs ?? -Infinity;
            for (const trade of queue!) if (trade.timeMs > lastMs) apply(trade);
            queue = undefined;
          },
          error => {
            if (run === generation)
              send({ type: 'stream.status', stream: 'candles', status: 'error', message: String(error) });
          },
        );
      }

      start();
      return {
        setPaused(value) {
          if (disposed || value === paused) return;
          paused = value;
          if (paused) stop();
          else start();
        },
        requestSnapshot() {},
        dispose() {
          disposed = true;
          stop();
        },
      };
    },
  };
}
```

How it maps the builder to feed events:

- The first bars go out as `candles.history`. If the source has no recent trades, history goes out with the first live trade, because a `candle` before history fails with `MISSING_HISTORY`.
- After that, each bar in `changed` goes out as a `candle`. The runtime replaces bars it already has and appends new ones. For momentum bars this sends the completed bar with its final close, then the new bar.
- `null` from `add` means the trade had no bar, so nothing is sent.
- Resume and the widget's Reconnect button call `start()` again, which rebuilds from recent trades.

The feed has no `loadOlder`, so the chart shows only bars built since `recent()`. To page further back, fetch older trades in `loadOlder`, build them with a separate builder, and reply with `candles.prepend`. The bars must end before the first loaded bar.

## Custom intervals in the widget

A widget market source lists its intervals. Add `customIntervals` to let users type any length of the kinds you can build:

```ts
import type { Instrument, Interval } from 'candleframe/core';
import { createChartWidget, type WidgetMarketSource } from 'candleframe/widget';
import type { FeedAdapter } from 'candleframe/core';

declare function createTradeBarFeed(instrument: Instrument, interval: Interval, source: unknown): FeedAdapter;
declare function instrumentFor(symbol: string): Instrument;
declare function tradesFor(symbol: string): unknown;

const trades: WidgetMarketSource = {
  id: 'trades', // must equal the feed's descriptor.id
  label: 'Trades',
  symbols: ['MNQ', 'MES'],
  intervals: ['1m', '5m', '500t', '1000t', '10r', '10mr'],
  customIntervals: ['time', 'tick', 'range', 'momentum'],
  createFeed: ({ symbol, interval }) => createTradeBarFeed(instrumentFor(symbol), interval, tradesFor(symbol)),
};

createChartWidget(host, {
  feed: trades.createFeed({ symbol: 'MNQ', interval: '500t' }),
  markets: [trades],
  storageKey: 'my-app',
});
```

With `customIntervals`, the interval picker accepts typed entries such as `3m`, `90s`, `700 ticks`, `15 range` or `12mr`. It offers `Use "700 ticks"`, then switches the chart. The picker groups intervals under Time, Ticks, Range and Momentum headings. It remembers the last 12 typed intervals per source and lists them with a Custom hint. With a `storageKey` they survive reloads, and without one they last for the session.

`supportsInterval(source, interval)` gives the same answer the widget uses. It returns `true` for a listed interval, or for a valid interval whose kind is in `customIntervals`:

```ts
import { supportsInterval, type WidgetMarketSource } from 'candleframe/widget';

declare const trades: WidgetMarketSource;

supportsInterval(trades, '700t'); // true when customIntervals includes 'tick'
```

The widget calls `createFeed` with whatever interval the user picked, so the factory must handle every length of every kind it declares. The feed it returns must report that exact `interval` and `intervalMs`, or the switch fails with `MARKET_FEED_MISMATCH`.
