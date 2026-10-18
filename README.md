# CandleFrame proof of concept

A framework-independent financial chart engine written in TypeScript and compiled to JavaScript. Version 0.3 includes a WebGL2 chart, a self-contained embeddable workbench, pluggable feeds, and the research and roadmap for a broader open-source library.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The demo opens on a real-time trade simulation that works offline without credentials: individual prints arrive at irregular times, in bursts and lulls, with heavy-tailed sizes and shifting buy and sell aggression, and they build the candles, order flow and book. Select **Binance** in the source picker for public spot candles and top-20 depth snapshots. Exchange availability depends on your network and region; connection errors are visible and never replaced by simulated data.

```sh
npm test
npm run build
npm run example:headless
```

The build creates the static demo in `dist/` and ES modules with TypeScript declarations in `dist/lib/`. The package has no runtime dependencies.

## Try version 0.3

- The demo fills the window. Sources: the trade simulation (default), live Binance Spot data (BTC, ETH and SOL against USDT, 1m to 1w candles) and a gapped sample equity. Add `?offline` to drop Binance. The forming candle glides between ticks instead of jumping; reduced-motion preferences turn this off.
- Drag the plot to pan time and price together without changing their spacing. Fit or double-click the plot to restore the full view. Drag the bottom axis right to widen candle spacing or left to compress it. Drag the right axis up to widen price spacing or down to compress it.
- Double-click an axis to reset that scale. Focus an axis and use arrow keys to resize or Home to reset. Scroll over the plot to zoom time without scrolling the page. Touch drags stay inside the chart. Use `+` / `-` when the plot is focused.
- Plot drags ease toward the pointer and glide briefly on release. Zoom, axis resizing, automatic price changes and Fit animate their ranges. A new grab takes control at the displayed position. Reduced-motion preferences disable these effects.
- **Chart type** offers candles, hollow candles, Heikin Ashi, OHLC bars, HLC bars, high-low, columns, line, line with markers, step line, area, baseline and footprint. Heikin Ashi changes the bar values, so autoscale, hover, the last price and indicators all read Heikin Ashi bars; `query({ raw: true })` returns the feed's. Footprint cells show sell × buy volume, delta or a volume bar, with optional imbalance highlights, a point of control and a delta and volume line per bar. They need the `footprint` candle field, which the simulation and `TradeBarBuilder` provide and Binance does not.
- Toggle volume. **Indicators** adds SMA, EMA, Bollinger Bands, RSI or MACD; oscillators get their own panes. Hover an indicator in the chart legend to hide it, change its settings or remove it. Order-flow indicators: **CVD** draws cumulative volume delta as candles in its own pane. **Volume profile** shows volume (POC and value area) and delta at each price against the price axis, for the visible bars, with POC as a solid line and VAH/VAL dotted. **Last 10 sessions** also draws a fixed-range volume and delta profile over each of the last ten days. Set **Range** to **Today** or **Current session** to draw only that profile, over its own bars. They read optional `buyVolume`, `footprint` and `deltaRange` candle fields. The simulation provides all three; Binance provides `buyVolume`, so CVD is exact there and the profiles spread each bar evenly over its range. **Log** switches the price axis to a log scale. Choose from 30 drawing tools in the left toolbar: lines, channels, Fibonacci tools, shapes, annotations, freehand, measurements and position plans. Select and move drawings, edit handles, style, lock, hide, duplicate and reorder them in Objects. Undo/redo preserves market data and scales. See the [drawing suite guide](docs/drawing-suite.md).
- Layouts autosave per source, symbol and interval and load again on reload or a market switch. Export opens a PNG preview and download link.
- **Layout** in the header splits the view into up to 8 charts (side by side, stacked, 1 + 2, 2 × 2, 3 × 2, 4 × 2). Click a chart or press Alt + 1 to 8 to choose the one the toolbar controls. Checkboxes sync symbol, interval, crosshair, time and date range across charts. Save named layouts and switch between them; the open one comes back after a reload.
- Toggle the integrated order book. Stale depth is dimmed independently of the candle stream.
- Open **Inspect state** in the footer for the same semantic state available to an embedding app or agent. Embedders turn it on with `inspector: true`.

The heatmap has been removed from the demo. The engine retains an experimental opt-in heatmap implementation, disabled by default, with no history or texture allocation in the demo.

## Embed the chart

Use `createChartWidget` for the complete UI, including market controls, drawings, layouts, export and the optional order book. Only a sized container and feed are required; styles and panels are instance-owned.

```ts
import { createChartWidget, createSimulatedFeed, sma } from 'candleframe';

const chart = createChartWidget(document.querySelector('#chart'), {
  feed: createSimulatedFeed(),
  indicators: [sma(20)],
  orderBook: true,
  storageKey: 'my-primary-chart',
});
// The host element needs an explicit height, for example 600px.
chart.dispose(); // When the host view unmounts.
```

To chart your own data, pass candles to `createStaticFeed`. It infers price precision, pages older bars as the user pans back, and takes live updates from your own socket:

```ts
import { createChartWidget, createStaticFeed } from 'candleframe';

const feed = createStaticFeed({
  instrument: 'AAPL',
  interval: '1d',
  gaps: true, // Weekends and holidays take no space on the time axis.
  candles: rows.map(r => ({ timeMs: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v })),
});
const chart = createChartWidget(document.querySelector('#chart'), { feed, timeZone: 'America/New_York' });
socket.onmessage = event => feed.update(JSON.parse(event.data)); // Appends or replaces the last bar.
```

Narrower entry points keep bundles and server code small: `candleframe/core` has the runtime, feeds, indicators and schemas with no DOM; `candleframe/chart` adds the WebGL chart and themes; `candleframe/widget` is the workbench; `candleframe/binance` is the live feed. The package is not on npm yet; until it is, build it with `npm run build` and install the folder or a `npm pack` tarball.

See the [embedding guide](docs/embedding.md) and [two-widget example](examples/embed.html). `createChart` remains the chart-only entry point for applications that supply their own UI:

```ts
import { createChart, createSimulatedFeed, createBinanceFeed, sma } from 'candleframe';

const container = document.querySelector('#chart');
container.style.height = '500px';
const chart = createChart(container, {
  feed: createSimulatedFeed({ seed: 42, symbol: 'BTC/USD', interval: '1m' }),
  indicators: [sma(20)],
  panMotion: true,   // Default. Set false for direct dragging without momentum.
  scaleMotion: true, // Default. Set false for immediate zoom and scale changes.
});

// Keeps the chart mounted and cancels the previous connection.
chart.replaceFeed(createBinanceFeed({ symbol: 'ETH/USDT', interval: '5m' }),
  chart.inspect().documentRevision);

chart.execute({ type: 'priceScale.set', minPrice: 2000, maxPrice: 4000 });
chart.execute({ type: 'priceScale.reset' });
const layout = chart.exportDocument();
chart.restoreDocument(layout);
chart.dispose(); // Call when the host view unmounts.
```

Replace `FeedAdapter`, `ChartRenderer` or `IndicatorPlugin` to supply data, rendering or calculations. `ChartRuntime` supports the same documents and commands without a DOM or GPU. See the [working contracts](docs/poc.md), [v0.2 design decisions](docs/v0.2-design.md), [headless example](examples/headless.ts) and [contributor instructions](AGENTS.md).

Without a `theme`, charts start in Graphite, or Paper when the system asks for light colors, and the widget follows later system changes until the user picks a theme. The Appearance picker also includes Evergreen (the demo's theme), Midnight, Monochrome and Sand. The library draws no watermark by default; set `chart.watermarkText` to add one. Use Appearance → Customize theme for colors, typography, density, controls and chart styling, with JSON import/export. Hosts can use `createTheme()`, `theme` and `setTheme()`; see [themes](docs/embedding.md#themes).

## Current scope

The PoC implements candles, volume, five indicators with separate panes, log and linear price scales, session gaps, history paging, a 30-tool drawing suite with undo/redo, order-book reconstruction, independent stream health, market switching, multi-chart grids with sync, axis scaling, layout persistence and named layouts, structured commands and GPU restoration. WebGL2 draws geometry; Canvas2D draws text and overlays; HTML supplies accessible controls and a candle table.

Interfaces remain experimental. Scripting and broker execution are not implemented. Rendering and calculations run on the main thread. No comparative performance claim has been established.

CandleFrame is released under the [MIT license](LICENSE). Bundled fonts use the SIL Open Font License; see `src/fonts/`.

## Project documents

- [Drawing suite and extension API](docs/drawing-suite.md)
- [Self-contained widget integration](docs/embedding.md)
- [Multi-chart layouts design](docs/multi-chart-design.md)
- [Drawing design decisions](docs/drawing-suite-design.md)
- [Driving a chart from an agent](docs/agents.md): batches, preview, query, schemas and the MCP server
- [Implementation and verification](docs/poc.md)
- [Version 0.2 design decisions](docs/v0.2-design.md)
- [Research and feature comparison](docs/research.md)
- [Roadmap and release gates](docs/roadmap.md)
- [Target architecture and proposed future APIs](docs/architecture.md)
- [Contributing](CONTRIBUTING.md) and [changelog](CHANGELOG.md)
