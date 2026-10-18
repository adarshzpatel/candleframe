---
title: Installation
description: Install CandleFrame from GitHub and pick the entry point that matches what you are building.
---

CandleFrame is not on npm yet. Install it straight from GitHub:

```sh
npm install github:adarshzpatel/candleframe
```

npm clones the repository and runs its `prepare` script, which compiles the library into `dist/lib` with TypeScript declarations. The build needs Node 24 or later (the `engines` field in `package.json`). On an older Node the install fails during `prepare`.

The package has no runtime dependencies.

## Pick an entry point

Every entry point is an ES module with its own types. Import from the narrowest one that has what you need.

| Import from | What it contains | Use it when |
| --- | --- | --- |
| `candleframe/widget` | `createChartWidget`, the complete chart UI with toolbars, drawing tools and layouts | You want a finished chart on a page. Start here. |
| `candleframe/chart` | `createChart`, the WebGL2 chart with no toolbars, plus themes, price lines, markers and `createChartGroup` | You build your own controls around the chart. |
| `candleframe/core` | `ChartRuntime`, feeds (`createSimulatedFeed`, `createStaticFeed`), indicators, commands and JSON schemas. No DOM access. | You run charts in Node, a worker, a test or an agent server. |
| `candleframe/trading` | `attachTrading`, `createPaperBroker` and order helpers | You want an order panel and order lines on top of a widget or chart. |
| `candleframe/binance` | `createBinanceFeed`, public Binance Spot candles | You want live crypto data without writing a feed. |
| `candleframe/hyperliquid` | `createHyperliquidFeed`, public Hyperliquid perpetuals candles | You want live perpetuals data without writing a feed. |
| `candleframe` | Everything above | You prefer one import path. The package sets `sideEffects: false`, so bundlers drop what you do not use. |

The widget and chart entries do not export feeds or indicators. Import those from `candleframe/core`, or use the root entry:

```ts
import { createChartWidget } from 'candleframe/widget';
import { createSimulatedFeed, sma } from 'candleframe/core';

const chart = createChartWidget(host, {
  feed: createSimulatedFeed(),
  indicators: [sma(20)],
});
```

Importing any entry is safe on a server. Nothing touches the DOM until you call `createChartWidget` or `createChart`. See [Framework integrations](../../guides/frameworks/) for server-side rendering.

## Fonts

The widget ships two WOFF2 fonts in `dist/lib/fonts/`: Inter for controls and Paper Mono for prices and axes. It registers them once per document. The `fonts` option on `createChartWidget` decides where they load from:

```ts
import { createChartWidget } from 'candleframe/widget';

// Default: resolve the files next to the module with new URL(..., import.meta.url).
createChartWidget(host, { feed, fonts: 'bundled' });

// Serve a copy of dist/lib/fonts/ yourself and pass its base URL.
createChartWidget(host, { feed, fonts: '/static/candleframe-fonts/' });

// Skip the files and use system fonts.
createChartWidget(host, { feed, fonts: false });
```

`'bundled'` works with Vite, webpack 5, Rollup, esbuild and plain ES modules, because each of them handles `new URL(..., import.meta.url)`. Pass a URL when your bundler or CDN does not copy the font files. The bare chart from `candleframe/chart` does not load these fonts. Its theme falls back to system fonts unless the page has loaded them.

## Next

- [Quick start](../quick-start/) mounts a widget in a few lines.
- [Examples](../../examples/) lists the runnable examples in the repository.
