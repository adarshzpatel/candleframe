# Driving a chart from an agent

Every edit a person makes in the widget is a typed command, so an agent can make the same edits with the same validation and undo. This page covers the loop, the error contract and the MCP server.

## The loop

1. `inspect()` returns the market, stream health, `documentRevision`, the viewport, indicators with their latest values, drawings, and what can be added (`indicatorKinds`, `capabilities.drawingTools`, `capabilities.commands`).
2. `query({ fromMs, toMs })` returns candles and indicator values for a range. Use `{ visible: true }` for what the user sees, or `{ limit: 100 }` for the latest bars. Values line up with `candles`; `null` means warmup.
3. `preview(commands, revision)` dry-runs a batch and returns the document it would produce, or the first error. Nothing changes.
4. `execute(commands, revision, { idempotencyKey })` applies the batch. It returns `{ documentRevision, created }`; `created` holds generated indicator ids and new drawing ids.

```ts
const { documentRevision, document } = chart.inspect();
const latest = chart.query({ limit: 1 }).candles[0];
const result = chart.execute(
  [
    { type: 'indicator.add', indicator: { kind: 'rsi', inputs: { period: 14 } } },
    { type: 'drawing.add', drawing: { id: 'support', type: 'horizontal', points: [{ timeMs: latest.timeMs, price: 64000 }] } },
    { type: 'priceScale.log', enabled: true },
  ],
  documentRevision,
  { idempotencyKey: 'setup-1' },
);
```

## Guarantees

- **Atomic batches.** A batch either applies completely or not at all. It is one undo step and raises `documentRevision` by one. Subscribers see one update.
- **Optimistic concurrency.** Pass the revision you read. If the user edited the chart since, the call fails with `REVISION_CONFLICT` and `details: { expected, actual }`; inspect again and decide. Live ticks change `dataRevision`, not `documentRevision`, so streaming data does not invalidate your edit.
- **Safe retries.** With `idempotencyKey`, sending the same commands again returns the first result without applying them twice. Reusing a key for different commands fails with `IDEMPOTENCY_CONFLICT`. The runtime remembers the last 200 keys.
- **Not in batches.** `feed.pause`, `history.undo` and `history.redo` act on their own.

## Errors

Every failure is a `ChartError` with a stable `code`, a `path` to the bad input and `details`. In a batch, the path starts with the command index:

```json
{
  "code": "INVALID_INDICATOR_INPUT",
  "message": "INVALID_INDICATOR_INPUT: period must be an integer from 2 to 500",
  "path": "0.indicator.inputs.period",
  "details": { "value": 0, "min": 2, "max": 500, "integer": true, "index": 0, "type": "indicator.add" }
}
```

Codes worth handling: `REVISION_CONFLICT` (re-read), `UNKNOWN_INDICATOR` (`details.available` lists kinds), `INVALID_VIEWPORT` (`details.minBars`/`maxBars`), `DRAWING_LOCKED`, `DRAWING_NOT_FOUND`, `INDICATOR_NOT_FOUND`, `MARKET_MISMATCH`.

## Schemas

`chartCommandSchema` and `chartCommandBatchSchema` are JSON Schema (draft 2020-12) for the command union. Use them as tool input schemas or to validate requests before they reach the chart. The runtime still checks everything that depends on state, such as whether an id exists.

## MCP server

`examples/mcp-server.ts` exposes a headless chart over the Model Context Protocol, with no dependencies. It serves the simulation by default, or a CSV with `time,open,high,low,close[,volume]` columns:

```sh
npm run mcp                                                    # simulated BTC/USD
node --experimental-strip-types examples/mcp-server.ts --csv prices.csv --symbol AAPL --interval 1d --gaps
claude mcp add candleframe -- node --experimental-strip-types "$PWD/examples/mcp-server.ts"
```

Tools: `chart_inspect`, `chart_query`, `chart_preview`, `chart_execute`, `chart_undo`, `chart_export_layout` and `chart_restore_layout`. The execute and preview tools embed the batch schema, so the model sees every command shape. Failures come back as the `ChartError` JSON with `isError: true`.

## Headless use

`ChartRuntime` runs the same documents and commands without a DOM or GPU. Use it for tests, servers and agents that never render. `examples/headless.ts` shows the basics.
