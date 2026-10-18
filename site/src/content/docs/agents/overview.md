---
title: CandleFrame for agents
description: How AI agents read these docs, drive a chart at runtime and build integrations such as feeds.
---

Agents work with CandleFrame in three ways:

1. A coding agent reads these docs to write code that uses CandleFrame.
2. An agent drives a live or headless chart at runtime through typed commands.
3. An agent builds an integration, such as a feed adapter for a new data source.

An agent changing CandleFrame itself should start with [`AGENTS.md`](https://github.com/adarshzpatel/candleframe/blob/main/AGENTS.md) in the repository. It has the commands, the code map and the project's rules.

## Read the docs as Markdown

Every page on this site is also served as plain Markdown. Take the page's path, drop the trailing slash and add `.md`:

| Page | Markdown |
| --- | --- |
| `/candleframe/feeds/overview/` | `/candleframe/feeds/overview.md` |
| `/candleframe/agents/drive-the-chart/` | `/candleframe/agents/drive-the-chart.md` |

Two more files cover the whole site:

- `/candleframe/llms.txt` is an index of every page with a link to its Markdown.
- `/candleframe/llms-full.txt` is every page in one file.

Fetch `llms.txt` first and then only the pages you need. Use `llms-full.txt` when you want everything in one request and have the context for it.

TypeScript examples on these pages are typechecked against the library source before the site deploys, so their imports and signatures match the code.

## Drive a chart at runtime

Every edit a person makes in the widget is a command such as `{ "type": "indicator.add", "indicator": { "kind": "rsi" } }`. An agent sends the same commands, with the same validation and undo history. The same API works on the browser widget, a bare chart and a headless `ChartRuntime` in Node.

The loop is short. Inspect the chart, query the bars you need, preview a batch of commands, then execute it against the revision you read. Batches are atomic and undo as one step. Failures come back as JSON with a stable `code` and a `path` to the bad input.

- [Drive the chart](../drive-the-chart/) covers the API, revisions, retries and errors.
- [MCP server](../mcp-server/) runs the example server that exposes a headless chart as MCP tools.
- [Commands](../../reference/commands/) lists every command with its properties and a JSON example.
- [Errors](../../reference/errors/) lists every error code.

## Build an integration

The most common integration is a feed: an adapter that turns a data source, such as an exchange socket or your own API, into candles the chart can draw.

- [Build a feed](../build-a-feed/) is a step-by-step guide for an agent writing a feed adapter.
- [Feeds](../../feeds/overview/) explains the feed contract.
