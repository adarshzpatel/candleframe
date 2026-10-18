---
title: Live data over WebSocket
description: Build a live adapter that loads REST history, streams updates over a socket, recovers from drops and keeps an order book.
---

A live adapter loads history over REST, then streams updates over a WebSocket. This page walks through the built-in Binance adapter and the decisions behind it, then builds a compact adapter for a hypothetical exchange that you can adapt to yours. It assumes you have read [Data feeds](../overview/).

## The Binance adapter

`createBinanceFeed` streams public Binance Spot market data with no API key. CandleFrame is not affiliated with or endorsed by Binance. For perpetuals, the [Hyperliquid adapter](../hyperliquid/) makes the same decisions.

```ts
import { createBinanceFeed, BINANCE_INTERVALS } from 'candleframe/binance';
import { createChartWidget } from 'candleframe/widget';

const feed = createBinanceFeed({ symbol: 'ETH/USDT', interval: '5m' });
createChartWidget(host, { feed, orderBook: true });

console.log(BINANCE_INTERVALS); // ['1s', '1m', '3m', ..., '1w']
```

`symbol` is `BTC/USDT` (the default), `ETH/USDT` or `SOL/USDT`. `interval` defaults to `1m` and must be one of `BINANCE_INTERVALS`, the fixed-length kline intervals. Binance's `1M` is a calendar month and is not supported. Anything else throws `UNSUPPORTED_MARKET`.

The second argument replaces the network. Tests pass a fake `fetch` and a fake socket factory:

```ts
import { createBinanceFeed, type BinanceTransport } from 'candleframe/binance';

declare const fakeFetch: typeof fetch;
declare const fakeSocketFactory: BinanceTransport['createSocket'];

const feed = createBinanceFeed({ symbol: 'BTC/USDT', interval: '1m' }, { fetch: fakeFetch, createSocket: fakeSocketFactory });
```

### How it works

The source is in `src/binance-feed.ts`. These are the decisions worth copying.

**A guessed instrument first, the real one later.** The descriptor has to exist before any request, so it starts with a tick size of 0.01. On connect the adapter fetches `exchangeInfo`, reads the real tick size and lot step, and emits an `instrument` event. It keeps the result for later reconnects.

**Subscribe before loading history.** The adapter opens the socket first and requests REST history only once the socket is open. Updates that arrive while the request is in flight go into a buffer of up to 512 events. When history lands, the adapter merges the buffered bars by time and sends one `candles.history`. Loading history first would leave a window where an update could be lost.

**Never roll a bar back.** Binance kline volume only grows within a bar. A REST reply can be newer than socket events received while it was in flight, and socket events can arrive out of order. The adapter drops any update with an older event time or a lower volume than the version it already sent.

**Catch gaps before the runtime does.** If a kline starts more than one interval after the last accepted bar, the adapter reconnects and reloads history instead of sending a bar the runtime would reject with `CANDLE_GAP`. It also drops corrections to bars it never sent, which the runtime would reject with `UNKNOWN_CORRECTION`.

**Report health per stream.** On start, both streams are `loading` with "Connecting to Binance market data". A watchdog runs every second. After 10 seconds without updates, it marks that stream `stale`. After 30 seconds, it reconnects. If history has not loaded within 20 seconds, it reconnects. A failed request marks the failing stream `error` and the other `stale`. A socket error marks both `error`, and a closed socket marks both `stale`. A malformed message on a known stream marks that stream `error` without reconnecting.

**Back off, and respect rate limits.** Reconnect delays double from 1 second up to 30 seconds and reset once both streams are healthy. On HTTP 429 or 418 the adapter reads `Retry-After` (or waits 60 seconds, 5 minutes for 418) and shares that cooldown with every Binance feed using the same `fetch` function.

**One generation per attempt.** Each start bumps a generation counter. Every callback checks it, so a late REST reply or socket message from a previous attempt cannot reach the chart.

**Full snapshots for depth.** The adapter subscribes to Binance's top-20 partial depth stream. Every message is a complete book, so the descriptor declares `depth: { kind: 'snapshots', levels: 20 }` and every message becomes a `depth.snapshot` with `lastUpdateId` as the sequence. `requestSnapshot()` marks depth `stale` and waits for the next message, which is a full book.

**Paging and pausing.** `loadOlder` requests 1,000 klines ending before `beforeMs` and sets `exhausted` when fewer come back. A failed request becomes `candles.prepend` with `error`. `setPaused(true)` closes the socket and aborts requests. `setPaused(false)` starts a new attempt, which reloads history.

## A generic WebSocket adapter

The adapter below targets a made-up exchange. The URLs use the reserved `.example` domain and the message shapes are invented. Replace both with your exchange's.

The hypothetical API:

- `GET https://api.exchange.example/v1/candles?market=BTC-USD&interval=1m&limit=500` returns `{ "candles": [[timeMs, "open", "high", "low", "close", "volume"], ...] }`, oldest first. An optional `before=<ms>` returns bars that start before that time.
- `wss://stream.exchange.example/v1` takes `{ "op": "subscribe", "channels": ["candles:BTC-USD:1m", "book:BTC-USD"] }`.
- Candle messages are `{ "channel": "candles", "data": [timeMs, "o", "h", "l", "c", "v"] }`. The exchange sends the forming bar on every trade.
- Book messages are `{ "channel": "book", "type": "snapshot" | "update", "seq": 101, "prev_seq": 100, "bids": [["99.5", "2"]], "asks": [...] }`. Quantities are absolute, and 0 removes a level. The exchange sends a snapshot after each subscribe, and again on `{ "op": "snapshot", "channel": "book:BTC-USD" }`.

```ts
import {
  intervalToMs,
  type Candle,
  type FeedAdapter,
  type FeedEvent,
  type Interval,
  type Level,
  type Stream,
} from 'candleframe/core';

// Hypothetical exchange: not a real API.
const REST = 'https://api.exchange.example/v1';
const WS = 'wss://stream.exchange.example/v1';
const PAGE = 500;

type Row = [number, string, string, string, string, string];
type Message =
  | { channel: 'candles'; data: Row }
  | { channel: 'book'; type: 'snapshot' | 'update'; seq: number; prev_seq: number; bids: [string, string][]; asks: [string, string][] };

/** Injected in tests; defaults to the browser globals. */
export interface ExampleTransport {
  fetch: typeof fetch;
  createSocket(url: string): WebSocket;
}

const toCandle = ([timeMs, o, h, l, c, v]: Row): Candle => ({
  timeMs, open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v),
});
const toLevels = (rows: [string, string][]): Level[] => rows.map(([p, q]) => [Number(p), Number(q)]);

export function createExampleFeed(
  market: string, // such as 'BTC-USD'
  interval: Interval,
  transport: Partial<ExampleTransport> = {},
): FeedAdapter {
  const intervalMs = intervalToMs(interval);
  const fetcher = transport.fetch ?? globalThis.fetch;
  const createSocket = transport.createSocket ?? ((url: string) => new WebSocket(url));
  const [base, quote] = market.split('-');
  return {
    descriptor: {
      id: 'example-exchange',
      label: 'Example Exchange',
      instrument: {
        symbol: `${base}/${quote}`,
        name: `${base} / ${quote}`,
        base,
        quote,
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 4,
      },
      interval,
      intervalMs,
      simulated: false,
      depth: { kind: 'sequenced', levels: 50 },
    },
    connect(emit) {
      let disposed = false;
      let paused = false;
      let generation = 0;
      let failures = 0;
      let socket: WebSocket | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setInterval> | undefined;

      const send = (event: FeedEvent) => {
        if (!disposed && !paused) emit(event);
      };
      const status = (stream: Stream, state: 'loading' | 'stale' | 'error', message: string) =>
        send({ type: 'stream.status', stream, status: state, message });

      async function get(query: string): Promise<Candle[]> {
        const response = await fetcher(`${REST}/candles?market=${market}&interval=${interval}&${query}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return ((await response.json()) as { candles: Row[] }).candles.map(toCandle);
      }
      function stop() {
        generation++;
        clearTimeout(retry);
        clearInterval(watchdog);
        socket?.close();
        socket = undefined;
      }
      function reconnect(message: string) {
        if (disposed || paused) return;
        stop();
        status('candles', 'stale', message);
        status('depth', 'stale', message);
        retry = setTimeout(start, Math.min(30_000, 1000 * 2 ** failures++));
      }
      function start() {
        stop();
        const run = generation;
        const active = () => !disposed && !paused && run === generation;
        let last: Candle | undefined; // the newest bar sent to the chart
        let buffer: Candle[] | undefined = []; // bars that arrive before history
        let heardAt = Date.now();
        let warned = false;
        status('candles', 'loading', 'Connecting');
        status('depth', 'loading', 'Connecting');

        function live(bar: Candle) {
          if (last && bar.timeMs < last.timeMs) return; // an update for a bar already closed
          if (last && bar.timeMs > last.timeMs + intervalMs) return reconnect('Missed bars; reloading history');
          last = bar;
          send({ type: 'candle', candle: bar });
        }

        const ws = createSocket(WS);
        socket = ws;
        ws.addEventListener('open', async () => {
          if (!active()) return;
          // Subscribe first, then load history, so no update falls between the two.
          ws.send(JSON.stringify({ op: 'subscribe', channels: [`candles:${market}:${interval}`, `book:${market}`] }));
          try {
            const history = await get(`limit=${PAGE}`);
            if (!active()) return;
            last = history.at(-1);
            send({ type: 'candles.history', candles: history });
            for (const bar of buffer!) live(bar);
            buffer = undefined;
            failures = 0;
          } catch (error) {
            if (active()) reconnect(`History failed: ${error}`);
          }
        });
        ws.addEventListener('message', event => {
          if (!active()) return;
          heardAt = Date.now();
          warned = false;
          try {
            const message = JSON.parse(event.data as string) as Message;
            if (message.channel === 'candles') {
              const bar = toCandle(message.data);
              if (buffer) buffer.push(bar);
              else live(bar);
            } else {
              const book = { sequence: message.seq, bids: toLevels(message.bids), asks: toLevels(message.asks) };
              send(
                message.type === 'snapshot'
                  ? { type: 'depth.snapshot', book }
                  : { type: 'depth.delta', book: { ...book, previousSequence: message.prev_seq } },
              );
            }
          } catch (error) {
            status('candles', 'error', `Unreadable message: ${error}`);
          }
        });
        // Browsers fire `close` after `error`, so one listener covers both.
        ws.addEventListener('close', () => {
          if (active()) reconnect('Connection closed; reconnecting');
        });
        watchdog = setInterval(() => {
          if (!active()) return;
          const quiet = Date.now() - heardAt;
          if (quiet > 30_000) reconnect('No updates for 30 s; reconnecting');
          else if (quiet > 10_000 && !warned) {
            warned = true;
            status('candles', 'stale', 'Waiting for updates');
          }
        }, 1000);
      }

      start();
      return {
        setPaused(value) {
          if (disposed || value === paused) return;
          paused = value;
          if (paused) stop();
          else start(); // reloads history: the runtime dropped events while paused
        },
        requestSnapshot() {
          if (socket?.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ op: 'snapshot', channel: `book:${market}` }));
        },
        loadOlder(beforeMs) {
          const run = generation;
          get(`before=${beforeMs}&limit=${PAGE}`).then(
            candles => {
              if (run === generation) send({ type: 'candles.prepend', candles, exhausted: candles.length < PAGE });
            },
            error => {
              if (run === generation) send({ type: 'candles.prepend', candles: [], error: String(error) });
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

### What each part does

**`send` and `generation`.** `send` drops events after `dispose` and while paused. `stop()` bumps `generation`, and every callback checks `active()`. A socket from an earlier attempt can still fire `close` or `message`, and a REST reply can land after a reconnect. None of them reach the chart.

**The bootstrap buffer.** Candle messages that arrive before history go into `buffer`. After `candles.history`, the adapter replays them through `live`. Updates for bars older than the last history bar are dropped. An update for the last bar replaces it, and the next bar appends.

The buffer replays updates in arrival order. If your exchange's REST reply can be newer than buffered updates, compare a version field before replacing a bar. Binance compares event time and cumulative volume.

**Gap handling.** `live` reconnects when a bar starts more than one interval after the last one. The reconnect reloads history, so the chart never sees `CANDLE_GAP`. If your market has sessions or closed periods, declare `gaps: true` and drop this check.

**Status events.** Both streams report `loading` while connecting and `stale` while reconnecting. You never send `live`. The runtime sets it when it accepts data. The watchdog marks candles `stale` after 10 quiet seconds and reconnects after 30. Pick thresholds that fit your market: a thin market may go quiet for longer without anything being wrong.

**Backoff.** Delays double from 1 second up to 30 seconds. `failures` resets once history loads.

**Pausing.** `setPaused(true)` closes the socket. `setPaused(false)` starts over. The widget's Reconnect button does exactly this pair of calls, so a working resume is also the user's manual recovery.

**Paging.** `loadOlder` replies on the same generation it started in. If a reconnect happens mid-request, the reply is dropped. The fresh `candles.history` from the reconnect resets paging to `idle`, so the chart can ask again.

### Choose a depth model

Pick the depth model that matches your source.

| Source sends | Descriptor | Events | `requestSnapshot()` |
| --- | --- | --- | --- |
| A full book in every message | `{ kind: 'snapshots', levels: N }` | `depth.snapshot` only, with an increasing `sequence` | Wait for the next message, or refetch. |
| A snapshot, then incremental changes | `{ kind: 'sequenced', levels: N }` | One `depth.snapshot`, then `depth.delta` | Fetch or request a fresh snapshot. |

Deltas need contiguous sequence numbers. The runtime applies a delta only if `previousSequence` equals the current book's sequence and `sequence` is one more. Many exchanges number updates differently, for example with first and last update ids that span several changes. Map them so that each delta you emit has `sequence = previousSequence + 1`, or renumber them yourself with a counter after you have checked the exchange's own continuity.

When the runtime sees a gap, it marks depth `stale` and calls `requestSnapshot()`. It ignores deltas until a snapshot arrives. If a snapshot or delta breaks a rule (crossed book, negative quantity, more than 2,048 levels per side), depth goes to `error` and the runtime asks for a snapshot too. Candles keep flowing either way. The full rules are in [Order book depth](../overview/#order-book-depth).

Levels must be absolute quantities. If your exchange sends size changes (+2, -1), keep a local book in the adapter, apply the changes, and emit the resulting quantities.

## Test it without a network

Inject a fake `fetch` and a fake socket, then drive the adapter through a `ChartRuntime`. The pattern, with a runnable test, is in [Build a feed with an agent](../../agents/build-a-feed/#verify-headlessly). Cover at least these cases:

- History loads and `streams.candles.status` becomes `live`.
- An update for the forming bar replaces it, and the next bar appends.
- An update that arrives before history is not lost.
- A skipped bar reloads history instead of reporting `CANDLE_GAP`.
- A depth gap leads to `requestSnapshot()` and a snapshot brings depth back to `live`.
- Pause, then resume, reloads history.
- After `dispose()`, the socket is closed and nothing else is emitted.
