---
title: Hyperliquid perpetuals
description: Stream public Hyperliquid perpetuals candles and top-20 depth with createHyperliquidFeed, with no API key.
---

`createHyperliquidFeed` streams public market data for Hyperliquid perpetuals: candles over REST and WebSocket, and the top 20 book levels on each side. It needs no API key and never signs or sends orders. CandleFrame is not affiliated with or endorsed by Hyperliquid.

The adapter works like the [Binance adapter](../live-websocket/#the-binance-adapter). This page covers what differs.

```ts
import { createHyperliquidFeed, HYPERLIQUID_INTERVALS } from 'candleframe/hyperliquid';
import { createChartWidget } from 'candleframe/widget';

const feed = createHyperliquidFeed({ symbol: 'HYPE/USDC', interval: '5m' });
createChartWidget(host, { feed, orderBook: true });

console.log(HYPERLIQUID_INTERVALS); // ['1m', '3m', '5m', ..., '1d', '3d']
```

`symbol` is `BTC/USDC` (the default), `ETH/USDC`, `SOL/USDC` or `HYPE/USDC`. The quote is USDC because Hyperliquid perps are margined and settled in USDC. `interval` defaults to `1m` and must be one of `HYPERLIQUID_INTERVALS`. Anything else throws `UNSUPPORTED_MARKET` before the adapter makes a request.

Two Hyperliquid intervals are missing from the list. `1M` is a calendar month, which CandleFrame does not support. Hyperliquid's `1w` candles open on Thursday, while CandleFrame aligns weekly bars to Monday, so every weekly bar would fail validation.

The second argument replaces the network, as with Binance. The socket needs a `send` method because Hyperliquid takes subscriptions as messages:

```ts
import { createHyperliquidFeed, type HyperliquidTransport } from 'candleframe/hyperliquid';

declare const fakeFetch: typeof fetch;
declare const fakeSocketFactory: HyperliquidTransport['createSocket'];

const feed = createHyperliquidFeed({ symbol: 'ETH/USDC', interval: '1h' }, { fetch: fakeFetch, createSocket: fakeSocketFactory });
```

## Add it to the widget's market picker

A `markets` entry puts Hyperliquid in the widget's source picker. The demo does this next to Binance:

```ts
import { createHyperliquidFeed, HYPERLIQUID_INTERVALS } from 'candleframe/hyperliquid';
import { createChartWidget, type WidgetMarketSource } from 'candleframe/widget';

type HyperliquidSymbol = 'BTC/USDC' | 'ETH/USDC' | 'SOL/USDC' | 'HYPE/USDC';

const hyperliquid: WidgetMarketSource = {
  id: 'hyperliquid', // must match the feed's descriptor id
  label: 'Hyperliquid',
  symbols: ['BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'HYPE/USDC'],
  intervals: HYPERLIQUID_INTERVALS,
  createFeed: ({ symbol, interval }) => createHyperliquidFeed({ symbol: symbol as HyperliquidSymbol, interval }),
};
createChartWidget(host, { feed: hyperliquid.createFeed({ symbol: 'BTC/USDC', interval: '1m' }), markets: [hyperliquid] });
```

## How it works

The source is in `src/hyperliquid-feed.ts`. The API reference is Hyperliquid's [info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) and [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) pages.

**The tick size comes from the price.** Hyperliquid has no fixed tick. A perp price may have five significant figures and at most `6 - szDecimals` decimals, and whole numbers are always valid. On connect the adapter posts `metaAndAssetCtxs`, reads `szDecimals` and the mark price, and emits an `instrument` event. A price from 10,000 to 99,999 gets a tick of 1, a price from 1,000 to 9,999 gets 0.1, and so on down to the decimal cap. The adapter computes it once per connection, so a price that crosses a power of ten keeps the old tick until the next market switch.

**Subscribe, then load history.** Once the socket opens, the adapter subscribes to `candle` and `l2Book` for the coin, then posts `candleSnapshot` for the last 500 bars. Candle messages that arrive before the reply wait in a buffer of up to 512 and merge by bar time.

**Never roll a bar back.** Within a bar, Hyperliquid's volume (`v`) and trade count (`n`) only grow. The adapter drops an update where either is lower than the version it already sent. A bar that starts more than one interval after the last one reconnects and reloads history.

**Full snapshots for depth.** Each `l2Book` message is a complete book of up to 20 levels per side, bids first. The descriptor declares `depth: { kind: 'snapshots', levels: 20 }`, and each message becomes a `depth.snapshot` whose `sequence` is the block time in milliseconds. The adapter drops a book older than the last one it sent. A crossed, unordered or malformed book marks depth `error` and is not shown. The next valid book recovers it.

**Snapshots on request.** The socket pushes a book about every 5 seconds. When the runtime calls `requestSnapshot()`, the adapter posts `l2Book` over REST for an immediate book. Whichever book has the later block time wins.

**Quieter streams, longer timeouts.** Candle messages arrive only when a trade happens, so a quiet market can go 10 seconds without one. The watchdog marks candles `stale` after 30 quiet seconds and reconnects after 90. Depth turns `stale` after 15 seconds and reconnects after 45. Stale depth means the book is unknown, not empty. The server closes a socket that sends nothing for 60 seconds, so the adapter sends `{"method":"ping"}` every 30 seconds.

**Paging.** `loadOlder` asks for the 500 bars before `beforeMs`. Hyperliquid keeps about the most recent 5,000 bars of each interval. Past that the reply is empty, and the adapter sets `exhausted`.

Reconnects, backoff, pausing and the generation counter work as in the Binance adapter.

## Rate limits

Hyperliquid's [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) are per IP address.

| Limit | Hyperliquid allows | One feed uses |
| --- | --- | --- |
| REST weight | 1,200 per minute | 20 for metadata, then about 28 per 500-bar history page and 2 per REST book |
| WebSocket connections | 10 open, 30 new per minute | 1 |
| Subscriptions | 1,000 | 2 |
| Messages sent | 2,000 per minute | 2 subscribes, then 2 pings a minute |

A market switch costs about 48 weight, so a person clicking through markets stays far below the limit. Each feed opens its own socket, so a grid of more than 10 Hyperliquid charts on one IP would pass the connection limit. On HTTP 429 the adapter waits for `Retry-After`, or 60 seconds without one, and shares that cooldown with every Hyperliquid feed that uses the same `fetch` function.

## Check it live

`node scripts/hyperliquid-live.mjs` starts the demo, picks the Hyperliquid source and fails unless candles and depth update within 15 seconds. Pass `--symbol`, `--interval` and `--seconds` to change what it checks. It needs network access, so it is not part of `npm test`.
