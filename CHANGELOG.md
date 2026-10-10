# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may break the API.

## Unreleased

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
