# Working on CandleFrame

CandleFrame is an agent-native charting engine and library, written in TypeScript and drawn with WebGL2. Every edit a person makes in the widget is a typed command, so an agent can make the same edit with the same validation and undo. Read `README.md` for implemented behavior and `site/src/content/docs/` for the guides.

## Commands

```sh
npm ci
npm run dev
npm test
npm run build
npm run example:headless
```

Use Node 24. The build includes type checking and emits the demo and plain JavaScript library modules. No credentials are needed. Do not commit `dist/`, `node_modules/` or generated browser artifacts.

## Code map

| Task | Entry point |
| --- | --- |
| Public types and commands | `src/types.ts` |
| Data lifecycle, documents, revisions, undo | `src/runtime.ts` |
| GPU batching and context restoration | `src/webgl-renderer.ts` |
| Shared coordinates and autoscaling | `src/geometry.ts` |
| Input events, overlays and chart lifecycle | `src/chart.ts` |
| Indicator example | `src/indicators.ts` |
| Live metadata, REST/socket reconciliation, retries | `src/binance-feed.ts`, `src/hyperliquid-feed.ts` |
| Live Hyperliquid check in the demo (needs network) | `scripts/hyperliquid-live.mjs` |
| Axis drag math | `src/scales.ts` |
| Pan momentum and displayed scale transitions | `src/pan-motion.ts`, `src/scale-motion.ts` |
| Drawing contracts, validation and tool geometry | `src/drawing-types.ts`, `src/drawing-tools.ts` |
| Drawing selection, previews, rendering and hit tests | `src/drawing-controller.ts`, `src/drawing-scene.ts` |
| Position placement, handles and settings | `src/position-drawing.ts`, `src/position-editor.ts` |
| Drawing toolbar and object properties | `src/drawing-workbench.ts`, `src/drawing-text-editor.ts` |
| Drawing templates and saved tool defaults | `src/drawing-templates.ts` |
| Theme contracts, defaults and validation | `src/themes.ts`, `src/theme-tokens.ts` |
| Theme controls and scoped CSS variables | `src/theme-editor.ts`, `src/widget-theme.ts` |
| Bundled widget typography and font licenses | `src/widget-fonts.ts`, `src/fonts/`, `scripts/copy-fonts.mjs` |
| Widget and drawing SVG icons | `src/ui-icons.ts` |
| Self-contained UI, scoped styles and market catalog | `src/widget.ts`, `src/widget-style.ts`, `src/widget-market.ts` |
| Chart grids, sync and saved layouts | `src/widget-layout.ts`, `src/chart-group.ts`, `src/chart-switch.ts`, `scripts/multi-chart.mjs` |
| Reproducible market fixture | `src/simulated-feed.ts` |
| Widget integration examples | `demo/main.ts`, `examples/embed.html` |
| Headless agent example | `examples/headless.ts` |
| Agent API: batches, preview, idempotency, query | `src/runtime.ts` (`execute`, `preview`, `query`), `docs/agents.md` |
| Command JSON Schema | `src/command-schema.ts` |
| MCP server example | `examples/mcp-server.ts` |
| Trading plugin (`candleframe/trading`): order panel, broker adapters, paper broker | `src/trading-entry.ts`, `src/trading.ts`, `src/trading-ui.ts`, `src/paper-broker.ts`, `scripts/paper-trading.mjs` |
| Docs site (Starlight), llms.txt and Markdown copies, snippet and link checks | `site/`, `site/sidebar.mjs`, `site/src/lib/markdown.ts`, `scripts/check-doc-snippets.mjs`, `scripts/check-site-links.mjs`, `scripts/site-screens.mjs`, `scripts/generate-command-docs.ts` |
| Chart types, Heikin Ashi bars | `src/chart-types.ts`, `src/webgl-renderer.ts` (`closeLine`) |
| Indicators, registry and panes | `src/indicators.ts`, `src/geometry.ts` (`paneRanges`), `src/indicator-panel.ts` |
| Intervals, session gaps and time labels | `src/intervals.ts`, `src/time-scale.ts`, `src/time-format.ts` |
| Static feed and history paging | `src/static-feed.ts`, `ChartRuntime.loadOlderHistory` |
| Structured errors | `src/errors.ts` |
| Correctness regressions | `tests/core.test.ts`, `tests/binance-feed.test.ts`, `tests/hyperliquid-feed.test.ts`, `tests/simulated-feed.test.ts` |

## Working rules

- Keep the engine framework independent. Dependencies need a concrete purpose.
- Keep widget controls and popups inside their instance's shadow root. Never query the host document for chart controls. `createChartWidget` owns UI disposal; `createChart` remains the bare engine.
- Keep theme changes in the view, outside document revisions and undo. Pass the same palette to controls, WebGL, overlays and exports. Preserve saved drawing colors and explicit indicator colors.
- Hover updates paint only the cursor canvas. Drawing previews paint only annotations. Market updates and animations repaint all layers, and PNG capture explicitly refreshes the WebGL backbuffer.
- Make user edits through `execute` or `restoreDocument`. Use `inspect` and `exportDocument` for owned copies. Never mutate borrowed subscription state.
- Keep scale animation in the view. Documents hold exact target ranges; candles, axes and hit tests share the displayed geometry. Cancel pending pan motion before replacing feeds or applying host commands, and honor reduced motion.
- Change markets with `replaceFeed`; increment the generation before disposing old callbacks.
- Drawing gestures commit once on completion; previews and selection belong to the view. Reuse projected primitives for hit testing. v3 documents preserve unavailable plugin records. See `docs/drawing-suite.md`.
- Documents identify source, symbol and interval; manual price scales persist through ticks.
- Check `documentRevision` for agent edits based on prior inspection. Streaming data has a separate revision and does not invalidate a settings edit.
- Preserve CPU state during GPU loss. A missing WebGL2 context must produce a visible error.
- Maintain bounded history. A feed that misses candles reloads history instead of sending a gap.
- Keep full market values on the CPU. GPU coordinates are rendering representations.
- Use focused correctness tests for corrections, gaps, retention and commands. Visually check rendering changes through the browser.
- Label synthetic data explicitly. Never claim browser or benchmark validation based only on unit tests.
- Treat custom indicator code as trusted host code. The current plugin contract is not a safe execution environment for user-supplied scripts.
- Do not copy proprietary chart implementations or introduce license-key dependencies.

The demo exposes `window.candleframe` for developer tools. Agents use the same API in a host integration, or drive `ChartRuntime` without a browser. `src/command-schema.ts` describes every command as JSON Schema for tool definitions, and `examples/mcp-server.ts` serves a headless chart over MCP.
