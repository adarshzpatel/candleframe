# OpenChart proof of concept

A framework-independent financial chart engine written in TypeScript and compiled to JavaScript. OpenChart is the working name. Version 0.3 includes a WebGL2 chart, a self-contained embeddable workbench, pluggable feeds, and the research and roadmap for a broader open-source library.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The default simulation works offline without credentials. Seed 42 produces repeatable data at four updates per second and a market clock running at 40 times real time. Select **Binance live** for public spot candles and top-20 depth snapshots. Exchange availability depends on your network and region; connection errors are visible and never replaced by simulated data.

```sh
npm test
npm run build
npm run example:headless
```

The build creates the static demo in `dist/` and ES modules with TypeScript declarations in `dist/lib/`. The package has no runtime dependencies.

## Try version 0.3

- Switch between BTC, ETH and SOL, and 1m, 5m, 15m and 1h candles. Simulation uses USD; Binance uses USDT.
- Drag the plot to pan time and price together without changing their spacing. Fit or double-click the plot to restore the full view. Drag the bottom axis right to widen candle spacing or left to compress it. Drag the right axis up to widen price spacing or down to compress it.
- Double-click an axis to reset that scale. Focus an axis and use arrow keys to resize or Home to reset. Scroll over the plot to zoom time without scrolling the page. Touch drags stay inside the chart. Use `+` / `-` when the plot is focused.
- Plot drags ease toward the pointer and glide briefly on release. Zoom, axis resizing, automatic price changes and Fit animate their ranges. A new grab takes control at the displayed position. Reduced-motion preferences disable these effects.
- Toggle volume and SMA. Choose from 30 drawing tools in the left toolbar: lines, channels, Fibonacci tools, shapes, annotations, freehand, measurements and position plans. Select and move drawings, edit handles, style, lock, hide, duplicate and reorder them in Objects. Undo/redo preserves market data and scales. See the [drawing suite guide](docs/drawing-suite.md).
- Save and restore a layout for the selected source, symbol and interval. Export opens a PNG preview and download link.
- Toggle the integrated order book. Stale depth is dimmed independently of the candle stream.
- Open **Inspect state** for the same semantic state available to an embedding app or agent.

The heatmap has been removed from the demo. The engine retains an experimental opt-in heatmap implementation, disabled by default, with no history or texture allocation in the demo.

## Embed the chart

Use `createChartWidget` for the complete UI, including market controls, drawings, layouts, export and the optional order book. Only a sized container and feed are required; styles and panels are instance-owned.

```ts
import { createChartWidget, createSimulatedFeed, sma } from './dist/lib/index.js';

const chart = createChartWidget(document.querySelector('#chart'), {
  feed: createSimulatedFeed(),
  indicators: [sma(20)],
  orderBook: true,
  storageKey: 'my-primary-chart',
});
// The host element needs an explicit height, for example 600px.
chart.dispose(); // When the host view unmounts.
```

See the [embedding guide](docs/embedding.md) and [two-widget example](examples/embed.html). `createChart` remains the chart-only entry point for applications that supply their own UI:

```ts
import { createChart, createSimulatedFeed, createBinanceFeed, sma } from './dist/lib/index.js';

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

Evergreen is the default theme. The Appearance picker also includes Graphite, Midnight, Paper and Sand. Use Appearance → Customize theme for colors, typography, density, controls and chart styling, with JSON import/export. Hosts can use `createTheme()`, `theme` and `setTheme()`; see [themes](docs/embedding.md#themes).

## Current scope

The PoC implements candles, volume, SMA, a 30-tool drawing suite with undo/redo, order-book reconstruction, independent stream health, market switching, axis scaling, layout persistence, structured commands and GPU restoration. WebGL2 draws geometry; Canvas2D draws text and overlays; HTML supplies accessible controls and a candle table.

Interfaces remain experimental. Multiple panes, session calendars, log scales, paging older history, scripting and broker execution are not implemented. Rendering and calculations run on the main thread. No comparative performance claim has been established.

OpenChart is released under the [MIT license](LICENSE). Bundled fonts use the SIL Open Font License; see `src/fonts/`.

## Project documents

- [Drawing suite and extension API](docs/drawing-suite.md)
- [Self-contained widget integration](docs/embedding.md)
- [Drawing design decisions](docs/drawing-suite-design.md)
- [Implementation and verification](docs/poc.md)
- [Version 0.2 design decisions](docs/v0.2-design.md)
- [Research and feature comparison](docs/research.md)
- [Roadmap and release gates](docs/roadmap.md)
- [Target architecture and proposed future APIs](docs/architecture.md)
- [Contributing](CONTRIBUTING.md) and [changelog](CHANGELOG.md)
