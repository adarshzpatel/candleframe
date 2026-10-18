---
title: Errors
description: The ChartError class, its JSON shape, and every error code CandleFrame throws, grouped by area.
---

Every failure CandleFrame reports is a `ChartError`. Branch on its `code`, which is stable. The `message` is for people and can change.

## The ChartError class

`ChartError` extends `Error` and is exported from `candleframe/core`.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `'ChartError'` | Always this value. |
| `code` | `string` | Stable identifier in upper snake case, such as `DRAWING_NOT_FOUND`. |
| `message` | `string` | The code, then `: ` and a hint when there is one. |
| `path` | `string`, optional | Dotted location of the bad input, such as `drawings.2.points`. |
| `details` | `object`, optional | Extra data for the failure, such as limits or the allowed values. |
| `cause` | `unknown`, optional | The original error, when one error wraps another. |

`toJSON()` returns `{ code, message, path, details }`. `JSON.stringify` calls it, so a `ChartError` serializes to that shape:

```json
{
  "code": "UNKNOWN_INDICATOR",
  "message": "UNKNOWN_INDICATOR",
  "path": "0.indicator.kind",
  "details": { "kind": "foo", "available": ["sma", "ema", "bb", "rsi", "macd"], "index": 0, "type": "indicator.add" }
}
```

The `available` list above is shortened. The runtime lists every registered kind.

### Errors in a batch

When a command in a batch fails, the error's `path` starts with the command's index, and `details` gains `index` and `type`. The batch above failed at command 0, an `indicator.add`. Nothing in the batch was applied.

## isChartError and toChartError

`isChartError(value, code?)` returns `true` when `value` is a `ChartError`, and when `code` is given, has that code. It narrows the type in TypeScript.

`toChartError(value)` turns anything into a `ChartError`:

- A `ChartError` comes back unchanged.
- An `Error` whose message is an upper-case code, alone or followed by a colon and text, becomes a `ChartError` with that code. `CANDLE_GAP` and `CANDLE_GAP: reconnect` both work. `CANDLE_GAP reconnect` does not.
- Any other `Error` becomes `UNEXPECTED_ERROR` with the original message.
- Anything else becomes `UNEXPECTED_ERROR` with the value as text.

The original value is kept as `cause` for `Error` inputs.

```ts
import { isChartError, toChartError } from 'candleframe/core';

try {
  runtime.execute({ type: 'indicator.remove', id: 'missing' });
} catch (error) {
  if (isChartError(error, 'INDICATOR_NOT_FOUND')) console.log(error.details); // { id: 'missing' }
  else console.log(JSON.stringify(toChartError(error)));
}
```

## Where errors appear

- Methods throw. `execute`, `query`, `restoreDocument`, `replaceFeed`, feed and indicator factories, `createChart` and `createChartWidget` throw a `ChartError` for bad input.
- `preview` never throws. It returns `{ ok: false, error }`, where `error` is the JSON shape.
- Feed data errors do not throw. When a feed sends bad data, the runtime sets that stream's status to `error` and stores the message in `streams.candles.message` or `streams.depth.message`. `inspect().error` and the subscribed state's `error` join these messages. The message starts with the code.
- Renderer failures do not throw. The chart shows the message over the plot. See [Rendering](#rendering).
- Errors from pointer and keyboard actions in a chart, such as editing a drawing, go to the `onError` option of `createChart` and `createChartWidget`. The widget also shows them as a notice.

## Codes

Each table lists the codes for one area with what triggers them. Codes come from `new ChartError(...)` calls in `src/`.

### Commands, queries and lifecycle

| Code | Meaning |
| --- | --- |
| `REVISION_CONFLICT` | `expectedRevision` does not match the current `documentRevision`. `details` has `expected` and `actual`. |
| `IDEMPOTENCY_CONFLICT` | The `idempotencyKey` was already used for different commands. |
| `INVALID_IDEMPOTENCY_KEY` | The key is not a string of 1 to 128 characters. |
| `INVALID_BATCH` | The batch is not an array, has more than 500 commands, or contains `history.undo`, `history.redo` or `feed.pause`. |
| `INVALID_COMMAND` | A command field has the wrong type, such as a non-boolean `enabled`, `visible` or `paused`, or an `indicator.add` without a `kind`. |
| `UNKNOWN_COMMAND` | The command `type` is not one of the 25 command types. |
| `INVALID_QUERY` | `query()` got a non-object, a `limit` outside 1 to 5,000, or a non-finite `fromMs` or `toMs`. |
| `DISPOSED` | The runtime was disposed. Create a new one. |
| `INVALID_OPTION` | A constructor option is out of range: `maxCandles` (100 to 100,000), the simulated feed's `speed` (0.1 to 1,000), or a static feed's `initialBars` or `pageSize`. |
| `UNEXPECTED_ERROR` | `toChartError` wrapped an error that had no code. |

### View and layers

| Code | Meaning |
| --- | --- |
| `INVALID_VIEWPORT` | The time range is not 3 to 2,200 bars wide. `details` has `bars`, `minBars` and `maxBars`. |
| `INVALID_PRICE_SCALE` | `minPrice` is not positive, `maxPrice` is not at least one tick above it, or `log` is not a boolean. |
| `INVALID_LAYER` | Unknown layer name, or `visible` is not a boolean. `details.allowed` lists the layers. |
| `HEATMAP_DISABLED` | You tried to show the heatmap layer on a chart created without `heatmap: true`. |
| `INVALID_CHART_TYPE` | Unknown chart type. `details.chartTypes` lists the valid ids. |
| `INVALID_FOOTPRINT` | Footprint settings are not an object, have an unknown key, or have a value of the wrong type. |
| `INVALID_INTENSITY` | Heatmap intensity is outside 0.2 to 2. |

### Documents and layouts

| Code | Meaning |
| --- | --- |
| `INVALID_DOCUMENT` | The document is not an object. |
| `UNSUPPORTED_DOCUMENT_VERSION` | `version` is not 1, 2, 3 or 4. |
| `SYMBOL_MISMATCH` | The document is for another symbol. |
| `MARKET_MISMATCH` | The document is for another feed id or interval. |
| `LEGACY_MARKET_MISMATCH` | A version 1 document can only load on the simulated BTC/USD 1-minute market. |
| `INVALID_LAYERS` | `layers` is missing or one of its four flags is not a boolean. |
| `INVALID_INDICATORS` | `indicators` is not an array of at most 16 entries, or an entry lacks a valid `id`, `kind` or `visible`. |
| `DUPLICATE_INDICATOR_ID` | Two indicators share an id. |
| `INVALID_DRAWINGS` | `drawings` is not an array, or holds more than 100 drawings. A `drawing.add` past 100 drawings also fails with this code. |
| `DUPLICATE_DRAWING_ID` | Two drawings share an id, including a `drawing.add` with an id already in use. |
| `DRAWING_LIMIT_EXCEEDED` | The drawings have more than 8,192 points in total or more than 256 KB of JSON, or a `drawing.group` would pass the group limit. |
| `INVALID_DRAWING_GROUPS` | `drawingGroups` is malformed: too many groups, a group without an id or drawings, duplicate ids, or a bad name. |

### Indicators

| Code | Meaning |
| --- | --- |
| `UNKNOWN_INDICATOR` | The kind is not registered. `details.available` lists the kinds. Also thrown when updating the inputs of an indicator whose kind is not registered. |
| `INDICATOR_NOT_FOUND` | No indicator has this id. |
| `INDICATOR_LIMIT_EXCEEDED` | The chart already has 16 indicators. |
| `INVALID_INDICATOR_INPUT` | Inputs are not an object, name an unknown input (`details.allowed`), or a value is outside its range (`details.min`, `details.max`, `details.integer`). |
| `INVALID_INDICATOR` | A plugin has no way to calculate, or its calculation returned the wrong number of series, the wrong length, or non-numbers. |
| `DUPLICATE_PLUGIN` | Two plugins passed to the runtime share an id. |
| `INVALID_INDICATOR_DEFINITION` | An indicator definition has a bad `kind`, no `create` function, or an unknown `pane`. |
| `DUPLICATE_INDICATOR_DEFINITION` | Two indicator definitions share a kind. |
| `INVALID_PERIOD` | An indicator factory such as `sma(period)`, `ema`, `rsi` or `bollinger` got a bad period. |
| `INVALID_INPUT` | An indicator factory got an out-of-range setting, or `setPriceLines` or `setMarkers` got a bad line or marker. The message names the field. |

### Drawings

| Code | Meaning |
| --- | --- |
| `DRAWING_NOT_FOUND` | No drawing has this id. |
| `DRAWING_LOCKED` | The drawing is locked, so its points cannot change. Unlock it first. |
| `INVALID_DRAWING` | The drawing is not an object, or its `id` or `type` is invalid. |
| `INVALID_DRAWING_POINTS` | `points` is not an array of 1 to 1,024 anchors with a finite `timeMs` and a positive `price`. |
| `INVALID_DRAWING_POINT_COUNT` | The number of points does not match the tool. See `points` in `inspect().capabilities.drawingTools`. |
| `INVALID_DRAWING_STYLE` | `style` has an unknown key or a bad value. |
| `INVALID_DRAWING_FLAGS` | `locked` or `visible` is not a boolean. |
| `INVALID_DRAWING_TEXT` | `text` is not a string of at most 2,000 characters. |
| `INVALID_DRAWING_LEVELS` | `levels` or `levelStyles` is malformed. |
| `INVALID_DRAWING_OPTIONS` | `options` has a bad key or a value the tool's setting does not accept, or drawing options passed to the chart are invalid. |
| `INVALID_DRAWING_VISIBILITY` | `visibility` has an unknown family or key, or a range outside the family's bounds. |
| `INVALID_DRAWING_PATCH` | A `drawing.update` patch is not an object or has an unknown key, or `drawing.lockAll` got a non-boolean. |
| `INVALID_DRAWING_OFFSET` | A `drawing.duplicate` offset is not finite. |
| `INVALID_DRAWING_ORDER` | `where` is not `front` or `back`, or `drawing.reorder` does not list every drawing exactly once. |
| `INVALID_DRAWING_TRANSLATION` | A drawing could not be moved by the given time and price. |
| `INVALID_POSITION_PRICES` | A long or short position drawing has its target, entry and stop in the wrong order. |
| `INVALID_DRAWING_GROUP` | A group id or name is invalid, `drawingIds` is empty or has duplicates, or `drawing.updateGroup` sent neither `name` nor `drawingIds`. |
| `DRAWING_GROUP_EXISTS` | A group with this id already exists. |
| `DRAWING_GROUP_NOT_FOUND` | No group has this id. |
| `UNKNOWN_DRAWING_TOOL` | No drawing tool has this type. |
| `INVALID_DRAWING_TOOL` | A custom drawing tool definition is malformed. |
| `DUPLICATE_DRAWING_TOOL` | Two drawing tool definitions share a type. |

A drawing whose `type` is not registered is not an error. The runtime keeps it and lists its type in `unsupportedDrawingTypes`.

### Drawing templates

| Code | Meaning |
| --- | --- |
| `INVALID_TEMPLATE_NAME` | The name is empty, too long or contains control characters. |
| `TEMPLATE_EXISTS` | A template with this name already exists for the tool. Names compare without case. |
| `TEMPLATE_LIMIT` | The tool already has the most templates allowed. |
| `TEMPLATE_NOT_FOUND` | No template has this name. |

### Feeds and market data

Errors in data a feed sends mark the stream as `error` instead of throwing. See [Where errors appear](#where-errors-appear).

| Code | Meaning |
| --- | --- |
| `INVALID_FEED` | The feed descriptor is malformed, `intervalMs` does not match `interval`, or a tick or range interval lacks `gaps: true`. |
| `INVALID_INSTRUMENT` | The instrument lacks a symbol, name, base or quote, or has a bad tick size or precision. |
| `INSTRUMENT_MISMATCH` | An `instrument` event names a different symbol, base or quote than the feed. |
| `INVALID_HISTORY` | History is empty, longer than 100,000 bars, holds an invalid candle, or its times do not strictly ascend. |
| `INVALID_CANDLE` | A live candle is invalid. For example, it has a non-finite value, a low above the open or close, negative volume, or a time off the interval grid. |
| `MISSING_HISTORY` | A live candle arrived before any history. |
| `CANDLE_GAP` | A live candle skipped one or more intervals on a feed without `gaps`. Reconnect to refresh history. |
| `UNKNOWN_CORRECTION` | A candle is older than the latest one and matches no loaded bar. |
| `INVALID_DEPTH` | Depth levels have duplicate or non-positive prices, or negative quantities. |
| `DEPTH_LIMIT` | The book has more than 2,048 levels on a side. |
| `CROSSED_BOOK` | The best bid is at or above the best ask. |
| `INVALID_SEQUENCE` | A depth sequence number is not a non-negative safe integer. |
| `INVALID_HEATMAP_GRID` | The heatmap grid has bad rows, bin size or interval. |
| `INVALID_HEATMAP_COLUMN` | A heatmap column has a bad time or values. |
| `OUT_OF_ORDER_DEPTH` | A heatmap column is older than the latest one. |
| `UNSUPPORTED_INTERVAL` | The interval string does not parse, or the simulated feed got an interval under 1 minute. |
| `INVALID_SEED` | The simulated feed's seed is not a finite number. |
| `UNSUPPORTED_SYMBOL` | The simulated feed has no preset for this symbol. |
| `UNSUPPORTED_MARKET` | The Binance feed does not support this symbol or interval. `details.intervals` lists the intervals. |

### Themes and formatting

| Code | Meaning |
| --- | --- |
| `UNKNOWN_CHART_THEME` | No built-in theme has this id. |
| `INVALID_CHART_THEME` | A theme object lacks a valid `id`, `name`, `mode` or `palette`. |
| `UNSUPPORTED_THEME_VERSION` | The theme's `version` is not 1. |
| `INVALID_THEME_COLOR` | A palette colour is not a `#rrggbb` hex string. The message names the key. |
| `INVALID_THEME_TOKEN` | A token value is the wrong type or out of range. The message names the token. |
| `UNKNOWN_THEME_TOKEN` | A theme has a key that is not a known token. |
| `INVALID_THEME_OVERRIDES` | `createTheme` got overrides that are not a plain object. |
| `THEME_JSON_TOO_LARGE` | The theme editor got more than 64,000 characters of JSON. |
| `INVALID_TIME_ZONE` | The time zone is not an IANA name, such as `UTC` or `America/New_York`. |

### Rendering

`createChart` does not throw these, except `CANVAS2D_UNAVAILABLE`. The chart shows the message in a notice over the plot instead, and a later `capture()` throws `RENDERER_UNAVAILABLE`.

| Code | Meaning |
| --- | --- |
| `WEBGL2_UNAVAILABLE` | The browser or device could not create a WebGL2 context. |
| `CANVAS2D_UNAVAILABLE` | The browser could not create a 2D canvas context for the overlays. |
| `SHADER_ERROR` | A shader failed to compile or link. The message has the log. |
| `RENDERER_UNAVAILABLE` | `capture()` was called after the renderer failed. |

### Widget

| Code | Meaning |
| --- | --- |
| `WIDGET_STORAGE_KEY_REQUIRED` | `layoutStore` was passed without a `storageKey`. |
| `WIDGET_MARKETS_REQUIRED` | A grid of more than one chart needs the `markets` option. |
| `INVALID_LAYOUT_PRESET` | Unknown layout preset. `details.allowed` lists the presets. |
| `INVALID_CHART_INDEX` | `setActiveChart` got an index with no chart. |
| `INVALID_LAYOUT_NAME` | A saved layout name is empty. |
| `LAST_LAYOUT` | You tried to delete the only saved layout. |
| `INVALID_MARKET_SOURCES` | `markets` is not an array. |
| `INVALID_MARKET_SOURCE` | A market source lacks an `id`, `label`, `createFeed`, symbols or intervals, or has duplicates or an unknown custom interval kind. |
| `DUPLICATE_MARKET_SOURCE` | Two market sources share an id. |
| `UNSUPPORTED_MARKET_SELECTION` | The source does not offer this symbol or interval. |
| `INVALID_MARKET_FEED` | A source's `createFeed` returned something that is not a feed. |
| `MARKET_FEED_MISMATCH` | The feed from `createFeed` has a different source id, symbol or interval than requested. |
| `MARKET_SOURCE_UNAVAILABLE` | The selected market source is no longer in `markets`. |
| `MARKET_CHANGED_DURING_RESTORE` | The market changed while a saved layout was loading. |

### Trading

The trading plugin (`candleframe/trading`) defines no error codes of its own.
