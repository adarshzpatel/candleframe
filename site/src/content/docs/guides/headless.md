---
title: Run headless
description: Use ChartRuntime from candleframe/core to load data, run commands and save documents in Node with no DOM or GPU.
---

`ChartRuntime` is the state engine under every chart. It holds candles, indicators, drawings, the viewport and undo history, and it runs the same commands as the browser chart. It has no DOM or GPU code, so it runs in Node, a worker, a test or an agent server. This page walks through its lifecycle.

```ts
import { ChartRuntime, createSimulatedFeed, sma } from 'candleframe/core';

const runtime = new ChartRuntime(createSimulatedFeed({ seed: 42 }), [sma(20)]);
try {
  runtime.start();
  const state = runtime.inspect();
  console.log(state.symbol, state.candleCount, state.latestCandle?.close);
} finally {
  runtime.dispose();
}
```

The constructor takes a feed, optional indicator plugins and optional settings (`maxCandles`, `drawingTools`, `indicatorDefinitions`). Nothing connects until you call `start()`.

The repository has a longer version of this in [`examples/headless.ts`](https://github.com/adarshzpatel/candleframe/blob/main/examples/headless.ts). Run it with `npm run example:headless`.

## Start and stop

`start()` connects the feed. The simulation and `createStaticFeed` send their history during `connect`, so candles are there as soon as `start()` returns. A network feed fills in later, and you would wait for it with `subscribe`.

The simulation keeps ticking on a timer. Node will not exit while a runtime holds a live feed, so always call `dispose()`, as in the `try`/`finally` above. To freeze the data while you work, pause the feed:

```ts
runtime.execute({ type: 'feed.pause', paused: true });
```

## Run commands

`execute` takes one command, or an array that applies as one atomic batch and one undo step. It returns the new `documentRevision` and the ids of anything it created.

```ts
const { documentRevision, created } = runtime.execute([
  { type: 'indicator.add', indicator: { kind: 'rsi', inputs: { period: 14 } } },
  { type: 'priceScale.log', enabled: true },
]);
console.log(documentRevision, created); // created holds the new indicator's generated id
```

If any command in a batch fails, nothing changes and the method throws a `ChartError`. Its `path` starts with the index of the failing command.

Pass the revision you last saw as the second argument. If the document changed since then, `execute` throws `REVISION_CONFLICT` instead of applying your edit on top of someone else's.

```ts
const before = runtime.inspect();
runtime.execute({ type: 'priceScale.set', minPrice: 67_000, maxPrice: 69_000 }, before.documentRevision);
```

`preview` dry-runs commands. It never throws. It returns the document the commands would produce, or the first error.

```ts
const result = runtime.preview([{ type: 'drawing.clear' }]);
if (result.ok) console.log(result.document.drawings.length);
else console.log(result.error.code, result.error.message);
```

To make retries safe, pass an `idempotencyKey`. A second call with the same key and the same commands returns the first result without applying them again.

```ts
runtime.execute({ type: 'history.undo' }, undefined, { idempotencyKey: 'undo-1' });
```

[Commands](../../reference/commands/) lists every command.

## Read data

`query` returns candles with indicator values aligned to them. Warmup and missing values are `null`.

```ts
const latest = runtime.query({ limit: 100 }); // The newest 100 bars.
const visible = runtime.query({ visible: true }); // The current viewport.
const range = runtime.query({ fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2026, 0, 2) });

for (const indicator of latest.indicators) console.log(indicator.kind, indicator.outputs);
```

| Field | Meaning | Default |
| --- | --- | --- |
| `fromMs`, `toMs` | Time range in UTC milliseconds. | All loaded bars |
| `visible` | Use the current viewport instead of `fromMs` and `toMs`. | `false` |
| `limit` | Newest bars kept when the range holds more. 1 to 5,000. Sets `truncated` when it cuts. | 500 |
| `indicators` | Include indicator values. | `true` |
| `raw` | Return the feed's bars instead of Heikin Ashi bars when that chart type is on. | `false` |

`inspect()` returns a full copy of the state: the feed descriptor, stream health, `documentRevision`, the latest candle, undo availability, the document and each indicator's latest value. It also lists what you can add: `capabilities.commands`, `capabilities.drawingTools` and `indicatorKinds`. Agents should call it first.

## Save and restore documents

A document is the chart's saved state as plain JSON: viewport, price scale, chart type, layers, indicators and drawings. Candles are not part of it.

```ts
const saved = runtime.exportDocument();
const json = JSON.stringify(saved);

runtime.execute({ type: 'drawing.clear' });
runtime.restoreDocument(JSON.parse(json));
```

`restoreDocument` validates the input before it changes anything. A document belongs to one market. Restoring one saved for another symbol throws `SYMBOL_MISMATCH`, and another source or interval throws `MARKET_MISMATCH`. Restores are undoable by default. Pass `{ undoable: false }` as the third argument to load without adding an undo step.

`parseDocument` from `candleframe/core` runs the same validation without a runtime. [Save layouts](../layouts/) covers documents in the widget.

## Subscribe

`subscribe` calls your listener at once with the current state, then after every data or document change. It returns a function that removes the listener.

```ts
const stop = runtime.subscribe(state => {
  console.log(state.candles.length, state.stream.status, state.documentRevision);
});
stop();
```

The state passed to listeners is shared, not copied. Read it, but do not change it. Use `inspect()` or `exportDocument()` when you need a copy you can keep.

## Dispose

```ts
runtime.dispose();
```

`dispose` closes the feed connection, drops listeners and clears undo history. Calling it twice is harmless. After `dispose`, `start`, `execute`, `query`, `subscribe` and `restoreDocument` throw `DISPOSED`.

## Next

- [Drive the chart](../../agents/drive-the-chart/) uses these methods from an agent.
- [MCP server](../../agents/mcp-server/) exposes a headless runtime over the Model Context Protocol.
- [Static data](../../feeds/static-data/) loads your own candles.
