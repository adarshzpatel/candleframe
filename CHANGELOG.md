# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may break the API.

## Unreleased

- Stronger up and down colors: about 95% of the sRGB chroma limit instead of 60% (Evergreen green C 0.113 to 0.169, red 0.115 to 0.184). Volume bars draw at 50% opacity instead of 35%. Every pair still passes `npm run palette:check`.
- Price delta rows all grow from the price-axis edge, like the volume profile, with the sign shown by color. Labels that do not fit past a bar sit inside it.
- The forming candle eases between ticks (`candleMotion`, default on, off under reduced motion). The last-price marker glides with it but always shows the exact last trade.
- `createSimulatedFeed({ trades: true, speed })` simulates individual trades: Poisson arrivals with clustered intensity and bursts, heavy-tailed sizes with occasional blocks, persistent aggressor imbalance and tick-by-tick price impact. The demo uses it in real time as its default source again; Binance and the sample equity remain in the picker.
- Redesigned built-in palettes in OKLCH. `scripts/palette.mjs` (`npm run palette`) generates them from lightness, chroma and hue, then checks every text, marker, candle, drawing and indicator pair against APCA and WCAG minimums (`npm run palette:check`). Up candles are lighter than down candles in every theme, so they stay distinguishable without color.
- Palettes gain `indicator2` to `indicator6`. Built-in indicators draw in theme slots (`themeColor` on a plugin or output) instead of fixed colors, and the legend shows one swatch per overlay. Older saved themes borrow the new slots from a preset of their mode.
- Drawings default to the theme accent, which no indicator series shares.
- Saved appearances store only their differences from the preset (`compactTheme`), so later default changes still apply. `restoreTheme` reads older full saves and drops values that were defaults when they were saved.
- Zoomed-in candles keep growing: bodies take 72% of the bar spacing (was 62%) up to 64 px (was 18 px), so wide zooms no longer leave large gaps.
- Order-flow indicators. `cvd()` draws cumulative volume delta as candles. `volumeProfile()` and `priceDelta()` use a new `profile` pane: rows aggregated from the visible bars, drawn against the price axis, snapped to round prices so they hold still while panning. `buildProfile` exposes the math.
- Candles accept optional `buyVolume` (taker buys), `footprint` (buy and sell volume per price bucket) and `deltaRange` (intrabar delta swing). The simulation generates all three; the Binance feed reads taker buy volume from klines.
- `scripts/screenshot.mjs` saves desktop and phone screenshots of the demo, optionally offline and with indicators added.
- The widget uses Inter for controls and headings, replacing Hanken Grotesk and Newsreader. Headings default to weight 600; title sizes drop to 18 and 16 px to match. One 71 KB font file replaces two (90 KB).
- The demo fills the window with live Binance data. `?offline` switches to the seeded simulation and sample equity.
- The market summary (name, OHLC, legend, last price) floats over the plot instead of taking its own row. Pointer input passes through to the chart; its buttons stay clickable.
- Axis marks sit on round prices and calendar-aligned times and move when you pan, instead of fixed rows relabelled with new values. New days, months and years get bold labels. Grid lines follow the marks.
- Renamed from OpenChart to CandleFrame. The package is `candleframe`, the widget host class is `candleframe-widget` and the chart root is `cf-chart`. Fonts still register under the old `OpenChart UI` and `OpenChart Editorial` names, so saved custom themes keep working.
- Subpath exports: `candleframe/core` (no DOM), `candleframe/chart`, `candleframe/widget` and `candleframe/binance`. `scripts/check-package.mjs` verifies each imports in plain Node and that the tarball carries the fonts.
- Widget `fonts` option: bundled (default), a self-hosted URL, or `false` for system fonts.
- The widget dialog keeps keyboard focus inside and returns it to the opener on close, including in Safari.
- Style modules declare `string` types; their declarations no longer include the CSS (14 KB to 171 bytes).
- Zoomed-out views merge bars that share a two-pixel column. Frame CPU time drops from 2.1 ms to 0.6 ms at 2,200 visible bars.
- `npm run bench` measures tick and frame cost. `npm run smoke` runs the demo in Chromium, Firefox and WebKit with touch emulation; CI runs it.
- `execute` accepts a batch: atomic, one undo step, one revision. It returns `{ documentRevision, created }`.
- `preview(commands)` dry-runs a batch. `idempotencyKey` makes retries safe. `query()` returns candles and aligned indicator values for a range.
- `chartCommandSchema` and `chartCommandBatchSchema` describe every command as JSON Schema. `inspect()` lists available commands and indicator kinds.
- `examples/mcp-server.ts` exposes a headless chart to agents over MCP, with no dependencies. See `docs/agents.md`.
- Indicator panes: RSI and MACD draw in their own panes with guide levels. The crosshair spans every pane.
- New indicators: EMA, Bollinger Bands, RSI and MACD, alongside SMA. Plugins can return several outputs and draw histograms.
- Indicators are saved in layouts (document version 4) and change through `indicator.add`, `indicator.update` and `indicator.remove`, all undoable. Hosts register more kinds with `indicatorDefinitions`.
- Log price scale with `priceScale.log`. The widget has Log and indicator controls.
- `IndicatorPlugin.calculate` is now optional for plugins that declare `outputs` and implement `calculateOutputs`.
- `createStaticFeed` charts an array of candles, infers precision, pages older bars and accepts `update()` calls from the host.
- History paging: feeds may implement `loadOlder(beforeMs)` and emit `candles.prepend`. The chart requests more when you pan near the first bar. Binance and the simulation support it.
- Retention is configurable with `maxCandles` (default 10,000, up from a fixed 2,000).
- The demo adds a sample equity market with weekend and overnight gaps.
- Intervals are no longer limited to 1m, 5m, 15m and 1h. Any `<count><s|m|h|d|w>` works, weekly bars align to Monday, and the Binance feed accepts every fixed-length kline interval.
- Feeds can set `gaps: true` for markets with sessions and weekends. The time axis collapses closed periods, and viewport limits count bars.
- Feeds without an order book can declare `depth: { kind: 'none', levels: 0 }`.
- New `timeZone` option and `setTimeZone()` for axis and crosshair labels. Daily and longer bars show dates without a clock time.
- `Interval` is now a template literal type. Code that switched over the four old values needs a default branch.
- Released under the MIT license.
- Errors are now `ChartError` instances with `code`, `path` and `details`. Messages keep the `CODE: hint` format, so existing message checks still match.
- Added CI, Prettier formatting and package metadata for npm.

## 0.3.0

- Initial public snapshot: WebGL2 engine, embeddable widget, simulated and Binance feeds, 30 drawing tools, themes, layouts and the headless `ChartRuntime`.
