---
title: Embed the widget
description: Mount the complete chart UI with createChartWidget, configure its markets, storage and panels, and control it from your code.
---

`createChartWidget` mounts a complete chart workbench in one element: symbol and interval pickers, chart types, indicators, 85 drawing tools, layouts, PNG export and an optional order book. This page shows how to configure it and drive it from your application.

```ts
import { createChartWidget, createSimulatedFeed, sma } from 'candleframe';

const chart = createChartWidget(host, {
  feed: createSimulatedFeed(),
  indicators: [sma(20)],
  orderBook: true,
  storageKey: 'main-chart',
});
```

Only `feed` is required. The widget fills `host`, so give the host a width and a height. It watches its own size and adapts the controls to the width it gets.

The widget lives in an open shadow root. It carries its own styles, so you import no CSS, and page styles cannot restyle its buttons or hide its canvases. Two widgets on one page have separate state, menus, undo history and storage.

## Options

`ChartWidgetOptions` extends the bare chart's `ChartOptions`, so every option on [Use the bare chart](../bare-chart/) works here too.

| Option | What it does | Default |
| --- | --- | --- |
| `feed` | The data source the first chart opens with. See [Data feeds](../../feeds/overview/). | Required |
| `markets` | A catalog of sources, symbols and intervals. Turns on the symbol, interval and source pickers and the Layout button. | None. Pickers are read-only. |
| `indicators` | Indicator plugins to start with, such as `sma(20)`. | None |
| `indicatorDefinitions` | Extra indicator kinds for the Indicators menu, `indicator.add` and saved layouts. | Built-ins only |
| `theme` | A preset id such as `'midnight'`, or a theme from `createTheme`. See [Themes](../theming/). | Graphite, or Paper when the system prefers light |
| `orderBook` | Shows the order book panel at mount. Needs a feed with depth. | `false` |
| `storageKey` | Saves layouts and appearance in `localStorage` under this namespace, and shows the Save and Revert buttons. | Session only |
| `layoutStore` | Your own storage for layouts. Needs `storageKey`. See [Save layouts](../layouts/). | `localStorage` |
| `layout` | The starting grid and sync settings, such as `{ preset: '2x2' }`. Grids need `markets`. | One chart |
| `inspector` | Adds an Inspect button in the footer that shows the chart's state as JSON. | `false` |
| `fonts` | Where the bundled fonts load from: `'bundled'`, a base URL, or `false`. See [Installation](../../getting-started/installation/#fonts). | `'bundled'` |
| `timeZone` | IANA zone for axis and crosshair labels, such as `'America/New_York'`. | `'UTC'` |
| `maxCandles` | Candles kept in memory per chart, including paged history. 100 to 100,000. | 10,000 |
| `autoscaleOnPan` | Keeps an automatic price scale fitted to the visible candles while you drag. | `false` |
| `drawingTemplateStore`, `drawingFavouriteStore` | Your own storage for drawing templates and favourite tools. | `localStorage` under `storageKey`, or session only |
| `onError` | Receives a `ChartError` when a user action fails. | None |

The widget hides controls that cannot do anything in your configuration. Layout stays hidden without `markets`. The source picker needs at least two sources. Save and Revert need `storageKey`. Inspect needs `inspector: true`.

## Let users switch markets

Without `markets`, the widget shows the feed you passed and nothing else. Add a catalog to let users pick a symbol, interval or source:

```ts
import { createChartWidget, createSimulatedFeed } from 'candleframe';
import type { WidgetMarketSource } from 'candleframe';

type SimSymbol = 'BTC/USD' | 'ETH/USD' | 'SOL/USD';
const markets: WidgetMarketSource[] = [
  {
    id: 'simulated', // Must equal the feed's descriptor.id.
    label: 'Simulation',
    symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    intervals: ['1m', '5m', '15m', '1h'],
    createFeed: ({ symbol, interval }) => createSimulatedFeed({ symbol: symbol as SimSymbol, interval }),
  },
];

const chart = createChartWidget(host, {
  feed: createSimulatedFeed({ symbol: 'BTC/USD', interval: '1m' }),
  markets,
});
```

`createFeed` must return a new, disconnected feed. The widget connects it and disposes the old one. It checks that the feed's `descriptor.id`, symbol and interval match the selection, and throws `MARKET_FEED_MISMATCH` if they do not. If `createFeed` throws, the widget keeps the previous market.

Set `customIntervals` on a source to let users type their own lengths. With `customIntervals: ['time', 'tick']`, a user can enter `3m` or `700 ticks` in the interval picker. Your `createFeed` then receives that interval.

Each source, symbol and interval keeps its own drawings and indicators. When the user switches market, the widget loads the document saved for the new one. Switching only the interval carries the current drawings over if nothing is saved for the new interval yet.

## Order book

`orderBook: true` opens the order book panel beside the chart. It reads depth events from the feed, so it only has rows when the feed's descriptor declares depth. The simulation, the Binance feed and the Hyperliquid feed all do. In widgets 850 pixels wide or narrower, the panel starts closed and opens over the chart from the Order book button.

## Control the widget from code

The widget returns a `ChartWidgetApi`. It has every method of the bare chart's `ChartApi`, and they act on the active chart, the one the toolbar controls. A few apply to every chart in the grid: `setTheme`, `setTimeZone` and `setDrawingOptions`.

```ts
chart.execute({ type: 'chartType.set', chartType: 'heikin-ashi' });
chart.execute({ type: 'priceScale.log', enabled: true });
chart.setTool('fib-retracement');
chart.setTheme('paper');

const state = chart.inspect(); // An owned copy of the current state.
const bars = chart.query({ visible: true }); // Candles and indicator values in view.
const png = chart.capture(); // A PNG data URL.
```

[Commands](../../reference/commands/) lists everything `execute` accepts. Commands are undoable, and a batch passed as an array is one undo step.

The grid methods are specific to the widget:

| Method | What it does |
| --- | --- |
| `charts()` | Every chart in cell order, as `ChartApi` objects. The widget owns them, so do not dispose them. |
| `getActiveChart()` | The index of the active chart. |
| `setActiveChart(index)` | Makes another chart active. Throws `INVALID_CHART_INDEX` for a missing cell. |
| `getLayout()` | The current grid preset and sync settings. |
| `setLayout({ preset, sync })` | Changes the grid or the sync settings. New charts copy the active chart's market. |

`subscribe` follows the active chart. When the user clicks another chart, your listener receives that chart's state.

Price lines and markers belong to one chart. On a grid, set them per chart through `charts()`:

```ts
const [first] = chart.charts();
first.setPriceLines([{ price: 68_000, label: 'Alert', style: 'dashed' }]);
```

## Change the feed

`replaceFeed` swaps the active chart's data source without remounting. The pickers update to match.

```ts
import { createSimulatedFeed } from 'candleframe';

chart.replaceFeed(createSimulatedFeed({ symbol: 'ETH/USD', interval: '5m' }));
```

## Dispose

Call `dispose()` before you remove the host element, for example when a route or component unmounts.

```ts
chart.dispose();
```

`dispose` saves any pending layout change, closes every chart's feed connection, removes listeners and observers, and removes the widget's element. It leaves the host element in place. Calling it twice is harmless. If you attached the [trading plugin](../../plugins/trading/), dispose that first.

## Next

- [Save layouts](../layouts/) covers autosave, `layoutStore` and multi-chart grids.
- [Themes](../theming/) covers presets and custom themes.
- [Framework integrations](../frameworks/) shows the mount and dispose pattern in React, Vue and Svelte.
