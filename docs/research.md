# Financial charting research

Research date: October 2, 2026. Scope: public product documentation, public repositories, and a read-only inspection of OpenMarket's guest chart and documentation. No comparative benchmarks, source audit of proprietary engines, or production reliability tests were performed.

The opportunity is a complete, extensible, openly maintained financial charting system that works both as an embeddable library and as a usable personal charting application. Existing open-source engines already solve substantial parts of this problem. The proposed project needs a clear advantage in integration, extension contracts, correctness, and ownership to justify another engine.

## What the reference product includes

TradingView's current Advanced Charts page advertises 13 chart types, more than 100 indicators, and more than 110 drawing tools. Those counts describe its current catalog, not a stable implementation specification. Its broader comparison page carries different drawing counts, so feature-level verification is more useful than copying marketing totals. [Advanced Charts](https://www.tradingview.com/advanced-charts/), [library comparison](https://www.tradingview.com/free-charting-libraries/).

Three product boundaries matter:

| Product | Verified distinction | Implication for this project |
| --- | --- | --- |
| Advanced Charts | Technical analysis and charting; the published free-use conditions require attribution and a public implementation. | Target the embeddable charting experience first. |
| Trading Platform | Adds multi-chart layouts, trading integration, market widgets, and additional chart styles. | Include these in the broader roadmap but identify their extra dependencies. |
| TradingView website | Has capabilities the embedded libraries do not provide. Its FAQ identifies Pine, alerts, bar replay, and other unsupported library features. | Scripting, replay, and hosted alert execution are separate deliverables. |

Sources: [product introduction](https://www.tradingview.com/charting-library-docs/latest/introduction/), [FAQ](https://www.tradingview.com/charting-library-docs/latest/getting_started/Frequently-Asked-Questions/).

Advanced Charts supports custom indicators authored by integrating developers in JavaScript. It does not provide Pine Script or allow end users to edit indicator source inside the library. This makes an open, embeddable indicator editor and runtime a useful long-term distinction. [Custom indicators](https://www.tradingview.com/charting-library-docs/latest/custom_studies/).

Neither Advanced Charts nor Lightweight Charts includes market data. A complete personal experience needs an example or user-configured feed, while an enterprise integration needs its own provider adapters. The software license and access to market data are separate concerns. [Product comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison/).

## Existing libraries

The assessment column is a recommendation based on the documented scope, not a benchmark result or a claim of exhaustive review.

| Project | Verified scope | License or access | Assessment |
| --- | --- | --- | --- |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Canvas financial charts; custom series, series extensions, and pane extensions through its [plugin API](https://tradingview.github.io/lightweight-charts/docs/plugins/intro). The project also ships agent skills. | Apache-2.0; its README specifies attribution and a TradingView link. | Strong rendering and interaction baseline. Building a full analysis workbench still requires substantial additional work. |
| [KLineChart](https://github.com/klinecharts/KLineChart) | Canvas financial charts, built-in indicators and drawings, extension APIs, mobile support, TypeScript definitions, and no third-party dependencies per its README. | Apache-2.0 in the public repository. | A close candidate for reuse or contribution. Test its contracts before deciding an independent engine is necessary. |
| [TradeX-chart](https://github.com/tradex-app/TradeX-chart) | Vanilla JavaScript chart, state import/export, extensibility, and indicator calculations through a WASM dependency. | GPL-3.0 in the public repository. | Useful reference for a complete vanilla chart. Its license differs from the proposed permissive distribution model; do not assume code can be copied into that model. |
| [uPlot](https://github.com/leeoniya/uPlot) | Canvas2D time-series plotting with hooks, streaming, multiple scales, and cursor synchronization. | MIT. | Useful performance reference, with a different product scope. It does not supply the desired financial analysis workbench. |
| [Apache ECharts](https://github.com/apache/echarts) | General-purpose interactive charting and visualization. | Apache-2.0. | Useful reference for a broad visualization ecosystem. A specialized trading workflow would need its own product layer. |

Public benchmark claims from these projects use their own versions, machines, and workloads. They cannot establish which engine is fastest for our requirements. Pin versions and run the same financial-chart scenarios in phase 0.

Agent-friendly documentation already exists in this market. Lightweight Charts includes integration and plugin-authoring skills, and KLineChart has an agent skill in its repository. Our advantage must extend to observable runtime state, reproducible failures, and verifiable changes. [Lightweight Charts repository](https://github.com/tradingview/lightweight-charts), [KLineChart repository](https://github.com/klinecharts/KLineChart).

## OpenMarket and TitanCharts

OpenMarket is an important product reference. Its homepage describes a proprietary chart engine and promotes order-book heatmaps, footprints, CVD, multiple chart layouts, and an integrated kScript editor with AI assistance. The inspected chart displayed a Percept link and TitanCharts-named containers. These observations point to TitanCharts; they are not a source-code audit. [OpenMarket](https://openmarket.xyz/), [guest chart](https://openmarket.xyz/chart/).

The guest chart loaded Coinbase BTC-USD data during inspection. Its indicator picker exposed official and community sections, technical and order-flow categories, and script entries labeled open source. Opening the picker verifies discovery UI, not the correctness or performance of every indicator. An open-source indicator label does not establish that the chart engine is open source. [Guest chart](https://openmarket.xyz/chart/).

The related TitanCharts documentation describes a React library with restricted npm packages, custom data feeds, indicators, drawing tools, and market replay. Its licensing page says the chart requires a valid license key to render. Its Vanilla JavaScript guide explicitly says framework-independent support is planned for a future release. That distinction matters despite the guide's opening wording about direct integration. [Documentation index](https://percept.one/llms.txt), [licensing](https://percept.one/docs/features/licensing), [vanilla integration](https://percept.one/docs/frameworks/vanilla).

OpenMarket's kScript documentation covers custom studies, multi-symbol analysis, order-book access, cross-exchange data, and strategies. It also supplies machine-readable documentation for coding assistants. These are vendor-documented capabilities; their full runtime behavior was not tested. [kScript introduction](https://openmarket.xyz/kscript/getting-started/introduction).

This changes the proposed roadmap in four ways:

1. Data contracts should accommodate trades, depth, and other series later, instead of assuming every dataset is OHLCV.
2. An object tree, command palette, useful defaults, and editable indicator settings should accompany the SDK.
3. Scripting needs access to explicitly declared data sources and timeframes, with clear calculation and repainting rules.
4. The proposed engine, document format, standard plugin SDK, and scripting runtime should remain available for self-hosting without a vendor rendering key.

We did not verify an open-source engine license or public engine repository for OpenMarket/TitanCharts. The public material reviewed describes a proprietary engine and licensed distribution. Treat it as a commercial alternative and product reference unless new licensing evidence changes that assessment.

## Proposed feature inventory

This is our proposed scope, informed by the references. A row does not imply every comparator supports every item. Phases refer to the [roadmap](roadmap.md). A feature is complete only when its data semantics, user interaction, programmatic control, persistence, and applicable tests are complete.

| ID | Feature family | Proposed coverage | First delivery / expansion |
| --- | --- | --- | --- |
| F01 | Standard series | Candles, OHLC bars, line, area, histogram, baseline, hollow candles, step line | P1 / P3 |
| F02 | Transformed series | Heikin Ashi, Renko, Kagi, line break, point-and-figure; later range, tick, and volume bars | P3 / P6 |
| F03 | Navigation | Pan, anchored zoom, crosshair, axis drag, auto-fit, follow latest, go to date, reset, synchronized views | P1 / P3 |
| F04 | Scales and panes | Multiple price axes, linear/log/percent/indexed modes, independent scales, resizable indicator panes | P1 / P3 |
| F05 | Time and instruments | Exchange zones, sessions, holidays, exceptional closes, DST, gaps, tick sizes, price precision, instrument identity | P0 contracts, P1 baseline / P3 breadth |
| F06 | Data lifecycle | Static arrays, CSV, history paging, streaming, last-bar changes, corrections, cancellation, reconnect and cache | P1 / P2 |
| F07 | Symbol comparison | Overlay comparison, aligned sessions, relative performance, normalized and independent scales, spreads | P3 |
| F08 | Core drawings | Trend line, ray, horizontal/vertical line, channel, rectangle, ellipse, text, arrow, measurement, Fibonacci retracement | P2 |
| F09 | Advanced drawings | Fibonacci families, pitchforks, Gann tools, harmonic and wave annotations, position/risk drawings, anchored studies | P3 / P6 |
| F10 | Drawing workflow | Hit testing, handles, snapping, magnets, lock/hide, groups, z-order, copy/paste, undo/redo, symbol scope | P2 / P3 |
| F11 | Technical studies | Moving averages, RSI, MACD, Bollinger Bands, ATR, VWAP; later stochastic, ADX, CCI, ROC, OBV, Ichimoku, pivots | P1 proof, P2 basics / P3 catalog |
| F12 | Indicator runtime | Warm-up, missing values, incremental calculation, open-bar rollback, corrections, dependencies, multi-timeframe and multi-symbol inputs | P1 proof / P3 |
| F13 | Indicator authoring | Trusted TS/JS plugins, metadata-based input forms, plot definitions, then restricted formulas and a script editor | P2 / P5 |
| F14 | Workbench | Symbol/interval search, toolbars, settings, command palette, favorites, object tree, context menus | P2 / P3 |
| F15 | Personal use | Static demo, CSV import, local save/restore, portable JSON, user-configured live feeds, no account needed for local use | P2 |
| F16 | Persistence and export | Versioned layouts, drawings, study presets, settings, migration, PNG export and authorized data export | P2 / P3 |
| F17 | Mobile and accessibility | Pointer/touch gestures, keyboard control, focus management, readable values, accessible data table, non-color cues, localization | P1 baseline / P2 to P4 |
| F18 | Multiple charts | Split layouts, synchronized symbol/time/cursor groups, independent subscriptions, shared data cache | P3 |
| F19 | Order flow | Order book, depth ladder and basic depth heatmap at launch; later volume profiles, bid/ask footprints, delta/CVD, TPO and trades tape | P0 prototype / P1 to P4 launch / P6 expansion |
| F20 | Derivatives and events | Funding, open interest, liquidations, earnings/dividends/splits and custom event markers | P3 generic series/events / P6 adapters |
| F21 | Replay | Deterministic bar replay; later synchronized trades/depth/event replay with recorded data | P3 bar replay / P6 market replay |
| F22 | Alerts | Client-side conditions, chart markers and host callbacks; persistent evaluation and delivery through separate services | P3 local rules / P7 services |
| F23 | Trading integration | Orders, positions, fills, draggable intent previews, account and broker adapters | P7 |
| F24 | Strategy tools | Reusable calculation runtime; later backtesting with explicit fill, cost and data assumptions | P5 foundations / P7 |
| F25 | Agent operation | Inspect state/capabilities, typed commands, schemas, dry runs, revision checks, atomic edits, structured results | P1 / P3 |
| F26 | Agent contribution | Repository map, runnable examples, contract fixtures, targeted checks, benchmark reports, migration guidance | P0 onward |
| F27 | Extensions | Versioned manifests, capability declarations, lifecycle cleanup, input validation, schema migrations, conformance suite | P1 proof / P3 SDK |
| F28 | Enterprise integration | Custom UI, strict CSP, framework bindings, localization packs, shared storage, diagnostics and deployment guidance | P2 / P4 |

Reference coverage comes from TradingView's [drawings catalog](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/), [chart controls](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Chart/), [save/load documentation](https://www.tradingview.com/charting-library-docs/latest/saving_loading/), and [time/session model](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/). The order-flow and scripting expansion also considers the OpenMarket and TitanCharts sources above. Feature priorities are our proposal.

## Difficult requirements that counts conceal

Financial correctness includes overlapping history pages, a tick changing the current candle, a correction to an older candle, holidays, and comparisons between markets with different sessions. These cases can invalidate drawings and every dependent indicator if identity and time semantics are wrong.

An indicator's output must agree between batch history and a replay of the same updates. Recalculating the open bar from committed state prevents repeated ticks from being accumulated incorrectly. Pine's documented rollback behavior is a useful reference, although this project will define its own execution model. [Pine execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/).

High-density order flow requires different data and rendering workloads from candles. Exact bid/ask footprints require suitable trade information; an OHLCV bar alone cannot reconstruct them. Historical depth replay requires recorded snapshots and ordered deltas. The UI should expose data availability and approximation status instead of inventing precision.

Web Workers can move calculations away from input handling, but they still expose APIs such as network access. Running arbitrary JavaScript in a worker does not create the restricted indicator environment we need. Scripting requires its own interpreter or isolated runtime and resource policy. [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

## Recommended position

Build an openly maintained charting engine and optional workbench with portable saved documents, a stable extension SDK, and first-class programmatic inspection. Support personal and commercial integration with the same implementation. Make local setup easy, expose the data and calculation rules, and publish reproducible performance results.

The selected launch direction is an independent WebGL2 engine with an order book and basic depth heatmap. Phase 0 measures this implementation, investigates reusable components and compares conventional chart workloads against existing engines. A proposal to extend an existing engine instead must also satisfy the launch depth-data and rendering requirements through maintainable public contracts.
