---
title: Examples
description: Runnable examples in the CandleFrame repository, what each one shows and the command that starts it.
---

The repository has a handful of small examples you can run and read. Each one below says what it shows and how to start it.

## Set up

Clone the repository and install its development dependencies. You need Node 24 or later.

```sh
git clone https://github.com/adarshzpatel/candleframe.git
cd candleframe
npm ci
```

`npm ci` also builds the library into `dist/lib` through the `prepare` script. The browser examples run on the Vite dev server, which serves the repository root:

```sh
npm run dev
```

Vite prints the address, usually `http://127.0.0.1:5173/`. The paths below are relative to it.

## The demo

[`demo/main.ts`](https://github.com/adarshzpatel/candleframe/blob/main/demo/main.ts) at `/`

The full widget filling the window, with most options turned on. It shows:

- a `markets` catalog with four sources: the trade simulation, live Binance Spot data, live [Hyperliquid perpetuals](../feeds/hyperliquid/) and a sample equity with weekend and overnight gaps,
- `storageKey` autosave, the Inspect button and `autoscaleOnPan`,
- a custom `layoutStore` that also reads layouts saved by an older version of the demo,
- a theme built with `createTheme('evergreen', ...)` and a saved appearance restored with `restoreTheme`.

Two query parameters change it. `/?offline` drops the Binance and Hyperliquid sources, so the demo works with no network. `/?trading` attaches the [trading plugin](../plugins/trading/) with a paper broker.

The demo puts the widget on `window.candleframe`, so you can try the API from the browser console:

```js
candleframe.execute({ type: 'chartType.set', chartType: 'area' });
candleframe.inspect();
```

## The smallest embed

[`examples/default.html`](https://github.com/adarshzpatel/candleframe/blob/main/examples/default.html) and [`examples/default.ts`](https://github.com/adarshzpatel/candleframe/blob/main/examples/default.ts) at `/examples/default.html`

A widget with a simulated feed and no other options. Open it to see what the widget looks like out of the box: the default theme, which follows your system's light or dark setting, and the controls it shows without `markets` or `storageKey`. It imports from `src/`, so edits to the library show up on reload.

## Two widgets on one page

[`examples/embed.html`](https://github.com/adarshzpatel/candleframe/blob/main/examples/embed.html) at `/examples/embed.html`

Bitcoin and Ethereum widgets side by side, one in the default theme and one in Paper. The page styles buttons, selects and canvases on purpose with clashing CSS, to show that the widget's shadow root keeps them out. Buttons below the charts dispose and remount the Bitcoin widget while Ethereum keeps running.

This page imports the built library from `dist/lib/index.js`, the same files a plain `<script type="module">` would load. After you change `src/`, rebuild with `npm run build:lib` before you reload.

## Headless runtime

[`examples/headless.ts`](https://github.com/adarshzpatel/candleframe/blob/main/examples/headless.ts)

```sh
npm run example:headless
```

Runs a `ChartRuntime` in Node with no DOM. It pauses the feed, sets a manual price range, exports and restores the document, adds a trend line, edits it, undoes and redoes, then prints a JSON summary of the state. [Run headless](../guides/headless/) explains each call.

## MCP server

[`examples/mcp-server.ts`](https://github.com/adarshzpatel/candleframe/blob/main/examples/mcp-server.ts)

```sh
npm run mcp
```

A Model Context Protocol server with no dependencies. It speaks JSON-RPC over stdio and lets an agent drive a headless chart with seven tools: `chart_inspect`, `chart_query`, `chart_preview`, `chart_execute`, `chart_undo`, `chart_export_layout` and `chart_restore_layout`.

It starts on simulated BTC/USD. To chart a CSV file instead, pass its path. The file needs `time`, `open`, `high`, `low` and `close` columns, and `volume` is optional.

```sh
node --experimental-strip-types examples/mcp-server.ts --csv prices.csv --symbol AAPL --interval 1d --gaps
```

To use it from Claude Code:

```sh
claude mcp add candleframe -- node --experimental-strip-types /path/to/candleframe/examples/mcp-server.ts
```

[MCP server](../agents/mcp-server/) covers the tools in detail.

## Framework integrations

The repository has no framework projects. [Framework integrations](../guides/frameworks/) has short components for React, Vue, Svelte, Angular and a plain script tag. They all follow the pattern the examples above use: create the widget on mount, dispose it on unmount.
