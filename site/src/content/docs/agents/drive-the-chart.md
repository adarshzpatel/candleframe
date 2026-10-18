---
title: Drive the chart
description: Read a chart's state, dry-run edits and apply them as atomic, undoable batches with revision checks and safe retries.
---

Every edit a person makes in the widget is a typed command. An agent sends the same commands, through the same validation and the same undo history. This page covers the methods an agent uses, the guarantees they give and the error format.

## Where the API lives

The same methods exist on three objects:

- `ChartRuntime` from `candleframe/core`. It is headless and runs in Node, workers and tests with no DOM or GPU.
- The `ChartApi` returned by `createChart` from `candleframe/chart`.
- The `ChartWidgetApi` returned by `createChartWidget` from `candleframe/widget`. It acts on the active chart, like the widget's toolbar.

| Method | What it does |
| --- | --- |
| `inspect()` | Returns the current state, the document and what can be added. |
| `query(request)` | Returns candles and indicator values for a range. |
| `preview(commands, revision?)` | Dry-runs a batch. Changes nothing. |
| `execute(commands, revision?, options?)` | Applies one command or an atomic batch. |
| `exportDocument()` | Returns the saved-layout document. |
| `restoreDocument(document, revision?, options?)` | Replaces the document with a saved one. |
| `subscribe(listener)` | Calls `listener` with the state now and after every change. |

## The agent loop

Follow these steps in order:

1. Call `inspect()`. Keep `documentRevision`. Read `indicatorKinds` and `capabilities.drawingTools` to learn what you can add.
2. Call `query()` to read the bars you are reasoning about.
3. Build a batch of commands. Call `preview(commands, documentRevision)`. If it returns `ok: false`, fix the input named by `error.path` and preview again.
4. Call `execute(commands, documentRevision, { idempotencyKey })`.
5. If `execute` throws `REVISION_CONFLICT`, the chart changed after step 1. Go back to step 1 and decide again.

```ts
import { isChartError } from 'candleframe/core';
import type { ChartCommand } from 'candleframe/core';

// 1. Inspect.
const state = runtime.inspect();
const revision = state.documentRevision;
const hasRsi = state.indicatorKinds.some(kind => kind.kind === 'rsi');

// 2. Query the latest 100 bars.
const { candles } = runtime.query({ limit: 100, indicators: false });
const low = Math.min(...candles.map(bar => bar.low));
const last = candles[candles.length - 1];

// 3. Plan and preview.
const commands: ChartCommand[] = [
  {
    type: 'drawing.add',
    drawing: { id: 'agent-support', type: 'horizontal', points: [{ timeMs: last.timeMs, price: low }] },
  },
];
if (hasRsi) commands.push({ type: 'indicator.add', indicator: { kind: 'rsi', inputs: { period: 14 } } });

const check = runtime.preview(commands, revision);
if (!check.ok) throw new Error(`${check.error.code} at ${check.error.path}`);

// 4. Execute against the revision you read.
try {
  const result = runtime.execute(commands, revision, { idempotencyKey: 'support-from-100-bar-low' });
  console.log(result.documentRevision, result.created); // for example 1, ['agent-support', 'rsi']
} catch (error) {
  // 5. Someone edited the chart since step 1. Inspect again and re-plan.
  if (isChartError(error, 'REVISION_CONFLICT')) console.log(error.details); // { expected, actual }
  else throw error;
}
```

In a single synchronous script nothing can change between `inspect` and `execute`. Conflicts happen when time passes between your read and your write, such as while a model decides what to do between tool calls, or while a person uses the widget.

## Inspect

`inspect()` returns an owned copy of the chart's state. The fields an agent needs most:

| Field | Meaning |
| --- | --- |
| `documentRevision` | Revision of the document. Pass it to `preview` and `execute`. |
| `dataRevision` | Revision of the market data. It rises with every feed update. |
| `symbol`, `feed` | The market. `feed` has `instrument`, `interval`, `intervalMs` and `gaps`. |
| `streams` | Health of the `candles` and `depth` streams. |
| `paused` | Whether the feed is paused. |
| `candleCount`, `firstCandleTimeMs`, `latestCandle` | What data is loaded. |
| `document` | The saved-layout document: viewport, price scale, chart type, layers, indicators, drawings. |
| `indicators` | Each active indicator with `id`, `kind`, `inputs`, `visible`, `pane`, `supported`, and its latest `value` and `outputs`. |
| `indicatorKinds` | Kinds you can add, with `name`, `description`, `pane` and `inputs` (label, default, min, max). |
| `capabilities.commands` | Every command type, the same list as `chartCommandTypes`. |
| `capabilities.maxBatch` | 500, the largest batch. |
| `capabilities.drawingTools` | Each drawing tool's `type`, `label`, `points`, `settings` and `placement`. |
| `history` | `canUndo` and `canRedo`. |
| `error` | Stream error messages joined into one string, or `null`. |

## Query

`query(request)` reads candles and indicator values. All fields are optional.

| Field | Default | Meaning |
| --- | --- | --- |
| `fromMs`, `toMs` | all loaded bars | Time range in UTC milliseconds, inclusive. |
| `visible` | `false` | Use the current viewport instead of `fromMs` and `toMs`. |
| `limit` | `500` | Keep at most this many bars, the newest ones. An integer from 1 to 5,000. |
| `indicators` | `true` | Include indicator values. |
| `raw` | `false` | Return the feed's bars instead of Heikin Ashi bars. Indicator values do not change. |

The result has `candles`, `indicators`, `truncated`, `firstCandleTimeMs` and `lastCandleTimeMs`. `truncated` is `true` when the range held more than `limit` bars.

Each indicator has `id`, `kind`, `name` and `outputs`. `outputs` maps each output id to an array with one value per candle, in the same order as `candles`. A value is `null` during warmup or where the indicator has no value. A 14-bar RSI starts with 14 nulls.

```ts
const { candles, indicators } = runtime.query({ visible: true });
const rsi = indicators.find(item => item.kind === 'rsi');
const latestRsi = rsi?.outputs.value.at(-1); // number | null | undefined
console.log(candles.length, latestRsi);
```

When the chart type is `heikin-ashi`, `candles` holds Heikin Ashi bars and indicators are computed from them. Pass `raw: true` to read the feed's own bars.

An invalid request throws `INVALID_QUERY` with `path` set to the bad field.

## Preview

`preview(commands, expectedRevision?)` validates a batch and applies it to a copy. It never throws. It returns one of:

```json
{ "ok": true, "document": { "version": 4, "...": "..." }, "created": ["rsi"] }
```

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INDICATOR_INPUT",
    "message": "INVALID_INDICATOR_INPUT: period must be an integer from 2 to 500",
    "path": "0.indicator.inputs.period",
    "details": { "value": 0, "min": 2, "max": 500, "integer": true, "index": 0, "type": "indicator.add" }
  }
}
```

`document` is the document the batch would produce. `created` lists the ids the batch would create. A stale `expectedRevision` returns `REVISION_CONFLICT` here too.

## Execute

`execute(input, expectedRevision?, options?)` takes one command or an array of commands. It returns `{ documentRevision, created }`. `created` lists the ids of added indicators, drawings and groups, including generated indicator ids such as `rsi` or `ema-2`.

### Batches

When you pass an array:

- The batch applies completely or not at all. If command 3 fails, commands 0 to 2 are rolled back and the error's `path` starts with `3.`.
- The batch is one undo step. One `history.undo` reverts all of it.
- `documentRevision` rises by one for the whole batch. An empty batch leaves it where it was.
- Subscribers are called once.
- A batch holds at most 500 commands.
- `history.undo`, `history.redo` and `feed.pause` cannot go in a batch. Send each one as a single command. Inside a batch they fail with `INVALID_BATCH`.

Navigation commands (`viewport.set`, `viewport.reset`, `priceScale.set`, `priceScale.reset`, `priceScale.log`) raise `documentRevision` but are not undo steps. Undo and redo keep the current viewport and price scale.

### Revisions and conflicts

Pass the `documentRevision` you read as `expectedRevision`. If the document changed since, the call throws:

```json
{
  "code": "REVISION_CONFLICT",
  "message": "REVISION_CONFLICT: the document changed; inspect() again and retry",
  "details": { "expected": 0, "actual": 1 }
}
```

Leave `expectedRevision` out only when you do not care about edits made since you last read the chart.

The chart has two revisions:

- `documentRevision` counts changes to the document: commands, undo, redo, restores and `replaceFeed`.
- `dataRevision` counts market data updates from the feed, such as history, ticks and depth.

Live ticks raise `dataRevision` only. Streaming data never invalidates a revision you read.

### Safe retries

Pass `idempotencyKey` when a call might be retried, for example after a timeout. The key is a string of 1 to 128 characters.

- If a call with this key already succeeded, a retry with the same commands returns the first result and applies nothing. This works even after the revision has moved on.
- A retry with the same key but different commands throws `IDEMPOTENCY_CONFLICT`.
- The runtime compares the commands as JSON text. Send the retry exactly as the first call, with properties in the same order.
- A call that failed does not use up its key.
- The runtime remembers the last 200 keys.

## Subscribe

`subscribe(listener)` calls `listener` with the current state right away, then after every change. It returns a function that unsubscribes.

```ts
const stop = runtime.subscribe(state => {
  console.log(state.documentRevision, state.dataRevision, state.candles.length);
});
stop();
```

The state includes `document`, `candles`, `indicators`, `streams`, `paused`, `history`, both revisions and `error`. The listener receives the runtime's own objects. Do not mutate them. `inspect()` and `exportDocument()` return copies you can keep.

## Save and restore

`exportDocument()` returns the document: viewport, price scale, chart type, layers, indicators, drawings and drawing groups. It holds no market data.

`restoreDocument(document, expectedRevision?, options?)` validates a document and replaces the current one. It is one undo step unless you pass `{ undoable: false }`, for example when loading a saved layout at startup. The document must be for the same market:

- A different symbol fails with `SYMBOL_MISMATCH`.
- A different feed id or interval fails with `MARKET_MISMATCH`.

```ts
const saved = runtime.exportDocument();
runtime.execute({ type: 'drawing.clear' });
runtime.restoreDocument(saved, runtime.inspect().documentRevision, { undoable: false });
```

A document holds at most 100 drawings and 16 indicators.

## Errors

Every failure is a `ChartError`. Its JSON form has four fields:

| Field | Meaning |
| --- | --- |
| `code` | Stable identifier, such as `DRAWING_NOT_FOUND`. Branch on this. |
| `message` | Text for people. It starts with the code. |
| `path` | Dotted location of the bad input, when there is one. In a batch it starts with the command index. |
| `details` | Extra data, such as `available` indicator kinds or the `expected` and `actual` revisions. In a batch it also has `index` and `type`. |

`preview` returns this JSON as `error`. `execute`, `query` and `restoreDocument` throw the `ChartError` itself. Use `toChartError` to turn anything caught into a `ChartError`, then `toJSON()` to send it to a model:

```ts
import { toChartError } from 'candleframe/core';

try {
  runtime.execute({ type: 'drawing.remove', id: 'missing' });
} catch (error) {
  const failure = toChartError(error).toJSON();
  console.log(failure.code, failure.path); // DRAWING_NOT_FOUND id
}
```

Codes worth handling in an agent:

| Code | What to do |
| --- | --- |
| `REVISION_CONFLICT` | Inspect again and re-plan. |
| `IDEMPOTENCY_CONFLICT` | Use a new key for a new set of commands. |
| `UNKNOWN_INDICATOR` | Pick a kind from `details.available`. |
| `INVALID_INDICATOR_INPUT` | Use a value inside `details.min` and `details.max`. |
| `INVALID_VIEWPORT` | Pick a range between `details.minBars` and `details.maxBars` bars wide. |
| `DRAWING_NOT_FOUND`, `INDICATOR_NOT_FOUND`, `DRAWING_GROUP_NOT_FOUND` | Read the ids from `inspect().document` again. |
| `DRAWING_LOCKED` | Unlock the drawing with `drawing.update` before moving its points. |

The [errors reference](../../reference/errors/) lists every code.

## JSON Schemas

`candleframe/core` exports JSON Schemas (draft 2020-12) for commands:

- `chartCommandSchema` describes one command.
- `chartCommandBatchSchema` describes an array of at most 500 commands.
- `chartCommandTypes` lists the 25 command type names.

Use the batch schema as a tool's input schema so the model sees every command shape. The schema checks shapes only. The runtime still checks everything that depends on state, such as whether an id exists.

```ts
import { chartCommandBatchSchema, chartCommandTypes } from 'candleframe/core';

const executeTool = {
  name: 'chart_execute',
  description: 'Apply a batch of chart commands atomically.',
  inputSchema: {
    type: 'object',
    required: ['commands'],
    properties: { commands: chartCommandBatchSchema, expectedRevision: { type: 'integer' } },
  },
};
console.log(executeTool.name, chartCommandTypes.length); // chart_execute 25
```

The [commands reference](../../reference/commands/) lists every command with its properties and an example. The [MCP server](../mcp-server/) page shows these methods exposed as tools.
