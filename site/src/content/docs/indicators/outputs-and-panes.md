---
title: Outputs, panes and styles
description: Draw several series from one indicator, pick how each one renders, shade between them, recolour candles and use separate panes.
---

One indicator can draw several series. Bollinger Bands draw three lines, MACD draws two lines and a histogram, and Tideline draws a shaded ribbon, coloured candles and dots. This page shows how to declare outputs, choose a style for each, fill between them, recolour the price candles, and put an indicator in its own pane.

It builds on [Build an indicator](../build-an-indicator/). The same contract applies. Arrays align with the candles, `NaN` means no value, and `Infinity` is not allowed.

## Declare outputs

Add an `outputs` array and implement `calculateOutputs`. When `outputs` is not empty, the runtime calls `calculateOutputs` instead of `calculate`.

```ts nocheck
calculateOutputs(
  candles: readonly Candle[],
  previous: readonly (readonly number[])[],
  changedIndex: number,
): number[][]
```

Return one array per output, in the order of `outputs`, each with exactly `candles.length` numbers. `previous` holds the arrays you returned last time. It is empty on the first call, so read it as `previous[k] ?? []`. `changedIndex` means the same as for `calculate`.

Each output is an `IndicatorOutput`:

| Field | What it does |
| --- | --- |
| `id` | Names the series. `query()` and `inspect()` key values by it. |
| `name` | A readable name for the series. |
| `color` | RGBA, each channel 0 to 1. |
| `themeColor` | A theme slot, `'indicator'` to `'indicator6'`, that replaces the RGB of `color`. The alpha of `color` still applies. |
| `style` | How the series draws. Default `'line'`. See the next section. |
| `radius` | Dot radius in pixels, for `style: 'dot'`. Default 3. |
| `palette` | Candle colours, for `style: 'candles'`. |

With `outputs`, colours come from each output. The plugin's own `themeColor` is ignored, and its `color` is only a fallback. The widget legend uses the first output's colour for its swatch.

## Output styles

| Style | Draws | Where | Counts toward the fitted range |
| --- | --- | --- | --- |
| `line` | Segments between neighbouring finite values. A `NaN` breaks the line. | Price pane and separate panes | yes |
| `histogram` | A bar from zero at each finite value, in the theme's up colour when the value is 0 or more and its down colour below. The output's colour is not used for the bars. | Both | yes |
| `column` | A bar from zero at each finite value, in the output's colour. | Both | yes |
| `dot` | A circle at each finite value. Dots shrink to half the bar spacing when bars are narrow. | Price pane only | yes |
| `candles` | Nothing. Each value is an index into `palette`, and the price candle on that bar takes that colour. | Price pane only | no |
| `none` | Nothing. The values still bound fills and the fitted range. | Both | yes |

`line`, `histogram` and `column` draw with WebGL. Dots draw on the overlay canvas, clipped to the price pane, so a `dot` output on a separate pane does not show.

On the price pane, the autoscaled price range includes the positive finite values of every shown overlay output except `candles`. Bands stay in view without the user rescaling.

## Fill between outputs

`fills` shades the area between two outputs:

```ts nocheck
fills: [{ upper: 0, lower: 1, opacity: 0.08 }]
```

`upper` and `lower` are indexes into `outputs`. The fill takes the upper output's resolved colour at `opacity`. Like a line, it spans from one bar to the next only where both outputs have finite values on both bars. Fills sit under the candles.

Fills draw on the price pane only. The renderer skips them for `pane: 'separate'`.

To shade a band without drawing its edges, give the edge outputs `style: 'none'`. Tideline does this for its ribbon. It also splits one line into an output per state, finite only on that state's bars, so each segment and its fill take the state's colour.

## Recolour candles

An output with `style: 'candles'` and a `palette` recolours the price candles. Its value on each bar picks a palette entry: `0` for the first colour, `1` for the second. `NaN`, or an index with no entry, keeps the theme's colour for that bar.

Only one indicator recolours candles at a time. The renderer uses the first shown price-pane indicator that has a `candles` output.

## Worked example: a Donchian channel

This channel draws the highest high and lowest low of the last `period` bars, shades between them, draws a faint midline, and colours bars that touch a new high or low.

```ts
import type { IndicatorPlugin } from 'candleframe/core';

const TEAL = [0.35, 0.8, 0.78, 0.9] as const;

export function donchian(period = 20): IndicatorPlugin {
  return {
    id: `donchian-${period}`,
    name: `Donchian ${period}`,
    kind: 'donchian',
    inputs: { period },
    color: TEAL,
    outputs: [
      { id: 'upper', name: 'Upper', color: TEAL, themeColor: 'indicator3' },
      { id: 'lower', name: 'Lower', color: TEAL, themeColor: 'indicator3' },
      { id: 'middle', name: 'Middle', color: [TEAL[0], TEAL[1], TEAL[2], 0.5], themeColor: 'indicator3' },
      {
        id: 'breakout',
        name: 'Breakout bars',
        color: TEAL,
        style: 'candles',
        palette: [
          [0.2, 0.75, 0.45, 1], // 0: the bar made a new high
          [0.9, 0.35, 0.35, 1], // 1: the bar made a new low
        ],
      },
    ],
    fills: [{ upper: 0, lower: 1, opacity: 0.08 }],
    calculateOutputs(candles, previous, changedIndex) {
      const done = previous[0]?.length ?? 0;
      const start = done ? Math.max(0, Math.min(changedIndex, done)) : 0;
      const [upper, lower, middle, breakout] = [0, 1, 2, 3].map(k => (previous[k] ?? []).slice(0, start));
      for (let i = start; i < candles.length; i++) {
        upper[i] = lower[i] = middle[i] = breakout[i] = Number.NaN;
        if (i < period - 1) continue;
        let high = -Infinity;
        let low = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
          high = Math.max(high, candles[j].high);
          low = Math.min(low, candles[j].low);
        }
        upper[i] = high;
        lower[i] = low;
        middle[i] = (high + low) / 2;
        if (candles[i].high === high) breakout[i] = 0;
        else if (candles[i].low === low) breakout[i] = 1;
      }
      return [upper, lower, middle, breakout];
    },
  };
}
```

The running `high` and `low` start at `-Infinity` and `Infinity`, but they never reach the output. Every array slot gets either `NaN` or a real price.

The built-in `bollinger` in `src/indicators.ts` follows the same pattern with three outputs and no fill. `tideline` is the largest example, with `none` edges and fills, a `candles` output, four `dot` outputs and three projection lines.

## Separate panes

Set `pane: 'separate'` and the indicator gets its own pane under the volume bars. Panes stack in the order of the document's indicators. Hidden indicators give up their pane.

| Field | Effect in a separate pane |
| --- | --- |
| `range` | Fixes the pane's scale, such as `{ min: 0, max: 100 }`. Without it the pane fits the visible values of every output except `candles`, plus `levels`, with 10% padding. |
| `levels` | Dashed guide lines across the pane. When set, the pane's axis labels sit on these values instead of automatic ticks. |
| `display: 'candles'` | Draws four outputs, open, high, low and close in that order, as candles in the theme's up and down colours. |

The pane header shows the indicator's `name` and the latest value of each output in that output's colour. For `display: 'candles'` it shows the latest close, coloured by direction.

Each pane gets a fifth of the chart's free height, kept between 56 and 140 pixels. When panes would take more than 55% of the height together, they shrink, down to 28 pixels each.

The fitted range does not include zero unless a value or a level is there. A histogram whose values are all positive would float above the bottom edge. Add `levels: [0]` to keep the zero line in view, as MACD does.

This momentum indicator draws the change over `period` bars as a histogram, with its average as a line:

```ts
import type { IndicatorPlugin } from 'candleframe/core';

export function momentum(period = 10): IndicatorPlugin {
  return {
    id: `momentum-${period}`,
    name: `Momentum ${period}`,
    kind: 'momentum',
    inputs: { period },
    pane: 'separate',
    levels: [0],
    color: [0.66, 0.74, 1, 0.95],
    outputs: [
      { id: 'change', name: 'Change', color: [0.6, 0.64, 0.7, 0.55], style: 'histogram' },
      { id: 'average', name: 'Average', color: [0.66, 0.74, 1, 0.95], themeColor: 'indicator' },
    ],
    // The average depends on the changes before it; recomputing is O(n * period).
    calculateOutputs(candles) {
      const change = candles.map((bar, i) => (i >= period ? bar.close - candles[i - period].close : Number.NaN));
      const average = change.map((_, i) => {
        if (i < 2 * period - 1) return Number.NaN;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += change[j];
        return sum / period;
      });
      return [change, average];
    },
  };
}
```

It ignores `previous` and `changedIndex` and recomputes everything, which is always correct. The built-in `macd` does the same.

`cvd` is the reference for `display: 'candles'`. Its four outputs carry the running delta's open, high, low and close, and it updates from `changedIndex` by continuing from the previous close.

## Profiles, bubbles and flow markers

`pane: 'profile'` indicators have no series. The runtime skips `calculate` for them, and the chart builds what they draw from the visible bars on each frame. Set one of these objects on the plugin:

| Field | Type | Draws | Built-in |
| --- | --- | --- | --- |
| `profile` | `ProfileOptions` | Volume and delta rows against the price axis, with point of control and value area. Uses each candle's `footprint` when it has one, and spreads the bar's volume from low to high otherwise. | `volumeProfile`, `priceDelta` |
| `bubbles` | `BubbleOptions` | A bubble per large print, sized by volume. Needs `largeTrades` on the candles. | `bigTrades` |
| `flowSignals` | `FlowSignalOptions` | Absorption and aggression markers and zones. Reads `buyVolume` and `footprint`. | `absorptionAggression` |

`ProfileOptions` takes `volume` and `delta` switches, `rowHeight` in pixels, `width` as a share of the plot from 0.05 to 0.5, and optional `valueArea`, `range` (`'visible'`, `'today'` or `'session'`) and `sessions`. `BubbleOptions` takes `minSize` and `maxRadius`. These are configuration for renderers the library ships. A profile plugin cannot supply its own drawing code.

The quickest way to a custom profile is to spread a built-in and change its options:

```ts
import { volumeProfile, type IndicatorPlugin } from 'candleframe/core';

const sessionProfile: IndicatorPlugin = {
  ...volumeProfile(4, 0.25, 0.7, { range: 'session' }),
  id: 'session-profile',
  name: 'Session profile',
};
```

The object keeps the built-in's `kind` (`vp`) and `inputs`, which `volumeProfile` sets to match its options. If you write the options by hand instead, keep `inputs` in step with them. When the user edits the indicator's settings, the runtime builds a new `vp` from the [registry](../registry/) using only `inputs`.
