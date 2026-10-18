---
title: Chart types
description: The 13 ways CandleFrame draws price bars, which candle fields each one reads, how it autoscales and which theme tokens style it.
---

The chart type sets how the price pane draws bars. It is part of the saved document, so it is undoable and saved with the layout. Set it with a command:

```json
{ "type": "chartType.set", "chartType": "area" }
```

```ts
chart.execute({ type: 'chartType.set', chartType: 'heikin-ashi' });
chart.execute({ type: 'chartType.set', chartType: 'footprint', footprint: { mode: 'delta' } });
```

The document leaves `chartType` out when it is `candles`. Older layouts without the field load as candles.

## All types

`CHART_TYPES` lists every type in menu order, with its label and its group in the widget's Chart type menu.

| Id | Label | Group | Draws | Reads |
| --- | --- | --- | --- | --- |
| `candles` | Candles | Bars | A body from open to close and a wick from high to low. | open, high, low, close |
| `hollow-candles` | Hollow candles | Bars | Candles with an outlined body when close ≥ open and a filled body when close < open. Bodies too small to outline are filled. Colour comes from the close before. | open, high, low, close, previous close |
| `heikin-ashi` | Heikin Ashi | Bars | Candles built from Heikin Ashi values. See [Heikin Ashi](#heikin-ashi). | open, high, low, close |
| `ohlc-bars` | Bars | Bars | A vertical high-low line, an open tick on the left and a close tick on the right. | open, high, low, close |
| `hlc-bars` | HLC bars | Bars | A high-low line and a close tick, with no open tick. | high, low, close; open for colour |
| `high-low` | High-low | Bars | The high-low line alone. | high, low; open and close for colour |
| `columns` | Columns | Bars | A column from the close down to the bottom of the plot. Colour comes from the close before. | close, previous close |
| `line` | Line | Lines | The closes joined by a line. | close |
| `line-markers` | Line with markers | Lines | A line with a dot at each close. | close |
| `step-line` | Step line | Lines | A horizontal step at each close, joined by vertical risers. | close |
| `area` | Area | Lines | A line with a fill down to the bottom of the plot. | close |
| `baseline` | Baseline | Lines | A line split at the first visible close, with fills above and below it. | close |
| `footprint` | Footprint | Order flow | Volume at price cells beside a thin candle. See [Footprint](#footprint). | `footprint`, open, high, low, close |

Colour rules:

- Candles, Heikin Ashi, OHLC bars, HLC bars and high-low colour a bar up when close ≥ open.
- Hollow candles and columns colour a bar up when its close is at or above the previous bar's close.
- Line types use their own tokens, listed in [Theme tokens](#theme-tokens).

When bars are narrower than 2 pixels, the chart merges the bars that share a 2-pixel column into one bar before drawing. Line with markers hides its dots below 4 pixels per bar.

## Autoscale

`drawsClosesOnly(type)` returns `true` for `line`, `line-markers`, `step-line`, `area`, `baseline` and `columns`. For these types, autoscale fits the visible closes. For every other type it fits the visible highs and lows. In both cases it also fits visible price-pane indicators, such as Bollinger Bands.

```ts
import { drawsClosesOnly } from 'candleframe/core';

drawsClosesOnly('area'); // true
drawsClosesOnly('candles'); // false
```

## Heikin Ashi

Heikin Ashi changes the bar values, not only how they look. The runtime builds Heikin Ashi bars from the feed's bars:

- close = (open + high + low + close) / 4
- open = (previous Heikin Ashi open + previous Heikin Ashi close) / 2. The first loaded bar uses (open + close) / 2.
- high = the largest of high, Heikin Ashi open and Heikin Ashi close
- low = the smallest of low, Heikin Ashi open and Heikin Ashi close

While `heikin-ashi` is the chart type, everything that reads bars sees the Heikin Ashi values: `RuntimeState.candles`, autoscale, hover, indicators and `query()`. A live tick recomputes only the bars from the change on. Switching to or from Heikin Ashi recomputes every indicator.

To read the feed's own bars, pass `raw: true`. Indicator values are the same either way, because they were computed from the Heikin Ashi bars.

```ts
runtime.execute({ type: 'chartType.set', chartType: 'heikin-ashi' });
const heikin = runtime.query({ limit: 1 }).candles[0];
const feedBar = runtime.query({ limit: 1, raw: true }).candles[0];
console.log(heikin.close, feedBar.close);
```

`heikinAshi(candles, previous, changed)` is exported if you need the same transform elsewhere.

## Footprint

A footprint bar is a thin candle at the left of its column and one cell per price row beside it. It needs order flow data on each candle:

- `footprint` is an array of `[price, buyVolume, sellVolume]` levels, ascending by price. Each price is the low edge of an equal-width bucket.
- A candle without `footprint` levels draws as a normal candle.
- When bars are narrower than 28 pixels (`FOOTPRINT_MIN_SPACING`), every bar draws as a candle. Zoom in to see cells.

`TradeBarBuilder` fills `footprint` when it builds bars from trades, and the simulated feed includes it. See [Trade bars](../../feeds/trade-bars/).

Rows merge whole buckets so each row stays at least 14 pixels tall. The `footprint` settings on `chartType.set` merge with the current ones. The defaults are in `FOOTPRINT_DEFAULTS`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode` | `'bidAsk'` | `'bidAsk'` shows sell × buy volume, `'delta'` shows buy minus sell, `'volume'` shows a split volume bar. |
| `imbalance` | `true` | Highlight rows where one side trades 3 times the diagonal opposite side (`IMBALANCE_RATIO`). |
| `poc` | `true` | Outline each bar's heaviest row. |
| `summary` | `true` | Show the bar's delta and volume under it. |

The document keeps footprint settings while another chart type shows, so switching back restores them. An unknown key or a wrong value type fails with `INVALID_FOOTPRINT`.

## Theme tokens

These tokens live in the theme's `chart` group.

| Token | Default | Used by |
| --- | --- | --- |
| `lineColor` | `@text` | Line for `line`, `line-markers`, `step-line` and `area`. Dots for `line-markers`. |
| `lineWidth` | `2` (0.5 to 6) | Line width for every line type. Also sets the size of the `line-markers` dots. |
| `areaColor` | `@text` | Fill under `area`. |
| `areaOpacity` | `0.12` | Opacity of the `area` fill. |
| `baselineUp` | `@positive` | `baseline` line and fill above the base. |
| `baselineDown` | `@negative` | `baseline` line and fill below the base. |
| `baselineOpacity` | `0.14` | Opacity of both `baseline` fills. |
| `candleUp`, `candleDown` | `@positive`, `@negative` | Bodies and bars for every bar type, and footprint cells. |
| `wickUp`, `wickDown` | `@positive`, `@negative` | Wicks of `candles` and `heikin-ashi`. |
| `candleBodyRatio` | `0.72` | Body width as a share of bar spacing. Also the tick length of OHLC and HLC bars, and the column width. |
| `candleMaxWidth` | `64` | Widest body in pixels. |
| `candleMinHeight` | `1.5` | Shortest body in pixels, so flat bars stay visible. |
| `wickWidth` | `1` | Wick width, the outline of hollow candles and the thinnest bar stroke. |

`baseline` also draws the base line itself in `axisColor` at half opacity. The footprint's point-of-control outline uses the palette's `accent` colour.

```ts
import { createTheme } from 'candleframe/chart';

chart.setTheme(createTheme('graphite', { chart: { lineColor: '@accent', lineWidth: 2.5, areaOpacity: 0.2 } }));
chart.execute({ type: 'chartType.set', chartType: 'area' });
```

## Helpers

`candleframe/core` exports these:

| Export | What it is |
| --- | --- |
| `CHART_TYPES` | Every type as `{ id, label, group }`, in menu order. |
| `isChartType(value)` | `true` when `value` is a chart type id. |
| `chartTypeLabel(type)` | The menu label for a type. |
| `drawsClosesOnly(type)` | `true` for types that autoscale to closes. |
| `heikinAshi(candles, previous, changed)` | Heikin Ashi bars from raw ones. |
| `FOOTPRINT_DEFAULTS`, `FOOTPRINT_MIN_SPACING`, `IMBALANCE_RATIO` | Footprint defaults and limits. |

An unknown chart type in a command or a document fails with `INVALID_CHART_TYPE`. Its `details.chartTypes` lists the valid ids.
