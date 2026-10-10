# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may break the API.

## Unreleased

- Subpath exports: `openchart/core` (no DOM), `openchart/chart`, `openchart/widget` and `openchart/binance`. `scripts/check-package.mjs` verifies each imports in plain Node and that the tarball carries the fonts.
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
