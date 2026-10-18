---
title: MCP server
description: Run the example Model Context Protocol server so an AI agent can inspect, query and edit a headless chart through tools.
---

The repository has an example MCP server at `examples/mcp-server.ts`. It runs a headless `ChartRuntime` and exposes the [agent API](../drive-the-chart/) as MCP tools over stdio.

:::note
This is an example in the repository. It is not published in the npm package and it is not a hosted service. Clone the repository to run it, and copy it into your own project to change it.
:::

## What it needs

- A clone of the CandleFrame repository.
- Node 24 or later.
- Nothing else. The server imports the library source from `src/` and Node built-ins only, so you do not need to install packages or build first.

By default it serves a simulated BTC/USD market at 1-minute bars, with a 20-bar SMA. The simulation keeps ticking while the server runs.

## Start it

From the repository root:

```sh
node --experimental-strip-types examples/mcp-server.ts
```

Or through npm:

```sh
npm run --silent mcp
```

:::caution
Use `--silent` with npm. Plain `npm run mcp` prints a banner line to stdout before the server starts, and an MCP client reads stdout as protocol messages.
:::

To serve your own bars instead of the simulation, pass a CSV file:

```sh
node --experimental-strip-types examples/mcp-server.ts --csv prices.csv --symbol AAPL --interval 1d --gaps
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--csv <path>` | none | Read bars from a CSV file instead of the simulation. |
| `--symbol <name>` | `CSV` | Symbol shown for the CSV market. |
| `--interval <interval>` | `1d` | Bar interval of the CSV, such as `1h` or `1d`. |
| `--gaps` | off | Allow gaps between bars, for markets with sessions or weekends. |

The CSV needs a header row with `time`, `open`, `high`, `low` and `close` columns, in any order and any case. A `volume` column is optional. `time` is either UTC milliseconds or a date string that `Date.parse` reads. The server sorts rows by time.

:::caution
The server loads CSV bars through `createStaticFeed`, which sends the newest 1,000 bars first and the rest only when the chart asks for older history. The example has no tool for that, so an agent sees at most the newest 1,000 bars of a longer file.
:::

## Add it to a client

The server speaks JSON-RPC 2.0 over stdio, one message per line. Point your MCP client at `node` with the absolute path to the script.

Claude Code:

```sh
claude mcp add candleframe -- node --experimental-strip-types /absolute/path/to/candleframe/examples/mcp-server.ts
```

Claude Desktop (`claude_desktop_config.json`), or a project `.mcp.json` for Claude Code:

```json
{
  "mcpServers": {
    "candleframe": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/candleframe/examples/mcp-server.ts",
        "--csv",
        "/absolute/path/to/prices.csv",
        "--symbol",
        "AAPL"
      ]
    }
  }
}
```

Leave out the `--csv` and `--symbol` arguments to serve the simulation.

## Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `chart_inspect` | none | Returns `inspect()`: market, stream health, `documentRevision`, document, indicators with latest values, indicator kinds and drawing tools. Call it first. |
| `chart_query` | `fromMs`, `toMs`, `visible`, `limit`, `indicators` | Returns `query()`: candles and aligned indicator values. |
| `chart_preview` | `commands`, `expectedRevision` | Returns `preview()`: the resulting document, or the first error. Changes nothing. |
| `chart_execute` | `commands`, `expectedRevision`, `idempotencyKey` | Calls `execute()` with the batch. Returns `documentRevision` and `created`. |
| `chart_undo` | none | Undoes the last content edit. A whole batch counts as one. |
| `chart_export_layout` | none | Returns `exportDocument()`: the layout without market data. |
| `chart_restore_layout` | `document`, `expectedRevision` | Calls `restoreDocument()`. The layout must be for the same market and interval. Returns the new `documentRevision`. |

The `commands` input of `chart_preview` and `chart_execute` is `chartCommandBatchSchema`, so the model sees every command shape in the tool list. `chart_query` does not expose `raw`.

`chart_inspect` returns the full drawing tool catalogue with every tool's settings. On the simulated market that reply is about 138 KB of JSON. Trim it in your own copy if context size matters.

## Replies and errors

A successful call returns the method's result twice: as JSON text in `content` and as an object in `structuredContent`.

A failed call returns the [`ChartError`](../../reference/errors/) JSON with `isError: true`:

```json
{
  "content": [{ "type": "text", "text": "{\"code\":\"REVISION_CONFLICT\",...}" }],
  "structuredContent": {
    "code": "REVISION_CONFLICT",
    "message": "REVISION_CONFLICT: the document changed; inspect() again and retry",
    "details": { "expected": 9, "actual": 0 }
  },
  "isError": true
}
```

An unknown tool name returns a JSON-RPC error with code `-32602`. The server answers `initialize`, `ping`, `tools/list` and `tools/call`, and ignores notifications. Its `initialize` reply carries these instructions for the model:

> Inspect first. Read candles with chart_query. Preview, then execute with expectedRevision. Errors carry a stable code and a path to the bad input.

## Check it by hand

Send `initialize` and `tools/list` on stdin and read the replies on stdout:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node --experimental-strip-types examples/mcp-server.ts
```

The first reply has `serverInfo: { "name": "candleframe", "version": "0.3.0" }`. The second lists the seven tools. The server exits when stdin closes. `tests/agent-api.test.ts` runs the same exchange plus two `tools/call` requests in `npm test`.

## Adapt it to a real feed

The server builds its chart in one line:

```ts nocheck
const runtime = new ChartRuntime(csv ? csvFeed(csv) : createSimulatedFeed({ seed: 42 }), [sma(20)]);
```

To serve real data, pass your own `FeedAdapter` instead. Any feed that works in the browser works here, as long as it runs in Node. For bars you already hold in memory, use `createStaticFeed`:

```ts
import { ChartRuntime, createStaticFeed, sma } from 'candleframe/core';
import type { Candle } from 'candleframe/core';

declare const candles: Candle[]; // ascending, UTC milliseconds at the start of each bar

const runtime = new ChartRuntime(
  createStaticFeed({ candles, interval: '1h', instrument: 'AAPL', gaps: true }),
  [sma(20)],
);
runtime.start();
```

For a live source, write a feed adapter. [Build a feed](../build-a-feed/) walks an agent through one.

Things to change before you rely on it:

- The chart lives in the server process. Its drawings and indicators are lost when the process exits. Save `exportDocument()` somewhere and pass it to `restoreDocument(document, undefined, { undoable: false })` at startup.
- One process serves one chart. Run one process per chart, or route tool calls to several runtimes yourself.
- The server has no authentication. It is meant to run as a local stdio child of your MCP client.
- Add a tool that calls `runtime.loadOlderHistory()` if the agent needs bars older than the first page.
