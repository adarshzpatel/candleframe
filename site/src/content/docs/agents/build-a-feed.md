---
title: Build a feed with an agent
description: A precise brief for an AI coding agent that implements a CandleFrame FeedAdapter for a new exchange or API, with the invariants, a test pattern and a prompt.
---

This page is written for an AI coding agent that has to connect CandleFrame to a new exchange or data API, and for the person directing it. Follow it in order. Each step ends with a check you can run. The contract itself is explained in [Data feeds](../../feeds/overview/). This page is the build procedure.

## What you are building

A function that returns a `FeedAdapter` for one symbol at one interval:

```ts
import type { FeedAdapter, Interval } from 'candleframe/core';

export declare function createAcmeFeed(symbol: string, interval: Interval): FeedAdapter;
```

The function must return synchronously and must not open connections. Network work starts in `connect(emit)`. Accept an optional transport argument (`fetch` and a socket factory) so tests can replace the network, as `createBinanceFeed(options, transport)` does.

Read these files before writing code:

- `src/types.ts`: `FeedAdapter`, `FeedConnection`, `FeedDescriptor`, `FeedEvent`, `Candle`, `Instrument`.
- `src/runtime.ts`: `validateDescriptor`, `validCandle` and the `receive` method. These are the rules your events must pass.
- `src/binance-feed.ts`: a complete live adapter with REST history, a socket and reconnects.
- `src/static-feed.ts`: a minimal adapter with paging.

## Gather this first

Do not write code until you have an answer for each row. Ask the human for anything the API docs do not settle.

| Topic | What you need |
| --- | --- |
| Endpoints | REST URL for candles with its parameters and maximum page size. The parameter for "bars before this time". WebSocket URL, subscribe message, and any ping or heartbeat the server needs. Rate limits and how the server reports them. Whether market data needs authentication. |
| Symbol mapping | The exchange's symbol (`BTCUSDT`, `BTC-USD`) for each chart symbol (`BTC/USDT`). The base and quote assets. |
| Interval mapping | The exchange's code for each `Interval` (`1m`, `1h`, `1d`). Drop calendar months: CandleFrame has no month interval. List intervals the exchange lacks. You can build those from trades with `TradeBarBuilder` or leave them out. |
| Tick size and precision | The metadata endpoint and field for the price increment (`tickSize`), price decimals (`pricePrecision`) and quantity decimals (`quantityPrecision`). Both precisions are integers from 0 to 12. |
| Timestamps | The unit and meaning of candle times. CandleFrame needs UTC milliseconds at the bar's open. Convert seconds (multiply by 1000) and ISO strings (`Date.parse`). If the exchange stamps bars at their close, subtract the interval. |
| Alignment and sessions | Whether every interval has a bar. A 24-hour market that always prints a bar fits `gaps: false`. Markets with sessions, weekends, holidays, or minutes with no trades and no bar need `gaps: true`. |
| Corrections | Whether the exchange revises closed bars, and how you can tell a newer version of a bar from an older one (an event time, a sequence, a cumulative volume). |
| Live updates | Whether the socket sends candles or only trades. Whether it sends the forming bar on every trade or only closed bars. |

## Build in this order

Finish each step and run its check before starting the next.

### 1. Descriptor

Return a `FeedAdapter` whose `connect` returns a connection with no-op methods. Fill the descriptor:

- `id`: a stable source id, such as `'acme'`. In widget `markets` it must equal the source `id`.
- `label`: a readable name.
- `instrument`: `symbol` in the chart's form (`BTC/USDT`), `name`, `base`, `quote`, `tickSize`, `pricePrecision`, `quantityPrecision`. Use your best known values. Step 3 can correct them with an `instrument` event.
- `interval` and `intervalMs`: `intervalMs` must be exactly `intervalToMs(interval)`.
- `simulated: false`.
- `gaps`: from the table above.

Check: `new ChartRuntime(createAcmeFeed('BTC/USDT', '1m'))` does not throw.

### 2. History

In `connect`, fetch the newest page of candles, convert them, and emit one `candles.history`. Sort ascending and remove duplicate times before you emit.

Check: after `runtime.start()` and the request, `runtime.inspect()` shows `candleCount > 0`, `stream.status === 'live'` and `error === null`.

### 3. Live candles

Subscribe to the socket. Open it before you request history and buffer updates that arrive first, then replay them after `candles.history`. Emit each update as `{ type: 'candle', candle }`.

- An update for the forming bar has the same `timeMs` as the last bar. The runtime replaces it.
- The next bar has `timeMs` equal to the last bar's plus `intervalMs` (without gaps). The runtime appends it.
- Drop updates older than the last bar you sent, unless they correct a bar you know is loaded.
- If an update starts more than one interval after the last bar on a feed without gaps, you missed bars. Reload history instead of emitting it.
- If the exchange can send an older version of a bar after a newer one, compare versions and drop the older one.
- If you fetched real instrument metadata, emit `{ type: 'instrument', instrument }`. Keep `symbol`, `base` and `quote` identical to the descriptor.

Check: an update with the last bar's time changes `latestCandle` without changing `candleCount`. An update one interval later increments `candleCount`. `error` stays `null`.

### 4. Status, reconnects, pause and dispose

- Emit `stream.status` with `loading` while connecting, `stale` while updates are late or the socket is reconnecting, and `error` for failures. Never emit `live`. The runtime sets it when it accepts data.
- Reconnect with a growing delay after a socket close or a failed request. Reload history on every reconnect.
- Keep a generation counter. Bump it whenever you stop. Check it in every async callback and drop results from an older generation.
- `setPaused(true)`: close the socket, clear timers, abort requests. `setPaused(false)`: start again and reload history. The runtime drops every event while paused, and the widget's Reconnect button calls `setPaused(true)` then `setPaused(false)`.
- `dispose()`: close everything and never call `emit` again.

Check: pause closes the socket. Resume opens a new one and the stream returns to `live`. After `dispose()`, no request or emit happens.

### 5. History paging

Add `loadOlder(beforeMs)`. Fetch bars that end before `beforeMs` and emit `{ type: 'candles.prepend', candles, exhausted }`. Set `exhausted: true` when the page is shorter than the page size, or when the API has nothing older. On failure emit `{ type: 'candles.prepend', candles: [], error: message }`.

Check: `runtime.loadOlderHistory()` returns `true`, then `candleCount` grows and `olderHistory.status` is `idle` or `exhausted`.

## Invariants the runtime checks

Descriptor errors throw a `ChartError` from `new ChartRuntime`, `createChart`, `createChartWidget` and `replaceFeed`:

| Code | Cause |
| --- | --- |
| `UNSUPPORTED_INTERVAL` | `interval` does not parse. Valid forms are 1 to 9,999 of `s`, `m`, `h`, `d`, `w`, or 1 to 999,999 of `t`, `r`, `mr`. |
| `INVALID_FEED` | `intervalMs !== intervalToMs(interval)`. A tick, range or momentum interval without `gaps: true`. Empty `id`. Non-string `label`. Non-boolean `simulated` or `gaps`. |
| `INVALID_INSTRUMENT` | `symbol`, `name`, `base` or `quote` is not a string of 1 to 127 characters. `tickSize` is not finite and positive. A precision is not an integer from 0 to 12. |

Event errors do not throw into your adapter. The runtime sets the stream's status to `error`, with a message that starts with the code. Read it from `runtime.state().stream.message` and from `runtime.state().error`. The next accepted event sets it back to `live`.

| Code | Cause |
| --- | --- |
| `INVALID_HISTORY` | `candles.history` is empty, holds more than 100,000 bars, holds an invalid bar, or times do not strictly ascend. |
| `INVALID_CANDLE` | A `candle` fails the candle rules below. |
| `MISSING_HISTORY` | A `candle` arrived before any `candles.history`. |
| `UNKNOWN_CORRECTION` | A `candle` is older than the last bar and its time is not loaded. |
| `CANDLE_GAP` | Without `gaps`, a new `candle` does not start exactly `intervalMs` after the last bar. Message: `CANDLE_GAP: reconnect to refresh history`. |
| `INVALID_INSTRUMENT` | An `instrument` event breaks the instrument rules. |
| `INSTRUMENT_MISMATCH` | An `instrument` event changes `symbol`, `base` or `quote`. |

Some events are dropped without an error:

- A `candles.prepend` the runtime did not request.
- Every event while paused, and every event from a replaced or disposed connection.

A bad `candles.prepend` does not touch the stream status. It sets `olderHistory` to `{ status: 'error', message: 'INVALID_HISTORY: older candles overlap or are invalid' }`. The bars must be valid, ascending, and end before the first loaded bar.

A candle is valid when all of these hold:

- `timeMs`, `open`, `high`, `low`, `close`, `volume` are finite numbers, and `timeMs >= 0`.
- Without `gaps`, `timeMs` is a multiple of `intervalMs` from the epoch. Weekly bars are multiples of a week from Monday 1970-01-05.
- `low > 0` and `volume >= 0`.
- `high >= max(open, close)` and `low <= min(open, close)`.
- `buyVolume`, if set, is finite, at least 0 and at most `volume`.
- `footprint` and `largeTrades`, if set, are arrays.
- `deltaRange`, if set, is `[low, high]`, both finite, `low <= high`.

## Verify headlessly

`ChartRuntime` runs in Node with no DOM or GPU. Test your adapter through it with a fake network, so the test checks the same rules the chart applies.

The test below runs against the built-in Binance adapter. To test yours, replace the import, the factory call and the payload helpers in section 2 with your exchange's format. Keep the assertions.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartRuntime } from 'candleframe/core';
import { createBinanceFeed } from 'candleframe/binance';

// 1. A socket the test drives by hand.
class FakeSocket extends EventTarget {
  url: string;
  readyState = 0;
  sent: string[] = [];
  constructor(url: string) {
    super();
    this.url = url;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

// 2. Wire payloads in the exchange's own format. Replace these with yours.
const T0 = Date.UTC(2026, 0, 1); // on a minute boundary
const MINUTE = 60_000;
const metadata = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.10000000' },
        { filterType: 'LOT_SIZE', stepSize: '0.00010000' },
      ],
    },
  ],
};
const row = (i: number, volume = 10) => [T0 + i * MINUTE, '100', '110', '90', '105', String(volume)];
const kline = (i: number, volume: number) => ({
  stream: 'btcusdt@kline_1m',
  data: {
    e: 'kline',
    E: T0 + i * MINUTE + 30_000,
    s: 'BTCUSDT',
    k: { t: T0 + i * MINUTE, T: T0 + i * MINUTE + 59_999, s: 'BTCUSDT', i: '1m', o: '100', h: '110', l: '90', c: '105', v: String(volume) },
  },
});

// 3. A fake network: answers REST by path and records every request.
const requests: string[] = [];
const sockets: FakeSocket[] = [];
const fakeFetch: typeof fetch = async input => {
  const url = String(input);
  requests.push(url);
  const body = url.includes('exchangeInfo') ? metadata : [row(0), row(1), row(2)];
  return new Response(JSON.stringify(body));
};
const createSocket = (url: string) => {
  const socket = new FakeSocket(url);
  sockets.push(socket);
  return socket;
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
};

test('the feed satisfies the runtime contract', async t => {
  // Constructing the runtime validates the descriptor.
  const runtime = new ChartRuntime(createBinanceFeed({ symbol: 'BTC/USDT', interval: '1m' }, { fetch: fakeFetch, createSocket }));
  t.after(() => runtime.dispose());
  runtime.start();
  assert.equal(runtime.state().stream.status, 'loading');

  // History.
  await settle();
  sockets[0].open();
  await settle();
  let state = runtime.inspect();
  assert.equal(state.error, null);
  assert.equal(state.stream.status, 'live');
  assert.equal(state.candleCount, 3);
  assert.equal(state.feed.instrument.tickSize, 0.1, 'instrument metadata applied');

  // Live updates: the forming bar is replaced, the next bar is appended.
  sockets[0].receive(kline(2, 15));
  assert.equal(runtime.inspect().latestCandle?.volume, 15);
  sockets[0].receive(kline(3, 1));
  assert.equal(runtime.inspect().candleCount, 4);
  assert.equal(runtime.state().error, null);

  // Paging.
  assert.equal(runtime.loadOlderHistory(), true);
  await settle();
  assert.match(requests.at(-1)!, new RegExp(`endTime=${T0 - 1}`));

  // Pause closes the socket; resume reconnects and reloads history.
  runtime.execute({ type: 'feed.pause', paused: true });
  assert.equal(sockets[0].readyState, 3);
  runtime.execute({ type: 'feed.pause', paused: false });
  await settle();
  sockets.at(-1)!.open();
  await settle();
  assert.equal(runtime.state().stream.status, 'live');

  // Dispose stops everything.
  runtime.dispose();
  const count = requests.length;
  await settle();
  assert.equal(sockets.at(-1)!.readyState, 3);
  assert.equal(requests.length, count);
});
```

Save it as `tests/acme-feed.test.ts` and run it:

```sh
node --experimental-strip-types --test tests/acme-feed.test.ts
```

Node's type stripping does not support TypeScript parameter properties (`constructor(readonly url: string)`) or enums. Write plain fields, as the fake socket does. Import local files with their `.ts` extension.

Add tests for the cases that broke real adapters:

- An update that arrives before history is not lost.
- A bar that skips an interval leads to a history reload, and `state().error` stays `null`.
- An older version of the forming bar, sent after a newer one, does not roll it back.
- A failed REST request marks the stream `error` or `stale`, then recovers on retry.
- A reply that arrives after `dispose()` does not reach the runtime.

To test the runtime's rules on their own, emit events by hand from a scripted adapter:

```ts
import { ChartRuntime, type FeedAdapter, type FeedEvent } from 'candleframe/core';

let emit!: (event: FeedEvent) => void;
const scripted: FeedAdapter = {
  descriptor: {
    id: 'scripted',
    label: 'Scripted',
    instrument: { symbol: 'A/B', name: 'A / B', base: 'A', quote: 'B', tickSize: 0.01, pricePrecision: 2, quantityPrecision: 2 },
    interval: '1m',
    intervalMs: 60_000,
    simulated: false,
  },
  connect(next) {
    emit = next;
    return { setPaused() {}, dispose() {} };
  },
};

const runtime = new ChartRuntime(scripted);
runtime.start();
const bar = (minute: number) => ({ timeMs: minute * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 });
emit({ type: 'candles.history', candles: [bar(0), bar(1)] });
emit({ type: 'candle', candle: bar(5) });
console.log(runtime.state().error); // 'CANDLE_GAP: reconnect to refresh history'
runtime.dispose();
```

## Verification checklist

Report each item as done, with the test that covers it.

- [ ] The factory returns synchronously and opens nothing until `connect`.
- [ ] `new ChartRuntime(feed)` does not throw for every symbol and interval you support.
- [ ] `intervalMs === intervalToMs(interval)`. Tick and range intervals declare `gaps: true`.
- [ ] Candle times are UTC milliseconds at the bar's open, aligned to the interval unless `gaps: true`.
- [ ] History loads with `error === null` and `stream.status === 'live'`.
- [ ] The forming bar updates in place. The next bar appends. No `CANDLE_GAP`, `UNKNOWN_CORRECTION` or `INVALID_CANDLE` in normal operation.
- [ ] Updates received before history are merged, not dropped.
- [ ] A missed interval reloads history.
- [ ] Status events report `loading`, `stale` and `error`. The adapter never sends `live`.
- [ ] Reconnects back off and reload history.
- [ ] Every async callback checks a generation counter.
- [ ] `setPaused(true)` stops all network work. `setPaused(false)` reloads history.
- [ ] `dispose()` closes sockets, clears timers, aborts requests, and nothing emits afterwards.
- [ ] `loadOlder` returns bars that end before `beforeMs`, sets `exhausted`, and reports failures with `error`.
- [ ] `npx tsc --noEmit` passes and the headless tests pass.

## Prompt for the agent

Paste this to your coding agent, with the bracketed parts filled in:

```text
Implement a CandleFrame FeedAdapter for [EXCHANGE OR API NAME].

Inputs:
- API docs: [LINKS]
- Symbols: [CHART SYMBOLS AND THEIR EXCHANGE IDS, e.g. BTC/USDT = BTCUSDT]
- Intervals: [e.g. 1m, 5m, 15m, 1h, 4h, 1d]
- File: [e.g. src/feeds/acme-feed.ts], exported as [createAcmeFeed(symbol, interval, transport?)]

Follow https://adarshzpatel.github.io/candleframe/agents/build-a-feed/ exactly:
1. Before coding, answer every row of "Gather this first". Ask me about anything the
   API docs do not settle. Do not guess timestamp units, tick sizes or correction rules.
2. Read src/types.ts, src/runtime.ts (validateDescriptor, validCandle, receive) and
   src/binance-feed.ts in the candleframe package.
3. Build in the order: descriptor, history, live candles, status and reconnects,
   paging. Run each step's check before the next.
4. Accept an optional transport { fetch, createSocket } so tests can replace the network.
5. Write node:test tests that drive the adapter through ChartRuntime with a fake
   fetch and a fake socket, following the "Verify headlessly" pattern. Cover every item
   in the verification checklist.
6. Run the tests with node --experimental-strip-types --test and run tsc --noEmit.

Report: the answers from step 1, the files you changed, the checklist with the test
covering each item, and anything in the API that did not fit the contract.
```
