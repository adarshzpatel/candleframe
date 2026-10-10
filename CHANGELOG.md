# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may break the API.

## Unreleased

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
