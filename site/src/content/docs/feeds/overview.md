---
title: Data feeds
description: The FeedAdapter contract, every feed event, the rules the runtime enforces, and how to switch markets.
---

A feed adapter is the only way data reaches a chart. This page explains what an adapter declares, what it emits, and what the runtime does with each event. At the end you will have a working adapter for a REST API.

You may not need a custom adapter. If you already hold candles in memory, or fetch them yourself, use [`createStaticFeed`](../static-data/). For a live exchange, see [Live data over WebSocket](../live-websocket/). To build bars from trades, see [Tick, range and custom bars](../trade-bars/).

## The contract

An adapter is an object with a `descriptor` and a `connect` method. The runtime calls `connect` once per market, passes an `emit` function, and gets a connection back.

```ts
import type { FeedAdapter } from 'candleframe/core';

const adapter: FeedAdapter = {
  descriptor: {
    id: 'example',
    label: 'Example',
    instrument: {
      symbol: 'ACME',
      name: 'Acme Corp',
      base: 'ACME',
      quote: 'USD',
      tickSize: 0.01,
      pricePrecision: 2,
      quantityPrecision: 0,
    },
    interval: '1m',
    intervalMs: 60_000,
    simulated: false,
    depth: { kind: 'none', levels: 0 },
  },
  connect(emit) {
    emit({
      type: 'candles.history',
      candles: [{ timeMs: 1_767_225_600_000, open: 10, high: 11, low: 9.5, close: 10.5, volume: 1200 }],
    });
    return {
      setPaused() {},
      requestSnapshot() {},
      dispose() {},
    };
  },
};
```

An adapter describes one market at one interval. To show another symbol or interval, the host creates a new adapter and swaps it in. The adapter never changes its own descriptor.

`connect` must return right away. Do network work asynchronously and report it through `emit`. If `connect` throws, the runtime marks both streams as `error` with the thrown message.

## The descriptor

`FeedDescriptor` tells the runtime what the feed will send. The runtime validates it when you construct a `ChartRuntime` (or call `createChart`, `createChartWidget` or `replaceFeed`) and throws a `ChartError` if it is wrong.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | `string` | Non-empty. Identifies the source. Saved in layouts as `feedId`. |
| `label` | `string` | A readable source name, available to hosts in `state().feed`. |
| `instrument` | `Instrument` | See below. |
| `interval` | `Interval` | Such as `1m`, `4h`, `1d`, `500t`, `10r`. See [intervals](../trade-bars/#intervals). |
| `intervalMs` | `number` | Must equal `intervalToMs(interval)`. Tick and range intervals use `TRADE_BAR_SLOT_MS` (1). |
| `simulated` | `boolean` | True for generated data. Without a `markets` entry for the feed, the widget labels it "Simulated". |
| `depth` | `{ kind, levels }` | `{ kind: 'none', levels: 0 }`, or `kind: 'snapshots'` or `'sequenced'` with `levels` from 1 to 2048. |
| `gaps` | `boolean`, optional | True when history may skip intervals. Required for tick and range intervals. |

`Instrument` holds the market metadata:

| Field | Rule |
| --- | --- |
| `symbol`, `name`, `base`, `quote` | Strings of 1 to 127 characters. |
| `tickSize` | Finite and greater than 0. The smallest price step. |
| `pricePrecision` | Integer from 0 to 12. Decimals shown on prices. |
| `quantityPrecision` | Integer from 0 to 12. Decimals shown on volumes. |

A descriptor that breaks these rules throws `INVALID_FEED`, `INVALID_INSTRUMENT` or `UNSUPPORTED_INTERVAL`.

`depth.kind` and `depth.levels` describe the order book for the host. The widget shows "Top 20 levels / side" for `snapshots` and "80 levels / side" for `sequenced`. The runtime applies `depth.snapshot` and `depth.delta` events the same way for both kinds. With `kind: 'none'` it ignores every depth event and reports the depth stream as `unavailable`.

### What `gaps: true` means

Without `gaps`, the runtime expects a bar for every interval. Every candle time must sit on an interval boundary, and each new live bar must start exactly one `intervalMs` after the previous one. A 24-hour crypto market fits this.

Set `gaps: true` for markets with sessions, weekends or holidays, and for tick and range bars. The runtime then:

- accepts any candle time, aligned or not, as long as times strictly ascend;
- accepts a new live bar at any time after the last one;
- collapses the empty periods on the time axis, so a weekend takes no space;
- counts viewport limits in bars instead of milliseconds.

If a gapless market can have intervals with no trades, either fill them with flat bars (open, high, low and close equal to the last close, volume 0) or declare `gaps: true`.

## Connections

`connect(emit)` returns a `FeedConnection`:

| Method | Called when | What the adapter does |
| --- | --- | --- |
| `setPaused(paused)` | The user pauses or resumes, or the widget's Reconnect button runs (pause, then resume). | Pause: stop sockets and timers. Resume: reload history and restart. |
| `requestSnapshot()` | The depth book is stale or failed validation. | Send a fresh `depth.snapshot`. No-op for feeds without depth. |
| `dispose()` | The host replaces the feed or disposes the chart. | Close sockets, abort requests, clear timers. Never emit again. |
| `loadOlder(beforeMs)`, optional | The view nears the first loaded bar, or the host calls `loadOlderHistory()`. | Emit `candles.prepend` with bars ending before `beforeMs`. |

The runtime drops every event while it is paused, so anything sent between `setPaused(true)` and `setPaused(false)` is lost. On resume the runtime sets both streams to `loading` and waits for data. Re-emit `candles.history` on resume. A single `candle` event is only safe if no bar boundary passed while paused, otherwise it fails with `CANDLE_GAP`.

The runtime also ignores events from a connection it has replaced or disposed. That protects the chart, but your adapter should still stop its own work in `dispose`, or it will leak sockets and timers.

## Feed events

`emit` takes a `FeedEvent`. Each event belongs to the `candles` stream or the `depth` stream.

| Event | Stream | Payload | Effect |
| --- | --- | --- | --- |
| `candles.history` | candles | `candles: Candle[]` | Replaces all loaded candles. Sets candles to `live`. Re-enables paging. |
| `candle` | candles | `candle: Candle` | Replaces the loaded bar with the same `timeMs`, or appends a new bar. |
| `candles.prepend` | candles | `candles`, `exhausted?`, `error?` | Adds older bars in reply to `loadOlder`. |
| `instrument` | candles | `instrument: Instrument` | Updates tick size and precision after the feed fetches real metadata. |
| `stream.status` | either | `stream`, `status`, `message?` | Reports `loading`, `stale` or `error` for one stream. |
| `depth.snapshot` | depth | `book: DepthSnapshot` | Replaces the order book. |
| `depth.delta` | depth | `book: DepthDelta` | Applies changes to the order book. |
| `heatmap.history` | depth | `grid`, `columns` | Loads past depth columns for the heatmap layer. |

### Candles

```ts
import type { Candle } from 'candleframe/core';

const bar: Candle = {
  timeMs: 1_767_225_600_000, // UTC milliseconds at the start of the bar
  open: 100.25,
  high: 101,
  low: 99.75,
  close: 100.5,
  volume: 1520,
  buyVolume: 830, // optional: taker buy volume, at most `volume`
};
```

The optional fields `buyVolume`, `footprint`, `deltaRange` and `largeTrades` feed the order-flow indicators and the footprint chart type. [`TradeBarBuilder`](../trade-bars/) fills all of them from trades.

The runtime checks every candle it receives. A candle is valid when:

- `timeMs`, `open`, `high`, `low`, `close` and `volume` are finite numbers;
- `timeMs` is 0 or more;
- `timeMs` is on an interval boundary, unless the feed declares `gaps: true` (weekly bars start on Monday 00:00 UTC);
- `low` is greater than 0 and `volume` is 0 or more;
- `high` is at least `max(open, close)` and `low` is at most `min(open, close)`;
- `buyVolume`, if present, is finite, 0 or more, and not more than `volume`;
- `footprint` and `largeTrades`, if present, are arrays;
- `deltaRange`, if present, is two finite numbers with the first not above the second.

### History

`candles.history` must hold 1 to 100,000 valid candles with strictly ascending times. Otherwise the candles stream fails with `INVALID_HISTORY`. The runtime keeps the newest `maxCandles` (default 10,000). Send history first: a `candle` before any history fails with `MISSING_HISTORY`.

You can send `candles.history` again at any time, for example after a reconnect. It replaces the loaded bars, keeps drawings and indicators, and keeps the user's view unless they are following the latest bar.

### Live updates

A `candle` event either corrects a loaded bar or appends a new one.

| Candle time | Result |
| --- | --- |
| Equals a loaded bar's time | Replaces that bar. This is how the forming bar updates, and how you correct an older bar. |
| After the last bar, by exactly `intervalMs` | Appends a bar. |
| After the last bar by more than `intervalMs`, without `gaps` | Fails with `CANDLE_GAP: reconnect to refresh history`. |
| After the last bar, with `gaps: true` | Appends a bar. |
| Before the last bar and not loaded | Fails with `UNKNOWN_CORRECTION`. |

`CANDLE_GAP` means your adapter missed bars, usually after a dropped connection. Reload history instead of sending the next bar.

### Stream health

Each stream has a `StreamHealth` in `runtime.state().streams`, with a `status`, a `message` and `receivedAtMs` (the last time the stream went live).

| Status | Set by |
| --- | --- |
| `loading` | The runtime at start, after `replaceFeed` and on resume. Feeds send it while connecting. |
| `live` | The runtime, after it accepts data on that stream. Feeds cannot send it. |
| `stale` | Feeds, when updates stop arriving. The runtime, on a depth sequence gap. |
| `error` | Feeds, for failures. The runtime, when an event breaks a rule. |
| `paused` | The runtime, while paused. |
| `unavailable` | The runtime, for the depth stream of a feed with `depth.kind: 'none'`. |

```ts
import type { FeedEvent } from 'candleframe/core';

const reconnecting: FeedEvent = {
  type: 'stream.status',
  stream: 'candles',
  status: 'stale',
  message: 'Connection lost; reconnecting',
};
```

A rejected event never throws into your adapter. The runtime sets that stream to `error` with a message that starts with the error code, such as `CANDLE_GAP: reconnect to refresh history`. `state().error` joins the messages of all failed streams. The next accepted event on the stream sets it back to `live`. The widget shows a notice with the message for any stream that is `stale` or `error`, with a Reconnect button.

### Order book depth

Levels are `[price, quantity]` pairs with absolute quantities. A quantity of 0 removes the level.

```ts
import type { DepthDelta, DepthSnapshot } from 'candleframe/core';

const snapshot: DepthSnapshot = {
  sequence: 100,
  bids: [[99.5, 4], [99.25, 10]],
  asks: [[100, 3], [100.25, 8]],
};
const delta: DepthDelta = {
  sequence: 101,
  previousSequence: 100,
  bids: [[99.5, 0]], // removes 99.5
  asks: [[100, 5]], // sets 100 to 5
};
```

The runtime's `OrderBook` enforces these rules:

- Prices are unique within a side and positive. Quantities are 0 or more. Otherwise `INVALID_DEPTH`.
- Sequences are non-negative safe integers. Otherwise `INVALID_SEQUENCE`.
- Each side holds at most 2,048 levels. Otherwise `DEPTH_LIMIT`.
- The best bid must be below the best ask. Otherwise `CROSSED_BOOK`.
- A snapshot with a lower sequence than the current book is ignored.
- A delta applies only when `previousSequence` equals the current sequence and `sequence` is one more. A delta at or below the current sequence is ignored as a duplicate.
- Any other delta is a gap. The runtime marks depth `stale` with "Depth sequence gap. Requesting a snapshot." and calls `requestSnapshot()`. Deltas stay blocked until a snapshot arrives.

When a depth event fails validation, the runtime sets depth to `error` and also calls `requestSnapshot()`. Depth problems never touch the candles stream.

A feed whose source sends full books every time (like Binance partial depth) only needs `depth.snapshot` with an increasing sequence. A feed with an incremental source sends one snapshot, then deltas.

### Heatmap

`heatmap.history` loads past order book columns for the heatmap layer. The runtime ignores it unless it was created with `heatmap: true`. Each column is a `Float32Array` with one quantity per price row of the grid. The grid needs 1 to 1,024 rows, a finite `minPrice`, and a positive `binSize` and `intervalMs`, or the depth stream fails with `INVALID_HEATMAP_GRID`. After history loads, the runtime adds a column from the live book on each depth update.

### Instrument updates

A feed can start with a guessed instrument and correct it once it fetches real metadata. The `instrument` event replaces tick size, precision and name. The `symbol`, `base` and `quote` must match the descriptor, otherwise the candles stream fails with `INSTRUMENT_MISMATCH`.

## History paging

Implement `loadOlder(beforeMs)` to let users pan back past the first loaded bar. The runtime calls it with the first loaded bar's time. Reply with `candles.prepend`:

- `candles`: valid bars in ascending order, all before `beforeMs`.
- `exhausted: true` when no older data exists. The runtime stops asking.
- `error: 'message'` when the request failed. The live stream is unaffected and the user can retry.

The runtime tracks paging in `state().olderHistory`:

| Status | Meaning |
| --- | --- |
| `unavailable` | The connection has no `loadOlder`. |
| `idle` | Ready for a request. |
| `loading` | A request is pending. The runtime sends one at a time. |
| `exhausted` | The feed sent `exhausted: true`, or the runtime reached `maxCandles` (message "Reached maxCandles"). |
| `error` | The feed sent `error`, or the bars overlapped or broke a rule (message "INVALID_HISTORY: older candles overlap or are invalid"). |

The chart calls `loadOlderHistory()` when the view comes within 50 bars of the first loaded bar. Hosts and agents can call `runtime.loadOlderHistory()` or `chart.loadOlderHistory()` directly. It returns `false` when no request was sent: no candles yet, paused, no `loadOlder`, a request pending, history exhausted, or `maxCandles` reached.

The runtime ignores a `candles.prepend` it did not ask for. If you send an empty page without `exhausted`, paging returns to `idle` and the chart asks again. Send `exhausted: true` when there is nothing older.

## Switching markets

The descriptor is fixed for the life of an adapter. To switch symbol, interval or source, create a new adapter and pass it to `replaceFeed`:

```ts
import { createSimulatedFeed } from 'candleframe/core';

chart.replaceFeed(createSimulatedFeed({ symbol: 'ETH/USD', interval: '5m' }));
```

`replaceFeed` validates the new descriptor before it changes anything, so a bad adapter leaves the old market running. Then it disposes the old connection, clears candles and the order book, and connects the new adapter. Indicators, layers, the chart type and the log scale setting carry over. If the new feed has the same `id` and `instrument.symbol` (an interval switch), drawings and undo history carry over too. Otherwise they reset.

In the widget, list your markets with the `markets` option. Each source has a `createFeed` factory that returns a new, unconnected adapter for a selection:

```ts
import { createSimulatedFeed } from 'candleframe/core';
import { createChartWidget, type WidgetMarketSource } from 'candleframe/widget';

const markets: WidgetMarketSource[] = [
  {
    id: 'simulated',
    label: 'Simulation',
    symbols: ['BTC/USD', 'ETH/USD'],
    intervals: ['1m', '5m', '1h'],
    createFeed: ({ symbol, interval }) =>
      createSimulatedFeed({ symbol: symbol as 'BTC/USD' | 'ETH/USD', interval }),
  },
];

createChartWidget(host, { feed: markets[0].createFeed({ symbol: 'BTC/USD', interval: '1m' }), markets });
```

The widget checks each adapter a factory returns. Its `descriptor.id` must equal the source `id`, and its symbol, interval and `intervalMs` must match the selection. Otherwise the switch fails with `MARKET_FEED_MISMATCH` and the previous market stays. Add `customIntervals` to let users type their own intervals, as described in [Tick, range and custom bars](../trade-bars/#custom-intervals-in-the-widget).

## A complete adapter

This adapter reads a hypothetical REST API that returns rows of `[timeMs, open, high, low, close, volume]`, oldest first. It loads history, polls for updates every 5 seconds, pages older bars, reports errors, and handles pause and dispose.

```ts
import { intervalToMs, type Candle, type FeedAdapter, type FeedEvent, type Interval } from 'candleframe/core';

// Hypothetical endpoint:
// GET /candles?symbol=ACME&interval=1m&limit=500[&endTime=ms] -> [[timeMs, o, h, l, c, v], ...]
const API = 'https://api.example.com';
const PAGE = 500;
type Row = [number, number, number, number, number, number];

export function createPollingFeed(symbol: string, interval: Interval): FeedAdapter {
  const intervalMs = intervalToMs(interval);
  return {
    descriptor: {
      id: 'example-rest',
      label: 'Example REST',
      instrument: {
        symbol,
        name: symbol,
        base: symbol,
        quote: 'USD',
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 0,
      },
      interval,
      intervalMs,
      simulated: false,
      depth: { kind: 'none', levels: 0 },
    },
    connect(emit) {
      let disposed = false;
      let paused = false;
      // Bumped on every restart, so replies from an older run are dropped.
      let generation = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastTime = -1;

      const send = (event: FeedEvent) => {
        if (!disposed && !paused) emit(event);
      };
      const active = (run: number) => !disposed && !paused && run === generation;
      async function get(query: string): Promise<Candle[]> {
        const url = `${API}/candles?symbol=${symbol}&interval=${interval}&${query}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = (await response.json()) as Row[];
        return rows.map(([timeMs, open, high, low, close, volume]) => ({
          timeMs, open, high, low, close, volume,
        }));
      }
      function stop() {
        generation++;
        clearTimeout(timer);
      }
      async function start() {
        stop();
        const run = generation;
        send({ type: 'stream.status', stream: 'candles', status: 'loading', message: 'Loading history' });
        try {
          const candles = await get(`limit=${PAGE}`);
          if (!active(run)) return;
          lastTime = candles.at(-1)!.timeMs;
          send({ type: 'candles.history', candles });
          timer = setTimeout(poll, 5000, run);
        } catch (error) {
          if (!active(run)) return;
          send({ type: 'stream.status', stream: 'candles', status: 'error', message: String(error) });
          timer = setTimeout(start, 10_000);
        }
      }
      async function poll(run: number) {
        try {
          const candles = await get('limit=3');
          if (!active(run)) return;
          // The oldest returned bar is newer than the last one we have: bars were missed.
          if (candles[0].timeMs > lastTime) return void start();
          for (const candle of candles) {
            if (candle.timeMs < lastTime) continue;
            send({ type: 'candle', candle });
            lastTime = candle.timeMs;
          }
        } catch (error) {
          if (!active(run)) return;
          send({ type: 'stream.status', stream: 'candles', status: 'stale', message: String(error) });
        }
        timer = setTimeout(poll, 5000, run);
      }

      void start();
      return {
        setPaused(value) {
          if (disposed || value === paused) return;
          paused = value;
          if (paused) stop();
          else void start();
        },
        requestSnapshot() {},
        loadOlder(beforeMs) {
          const run = generation;
          get(`endTime=${beforeMs - 1}&limit=${PAGE}`).then(
            candles => {
              if (active(run)) send({ type: 'candles.prepend', candles, exhausted: candles.length < PAGE });
            },
            error => {
              if (active(run)) send({ type: 'candles.prepend', candles: [], error: String(error) });
            },
          );
        },
        dispose() {
          disposed = true;
          stop();
        },
      };
    },
  };
}
```

A few choices in this adapter apply to any feed:

- `send` checks `disposed` and `paused`, so nothing reaches the runtime after `dispose()`.
- `generation` changes on every restart. A reply that arrives after a pause, restart or dispose is dropped instead of mixing old and new data.
- The poll re-sends the forming bar on every tick. The runtime replaces it in place.
- When the poll finds a gap, the adapter reloads history instead of sending a bar that would fail with `CANDLE_GAP`.
- Resume reloads history, because the runtime dropped everything while paused.
- `loadOlder` reports failures through `error` instead of breaking the live stream.

To use it, pass it as the `feed` of `createChart`, `createChartWidget` or `new ChartRuntime`. To test it without a browser, see the headless pattern in [Build a feed with an agent](../../agents/build-a-feed/#verify-headlessly).
