# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may break the API.

## Unreleased

- Footprint chart type. The widget's new **Chart type** button switches between candles and footprints. Each footprint bar is a thin candle plus one cell per price row, showing sell × buy volume, delta or a split volume bar. Toggles cover 3:1 diagonal imbalances, the point of control and a delta and volume line under each bar. Rows merge whole feed buckets to stay at least 14px tall. Bars without `footprint` levels, and views narrower than 28px per bar, still draw as candles. The new command is `{ type: 'chartType.set', chartType, footprint? }`. Documents gain optional `chartType` and `footprint` fields with no version bump, so older layouts load as candles. New exports: `footprintBar`, `footprintBucket`, `cellFormat`, `FOOTPRINT_DEFAULTS`.
- Zooming in now stops at 3 bars instead of 20, so footprint cells have room. `MIN_VIEWPORT_BARS` is 3.
- The simulation records footprint volume in fifths of a book step ($1 on BTC at 1m instead of $5). Zoom the price axis in for single-dollar rows. Footprint text grows with the row, up to 14px.
- Big trades indicator (`bigTrades(minSize, maxRadius)`, kind `big-trades`): bubbles for large aggressive prints, green for buyers and red for sellers, with area proportional to size. Candles accept optional `largeTrades` (`[price, size, side, timeMs]`), and `TradeBarBuilder` fills them with `largeTradeMin`, merging the fills of one aggressive order (by `orderId`, or by identical side and time) into one print at its average price.
- `chart.setPriceLines()` and `chart.setMarkers()` draw host-owned overlays, such as working orders, a position's entry and fills. They are view state only: not saved, not undoable and not editable. Price line tags pick dark or light text by luminance and sit above the last-price line.
- Tick and range bars. Intervals accept `500t` (a bar every 500 trades) and `10r` (a bar spanning at most 10 price increments). Feeds with these intervals must set `gaps: true` and give each bar a whole-millisecond time later than the previous one; `intervalMs` is the nominal `TRADE_BAR_SLOT_MS`. New exports: `parseInterval`, `isTimeInterval`, `intervalLabel` (the picker shows "500 ticks" and "10 range") and `TradeBarBuilder`, which turns a trade stream into time, tick or range bars with `buyVolume`, `footprint` and `deltaRange`. On these charts the time axis spaces labels by the visible bars' average duration, and crosshair sync finds the bar that was open at a given time.
- Multi-chart layouts. The widget's **Layout** menu offers seven grids of 1 to 8 charts, sync checkboxes for symbol, interval, crosshair, time and date range, and named layouts with save as, rename and delete. The toolbar acts on the active chart; click a chart or press Alt + 1 to 8. Charts on the same market share drawings. New widget API: `layout` option, `charts()`, `getActiveChart()`, `setActiveChart()`, `getLayout()`, `setLayout()`. `WidgetLayoutStore` gains an optional `remove`, and `save` also receives layout records.
- `createChartGroup` links bare charts: crosshair, time and date range. `ChartApi` gains `setCrosshair` and `subscribeCrosshair`.
- Breaking for scripts that query the widget's shadow root: per-chart summary elements now use classes instead of ids (`.market-price`, `[data-ohlc]`, `.chart-host`, `.retry`), because a grid repeats them. The `chart-summary` part is unchanged.
- Simpler floating panels. Drawing tool flyouts are compact menus with arrow-key navigation. The Drawings panel is an object list with eye, lock and delete icons on each row. Text, fill, font, levels and anchor fields moved to a settings popover on the drawing toolbar, which also gains lock and delete. Indicators open in a centered dialog with search and a one-line list.
- The widget autosaves its layout after each change and loads it on mount and after a market switch. Previously drawings stayed only in memory until Save, and a saved layout only came back through Restore. `restoreDocument(value, revision, { undoable: false })` restores without an undo step.
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
