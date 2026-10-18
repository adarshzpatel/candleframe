---
title: Indicator registry
description: Register indicator kinds so users and agents can add them by name, edit their inputs, and restore them from saved layouts.
---

A plugin object puts one indicator on one chart. A registered kind goes further. The widget's Indicators menu lists it, its settings dialog edits its inputs, `indicator.add` creates it by name, and saved layouts bring it back. This page covers `IndicatorDefinition`, input specs, the commands that use them, and what happens to indicators a chart cannot compute.

## Define a kind

An `IndicatorDefinition` describes a kind and builds instances of it:

| Field | What it does |
| --- | --- |
| `kind` | The name documents and commands use. Lowercase letters, digits and `-`, starting with a letter, at most 32 characters. |
| `name` | The title in the Indicators menu. |
| `description` | One line under the title. The menu's search also matches it. |
| `pane` | `'price'`, `'separate'` or `'profile'`. The menu labels these Overlay, Pane and Price axis. Use the same pane as the plugin `create` returns. |
| `inputs` | One `IndicatorInputSpec` per input, keyed by input name. |
| `hidden` | Leaves the kind out of the menu. Documents that use it still load. The built-in `price-delta` is hidden. |
| `create(inputs, id)` | Returns the `IndicatorPlugin` for these inputs. |

Each input is an `IndicatorInputSpec`. Every input value is a number.

| Field | What it does |
| --- | --- |
| `label` | The field label in the settings dialog. |
| `default` | Used when a command or document leaves the input out. |
| `min`, `max` | The accepted range, inclusive. |
| `integer` | Default `true`. Set `false` for decimals such as a band width. |
| `toggle` | An on/off switch stored as `0` or `1`. Use `min: 0` and `max: 1`. |
| `options` | Named choices stored as their index. Use `min: 0` and `max` set to the last index. |

This definition has all four kinds of input: an integer, a decimal, a choice and a switch.

```ts
import type { Candle, IndicatorDefinition, IndicatorPlugin } from 'candleframe/core';

const SOURCES = ['Close', 'Typical (HLC/3)'] as const;

function envelope(period: number, percent: number, source: number, middle: boolean): IndicatorPlugin {
  const color = [0.75, 0.6, 1, 0.95] as const;
  const price = (bar: Candle) => (source === 1 ? (bar.high + bar.low + bar.close) / 3 : bar.close);
  return {
    id: `envelope-${period}`,
    name: `Envelope ${period} ${percent}%`,
    color,
    outputs: [
      { id: 'upper', name: 'Upper', color, themeColor: 'indicator4' },
      { id: 'middle', name: 'Middle', color, themeColor: 'indicator4', style: middle ? 'line' : 'none' },
      { id: 'lower', name: 'Lower', color, themeColor: 'indicator4' },
    ],
    fills: [{ upper: 0, lower: 2, opacity: 0.06 }],
    calculateOutputs(candles) {
      const mid = candles.map((_, i) => {
        if (i < period - 1) return Number.NaN;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += price(candles[j]);
        return sum / period;
      });
      return [mid.map(v => v * (1 + percent / 100)), mid, mid.map(v => v * (1 - percent / 100))];
    },
  };
}

export const envelopeDefinition: IndicatorDefinition = {
  kind: 'envelope',
  name: 'Moving average envelope',
  description: 'A moving average with bands a fixed percentage above and below.',
  pane: 'price',
  inputs: {
    period: { label: 'Period', default: 20, min: 2, max: 500 },
    percent: { label: 'Width %', default: 2.5, min: 0.1, max: 50, integer: false },
    source: { label: 'Source', default: 0, min: 0, max: SOURCES.length - 1, options: SOURCES },
    middle: { label: 'Middle line', default: 1, min: 0, max: 1, toggle: true },
  },
  create: (inputs, id) => ({
    ...envelope(inputs.period, inputs.percent, inputs.source, inputs.middle === 1),
    id,
  }),
};
```

`create` receives inputs that are already validated, with defaults filled in. The registry then overwrites the returned plugin's `id`, `kind` and `inputs` with the document's values, so `create` cannot get them out of step. It can still throw, for example on a combination of inputs that min and max cannot express, such as MACD's fast period being below its slow one. The command or restore then fails with that error.

## Register it

Pass definitions in `indicatorDefinitions`. `createChart`, `createChartWidget` and `ChartRuntime` all take the option.

```ts
import { createChart } from 'candleframe/chart';
import { ChartRuntime, type IndicatorDefinition } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

declare const envelopeDefinition: IndicatorDefinition; // from the example above

const widget = createChartWidget(host, { feed, indicatorDefinitions: [envelopeDefinition] });
const bare = createChart(host, { feed, indicatorDefinitions: [envelopeDefinition] });
const headless = new ChartRuntime(feed, [], { indicatorDefinitions: [envelopeDefinition] });
```

The built-in kinds are always registered, and yours are added after them. A `kind` that is already taken, built-in or not, throws `DUPLICATE_INDICATOR_DEFINITION`. A definition with a bad `kind`, a missing `create` or an unknown `pane` throws `INVALID_INDICATOR_DEFINITION`.

Registering a kind does not add it to the chart. Pass plugin objects in `indicators` for the indicators a new chart starts with, or add them with commands.

## What the widget shows

The Indicators menu lists every kind that is not `hidden`, read from `inspect().indicatorKinds`. Built-in kinds are grouped under Trend, Momentum, Market regime and Order flow. Your kinds are listed under Other. Typing in the search box filters on name, kind and description.

Clicking a kind sends `indicator.add` with only the `kind`, so the indicator starts with the defaults. Each indicator on the chart gets a legend row with hide, settings and remove buttons. The settings dialog builds one field per input:

| Input spec | Field |
| --- | --- |
| `options` | A select with the option names |
| `toggle: true` | A checkbox |
| `integer: false` | A number field that takes decimals |
| anything else | A number field with step 1 |

Number fields carry `min` and `max`. Each change sends `indicator.update` straight away, so every edit is one undo step.

## Commands

Three commands change indicators. All of them are undoable and saved with the layout.

```ts
chart.execute({ type: 'indicator.add', indicator: { kind: 'envelope', inputs: { period: 50, source: 1 } } });
chart.execute({ type: 'indicator.update', id: 'envelope', inputs: { middle: 0 } });
chart.execute({ type: 'indicator.update', id: 'envelope', visible: false });
chart.execute({ type: 'indicator.remove', id: 'envelope' });
```

`indicator.add` takes a `kind`, optional `inputs` and an optional `id`. Without an `id`, the runtime uses the kind, then `kind-2`, `kind-3` and so on. The result's `created` array returns the id it chose. `indicator.update` merges the inputs you pass into the current ones and validates the result.

The errors carry a path, so a form or an agent can point at the bad field:

| Code | When |
| --- | --- |
| `UNKNOWN_INDICATOR` | The kind is not registered. `details.available` lists the kinds that are. |
| `INVALID_INDICATOR_INPUT` | An input is out of range, not an integer when it should be, or not declared. The path names it, such as `indicator.inputs.percent`. |
| `INDICATOR_LIMIT_EXCEEDED` | The document already holds 16 indicators. |
| `INDICATOR_NOT_FOUND` | No indicator has that `id`. |

## Validate inputs yourself

`IndicatorRegistry` is exported, and every runtime has one at `runtime.indicatorRegistry`. Use it to check inputs in your own form or agent tool before sending a command.

```ts
import { IndicatorRegistry, type IndicatorDefinition } from 'candleframe/core';

declare const envelopeDefinition: IndicatorDefinition; // from the example above

const registry = new IndicatorRegistry([envelopeDefinition]);
registry.inputs('envelope', { percent: 1.5 }); // { period: 20, percent: 1.5, source: 0, middle: 1 }
registry.list().map(definition => definition.kind); // built-ins, then 'envelope'
registry.create('envelope', { period: 10 }, 'my-envelope'); // an IndicatorPlugin
```

`inputs` fills defaults and throws `INVALID_INDICATOR_INPUT` with a path such as `inputs.period`. `inspect().indicatorKinds` returns the same catalogue as plain data, with each kind's `name`, `description`, `pane`, `inputs` and `hidden`.

## How documents store indicators

A chart document lists its indicators in pane order. Each entry is a `DocumentIndicator`:

```json
{ "id": "envelope", "kind": "envelope", "inputs": { "period": 20, "percent": 2.5, "source": 0, "middle": 1 }, "visible": true }
```

When the runtime loads a document, it resolves each entry in this order:

1. A plugin object from the `indicators` option with the same `id`, `kind` and `inputs`. The runtime uses that object as it is.
2. A registered definition for the `kind`. The runtime calls `create` with the saved inputs.
3. Neither. The indicator is unsupported.

Saved inputs of a registered kind go through the same validation as a command. Inputs missing from the saved entry get their defaults, so adding an input to a definition keeps old layouts loading. Removing or renaming an input, or narrowing its range, makes old layouts that use it fail with `INVALID_INDICATOR_INPUT`. Keep old inputs and ignore them in `create` until those layouts are gone.

Layouts saved before indicators were stored (document versions 2 and 3) load with the indicators passed in the `indicators` option.

## Unsupported kinds

A saved indicator whose kind this chart cannot build is kept, not dropped. Its entry stays in the document with its inputs untouched, so saving the layout again does not lose it. A chart that has the definition will draw it.

You can detect these entries:

- `state().unsupportedIndicatorKinds` lists the kinds, once each.
- `inspect().indicators` marks each entry with `supported: false`.
- The widget legend shows a row named after the kind, and its settings dialog says "This indicator is unavailable here."

Unsupported entries draw nothing. You can hide or remove them, but you cannot change their inputs. The runtime accepts at most 16 numeric inputs on an unknown kind.

The same rule applies to drawings. See [Custom drawing tools](../../plugins/drawing-tools/) for `unsupportedDrawingTypes`.
