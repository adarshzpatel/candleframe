---
title: Static and REST data
description: Chart an array of candles with createStaticFeed, load it from a REST API and push live updates into it.
---

`createStaticFeed` turns an array of candles into a feed. Use it when your application already has the data, or fetches it itself. You will learn how to load candles from a REST API, push updates, replace the data, and let users pan back through older bars.

```ts
import { createStaticFeed } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

const feed = createStaticFeed({
  instrument: 'ACME',
  interval: '1d',
  gaps: true, // weekends and holidays take no space
  candles: [
    { timeMs: Date.UTC(2026, 0, 5), open: 142.5, high: 144, low: 141.8, close: 143.6, volume: 812_000 },
    { timeMs: Date.UTC(2026, 0, 6), open: 143.6, high: 145.2, low: 143, close: 144.9, volume: 744_500 },
  ],
});

createChartWidget(host, { feed });
```

Candle times are UTC milliseconds at the start of each bar. Candles must strictly ascend by time, or `createStaticFeed` throws `INVALID_HISTORY` with the failing index in `path` (for example `candles.3.timeMs`). It copies the array, so later changes to your array do not reach the chart.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `candles` | required | Ascending candles. |
| `interval` | required | The bar interval, such as `1m`, `1h` or `1d`. Invalid values throw `UNSUPPORTED_INTERVAL`. |
| `instrument` | required | A symbol string, or an object with `symbol` and any other `Instrument` fields. |
| `id` | `'static'` | The source id saved in layouts. Must match the source `id` when used in widget `markets`. |
| `label` | `'Static data'` | A readable source name. |
| `gaps` | `false` | Set for markets with sessions, weekends or holidays. See [what gaps means](../overview/#what-gaps-true-means). |
| `initialBars` | `1000` | Newest bars sent when a chart connects. |
| `pageSize` | `1000` | Bars sent per older-history page. |

`initialBars` and `pageSize` must be positive integers, or the call throws `INVALID_OPTION`.

### Instrument metadata

Pass a string and the feed fills in the rest from your data:

- `pricePrecision` is the most decimals found in the open, high, low and close of the last 500 bars, up to 8.
- `tickSize` is `10 ** -pricePrecision`, so 2 decimals give 0.01.
- `quantityPrecision` is the most decimals found in the volumes of the last 500 bars, up to 8.
- `name` is the symbol. A symbol with a slash, such as `EUR/USD`, splits into `base` and `quote`. Otherwise `base` is the symbol and `quote` is `USD`.

Pass an object to set any of these yourself. If you give `tickSize` but not `pricePrecision`, precision comes from the decimals in `tickSize`.

```ts
import { createStaticFeed, type Candle } from 'candleframe/core';

declare const candles: Candle[];

const feed = createStaticFeed({
  candles,
  interval: '5m',
  instrument: { symbol: 'ES', name: 'E-mini S&P 500', quote: 'USD', tickSize: 0.25, quantityPrecision: 0 },
  gaps: true,
});
```

Set `tickSize` when your market trades in steps that are not a power of ten, such as 0.25. Inferred precision cannot know that.

## Load candles from a REST API

Fetch the rows, convert them to `Candle` objects, then create the feed. Most APIs need three conversions:

- Timestamps in seconds become milliseconds. ISO strings go through `Date.parse`.
- Prices sent as strings become numbers.
- Newest-first lists are reversed to oldest first.

This example reads a hypothetical endpoint that returns newest-first rows with times in seconds:

```ts
import { createStaticFeed, type Candle } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

// Hypothetical: GET /v1/bars?symbol=ACME&interval=1h
// -> [{ "t": 1767225600, "o": "142.50", "h": "144.00", "l": "141.80", "c": "143.60", "v": "812000" }, ...]
interface Bar { t: number; o: string; h: string; l: string; c: string; v: string }

const response = await fetch('https://api.example.com/v1/bars?symbol=ACME&interval=1h');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const bars = (await response.json()) as Bar[];

const candles: Candle[] = bars
  .map(bar => ({
    timeMs: bar.t * 1000,
    open: Number(bar.o),
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    volume: Number(bar.v),
  }))
  .reverse();

const feed = createStaticFeed({ candles, interval: '1h', instrument: 'ACME', gaps: true });
createChartWidget(host, { feed });
```

`createStaticFeed` only checks the order of times. The runtime checks each candle when the chart connects, and rejects the whole history with `INVALID_HISTORY` if one bar is invalid, such as a low of 0, a high below the close, a `NaN` price, or a time off the interval boundary on a feed without `gaps`. The chart then shows the error instead of candles. The [full candle rules](../overview/#candles) list every check.

:::caution
Without `gaps: true`, every bar time must sit on an interval boundary and every interval must have a bar. Stock, futures and forex data almost always need `gaps: true`. Daily bars stamped at a session open, such as 14:30 UTC, also need it, because they do not sit on midnight.
:::

## Push live updates

`feed.update(candle)` sends a bar to every connected chart:

| Candle time | Result |
| --- | --- |
| Newer than the last bar | Appends it. |
| Equal to the last bar | Replaces the last bar. Use this for the forming bar. |
| Equal to an older bar in the data | Replaces that bar. A chart that has not paged back that far reports `UNKNOWN_CORRECTION`. |
| Older and not in the data | Throws `UNKNOWN_CORRECTION`. |

```ts
import { createStaticFeed, type Candle } from 'candleframe/core';

declare const history: Candle[];
const feed = createStaticFeed({ candles: history, interval: '1m', instrument: 'BTC/USD' });

const socket = new WebSocket('wss://stream.example.com/bars?symbol=BTC-USD&interval=1m');
socket.onmessage = event => {
  const { t, o, h, l, c, v } = JSON.parse(event.data as string);
  feed.update({ timeMs: t, open: o, high: h, low: l, close: c, volume: v });
};
```

The runtime still applies its own rules to each update. On a feed without `gaps`, a new bar must start exactly one interval after the last one, or the chart reports `CANDLE_GAP`. If your source can skip bars, for example after a dropped socket, refetch and call `setCandles`.

`update` covers simple cases. It does not reconnect, report stream health or reload after a pause. For a live source with those needs, write an adapter as shown in [Live data over WebSocket](../live-websocket/).

## Replace all candles

`feed.setCandles(candles)` replaces the data and sends the newest `initialBars` to every connected chart as fresh history. Drawings and indicators stay. Use it after a refetch or a correction to many bars.

```ts
import { createStaticFeed, type Candle } from 'candleframe/core';

declare function fetchCandles(): Promise<Candle[]>;

const feed = createStaticFeed({ candles: await fetchCandles(), interval: '15m', instrument: 'ACME', gaps: true });

// Refetch every minute and replace the data.
setInterval(async () => feed.setCandles(await fetchCandles()), 60_000);
```

`setCandles` keeps the same market. To show another symbol or interval, create a new feed and pass it to `chart.replaceFeed`.

If you create the feed with an empty array, a connecting chart reports "No candles to display" until you call `setCandles` with data. Do not call `update` first. A chart with no history rejects the bar with `MISSING_HISTORY`.

## Older history

A chart receives the newest `initialBars` bars when it connects. When the user pans within 50 bars of the first loaded bar, the chart asks for the `pageSize` bars before it, until the array runs out. You can also request a page yourself:

```ts
const requested = chart.loadOlderHistory(); // false when nothing more can load
```

The feed pages only through the array you gave it. To page from a server, write an adapter with `loadOlder`, as described in [History paging](../overview/#history-paging).

The chart keeps at most `maxCandles` bars in memory (default 10,000, set on `createChart`, `createChartWidget` or `ChartRuntime`). Paging stops there.

## Pausing

While a chart is paused, `update` and `setCandles` still change the feed's data, but that chart does not see them. On resume the feed sends the newest `initialBars` bars as fresh history, so the chart catches up in one step.

## Several charts and markets

One static feed can serve several charts at once. Each `connect` adds a listener, and `update` and `setCandles` reach all of them.

In widget `markets`, `createFeed` must return an adapter right away. If your data is already loaded, build the feed there and pass the source `id`:

```ts
import { createStaticFeed, type Candle, type Interval } from 'candleframe/core';
import { createChartWidget, type WidgetMarketSource } from 'candleframe/widget';

declare const data: Record<string, Partial<Record<Interval, Candle[]>>>;

const source: WidgetMarketSource = {
  id: 'archive',
  label: 'Archive',
  symbols: ['ACME', 'GLOBEX'],
  intervals: ['1h', '1d'],
  createFeed: ({ symbol, interval }) =>
    createStaticFeed({ id: 'archive', instrument: symbol, interval, candles: data[symbol][interval] ?? [], gaps: true }),
};

createChartWidget(host, { feed: source.createFeed({ symbol: 'ACME', interval: '1d' }), markets: [source] });
```

Without `id: 'archive'` the feed's id would be `static`, and the widget would reject it with `MARKET_FEED_MISMATCH`. If each selection needs a fetch first, write a small adapter that fetches inside `connect`, like the one in [Data feeds](../overview/#a-complete-adapter).
