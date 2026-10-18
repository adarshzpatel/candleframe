---
title: Build an indicator
description: Write a custom indicator plugin, put it on a chart, and test that live updates match a full recalculation.
---

This guide builds a rolling VWAP from scratch. By the end you will have an indicator that draws on the price pane, updates on every tick without recomputing the whole series, can be added from the widget's Indicators menu, and has a test that proves its incremental output is right.

An indicator is a plain object that implements `IndicatorPlugin`. There is no base class and nothing to register globally. You hand the object to a chart, and the runtime calls it whenever the candles change.

## The plugin shape

These are the fields a single-series indicator uses. All of them are on `IndicatorPlugin` in `src/types.ts`.

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | Unique per chart. Documents save it, so keep it to letters, digits, `_`, `.`, `:` and `-`, at most 64 characters. |
| `name` | yes | Shown in the legend and the pane header. |
| `color` | yes | RGBA with each channel from 0 to 1, such as `[0.98, 0.72, 0.3, 0.95]`. |
| `themeColor` | no | A theme slot (`'indicator'` to `'indicator6'`) that replaces the RGB of `color`. The alpha of `color` still applies. |
| `pane` | no | `'price'` (default) overlays the candles. `'separate'` gets its own pane below. `'profile'` draws against the price axis without a series. |
| `kind` | no | The registry kind this indicator belongs to. Saved in documents. Defaults to `'custom'`. |
| `inputs` | no | The numbers that configure it, such as `{ period: 20 }`. Saved in documents. |
| `range` | no | A fixed pane range, such as RSI's `{ min: 0, max: 100 }`. Separate panes only. |
| `levels` | no | Dashed guide lines across a separate pane, such as `[30, 70]`. |
| `calculate` | yes, for one series | Returns one value per candle. |

Indicators with several series use `outputs` and `calculateOutputs` instead of `calculate`. Profiles, trade bubbles and flow markers use `pane: 'profile'` with no series at all. Both are covered in [Outputs, panes and styles](../outputs-and-panes/).

## The calculate contract

```ts nocheck
calculate(candles: readonly Candle[], previous: readonly number[], changedIndex: number): number[]
```

- `candles` are the bars the chart shows. With the Heikin Ashi chart type these are Heikin Ashi bars, not the feed's.
- `previous` is the array you returned last time. It is empty the first time the runtime computes the indicator. It is read-only, so copy the part you keep.
- `changedIndex` is the first candle that changed since that call. Everything before it is the same as last time.

The runtime calls `calculate` in these situations:

| Event | `changedIndex` |
| --- | --- |
| The indicator is created, or the chart switches to or from Heikin Ashi | `0`, with `previous` empty |
| History loads or reloads | `0` |
| Older history is prepended while panning back | `0` |
| The forming bar ticks | the last index |
| A new bar arrives | the new bar's index, which equals `previous.length` |
| A new bar pushes the oldest one out past `maxCandles` | `0` |

Return a new array with exactly `candles.length` numbers. Use `NaN` where there is no value yet, such as the warmup bars of a moving average. The runtime checks every result. If the array has the wrong length, holds something that is not a number, or holds `Infinity` or `-Infinity`, the runtime throws `INVALID_INDICATOR` with your plugin's id. During a data update that puts the candle stream into an `error` state and keeps the previous candles and values. When a command adds the indicator, the command fails.

The output must depend only on `candles`. The runtime can call you from `0` at any time, and a live chart must show the same values as one loaded from scratch.

## Write the indicator

A rolling VWAP is the volume-weighted average of the typical price, `(high + low + close) / 3`, over the last `period` bars.

```ts
import type { IndicatorPlugin } from 'candleframe/core';

export function rollingVwap(period = 20): IndicatorPlugin {
  if (!Number.isInteger(period) || period < 1) throw new Error('period must be a positive integer');
  return {
    id: `vwap-${period}`,
    name: `VWAP ${period}`,
    kind: 'rolling-vwap',
    inputs: { period },
    color: [0.98, 0.72, 0.3, 0.95],
    themeColor: 'indicator2',
    calculate(candles, previous, changedIndex) {
      // Keep the values before the first changed bar; recompute the rest.
      const start = previous.length ? Math.max(0, Math.min(changedIndex, previous.length)) : 0;
      const values = previous.slice(0, start);
      for (let i = start; i < candles.length; i++) {
        if (i < period - 1) {
          values[i] = Number.NaN; // warmup
          continue;
        }
        let priceVolume = 0;
        let volume = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const bar = candles[j];
          priceVolume += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
          volume += bar.volume;
        }
        // No volume in the window: NaN, not a division by zero.
        values[i] = volume > 0 ? priceVolume / volume : Number.NaN;
      }
      return values;
    },
  };
}
```

Three details carry the contract:

- `start` clamps `changedIndex` to `previous.length`. That one line covers every row of the table above. A fresh start or a history reload recomputes everything. A tick recomputes one value.
- `previous.slice(0, start)` copies the unchanged prefix instead of writing into `previous`.
- The `volume > 0` check matters. A window with zero volume would otherwise divide by zero and return `NaN` or `Infinity`, and `Infinity` fails the runtime's check.

On a tick this costs `period` steps, not a pass over every bar. Running sums (add the new bar, subtract the one leaving the window) are cheaper still. The built-in `sma` works that way. The catch is floating-point drift. On 2,000 bars, the built-in `sma` updated on a tick differs from a fresh calculation by around 1e-13. If you use running sums, compare with a tolerance in tests.

Some indicators depend on every earlier bar, such as RSI with Wilder smoothing. Those can ignore `changedIndex` and recompute the whole series. The built-in `rsi` does that, and it is O(n) per update.

## Put it on a chart

Pass plugin objects in the `indicators` option. The bare chart, the widget and the headless runtime all take them.

```ts
import { createChart } from 'candleframe/chart';
import { ChartRuntime, type IndicatorPlugin } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

declare function rollingVwap(period?: number): IndicatorPlugin; // from the step above

const bare = createChart(host, { feed, indicators: [rollingVwap(20)] });
const widget = createChartWidget(host, { feed, indicators: [rollingVwap(20)] });

// Headless: the plugins are the second constructor argument.
const headless = new ChartRuntime(feed, [rollingVwap(20)]);
headless.start();
```

The runtime checks each object when it starts. Every plugin needs `calculate`, or `outputs` with `calculateOutputs`, or `pane: 'profile'` with `profile`, `bubbles` or `flowSignals`. Otherwise the constructor throws `INVALID_INDICATOR`. Two plugins with the same `id` throw `DUPLICATE_PLUGIN`. A document holds at most 16 indicators.

Each plugin becomes an entry in the chart document: `{ id, kind, inputs, visible }`. The runtime keeps using your object while the entry's `id`, `kind` and `inputs` still match it. That has two consequences for a plugin passed this way and nowhere else:

- Changing its inputs fails with `UNKNOWN_INDICATOR` ("inputs of an unregistered kind cannot change"), because the runtime has no way to build a new instance.
- If the user removes it from the legend, only undo brings it back. The Indicators menu does not list it.

## Make it addable

Register an `IndicatorDefinition` for the kind and both limits go away. The widget's Indicators menu lists it, the settings dialog edits its inputs, `indicator.add` creates it by kind, and saved layouts restore it on any chart that has the definition.

```ts
import type { IndicatorDefinition, IndicatorPlugin } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

declare function rollingVwap(period?: number): IndicatorPlugin; // from the step above

const rollingVwapDefinition: IndicatorDefinition = {
  kind: 'rolling-vwap',
  name: 'Rolling VWAP',
  description: 'Volume-weighted average of the typical price over the last N bars.',
  pane: 'price',
  inputs: { period: { label: 'Period', default: 20, min: 1, max: 500 } },
  create: (inputs, id) => ({ ...rollingVwap(inputs.period), id }),
};

const widget = createChartWidget(host, {
  feed,
  indicators: [rollingVwap(20)],
  indicatorDefinitions: [rollingVwapDefinition],
});
widget.execute({ type: 'indicator.add', indicator: { kind: 'rolling-vwap', inputs: { period: 50 } } });
```

With the definition in place, editing the starting VWAP's period swaps in an instance built by `create`, and undo brings back your original object. [Indicator registry](../registry/) covers definitions, input specs and how documents restore indicators.

## Test it

The property worth testing is that incremental updates give the same numbers as a full recalculation. Compute the series once, change the data the way a live feed does, and compare the incremental result with a fresh one. This mirrors `tests/indicators.test.ts`.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candle, IndicatorPlugin } from 'candleframe/core';

declare function rollingVwap(period?: number): IndicatorPlugin; // from the step above

const bars = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = 100 + 10 * Math.sin(i / 7);
    return { timeMs: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 1 + (i % 5) };
  });

test('incremental updates match a full recalculation', () => {
  const candles = bars(200);
  const plugin = rollingVwap(20);
  const full = plugin.calculate!(candles, [], 0);
  assert.equal(full.length, candles.length);
  assert.ok(Number.isNaN(full[18]) && Number.isFinite(full[19]));

  // The forming bar ticks: same time, new close.
  const ticked = candles.slice();
  ticked[199] = { ...ticked[199], close: 120, high: 121 };
  const afterTick = plugin.calculate!(ticked, full, 199);
  assert.deepEqual(afterTick, plugin.calculate!(ticked, [], 0));

  // A new bar arrives: changedIndex is its index.
  const grown = [...ticked, { ...ticked[199], timeMs: 200 * 60_000 }];
  assert.deepEqual(plugin.calculate!(grown, afterTick, 200), plugin.calculate!(grown, [], 0));
});

test('a window without volume gives NaN, never Infinity', () => {
  const values = rollingVwap(5).calculate!(bars(30).map(bar => ({ ...bar, volume: 0 })), [], 0);
  assert.ok(values.every(Number.isNaN));
});
```

Feed each step the array the previous step returned, as the runtime does. Passing `full` to the new-bar step would keep the stale value for bar 199.

`assert.deepEqual` treats `NaN` as equal to `NaN`, so the warmup bars compare cleanly. The repository runs its own TypeScript tests with `node --experimental-strip-types --test`.

## Indicator code is trusted

The runtime calls your functions directly, on the main thread, with no sandbox. A plugin can read anything the page can read and can block rendering with a slow loop. Treat indicator code as part of your application. Do not load indicator scripts written by your users and run them as plugins. The plugin contract is not a safe place to execute untrusted code.
