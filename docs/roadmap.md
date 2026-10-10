# Development roadmap

Proposal dated October 2, 2026. This roadmap incorporates the requested personal and enterprise audiences, TypeScript source compiled to framework-free JavaScript, adapter-based integration, and research into TradingView, existing open-source engines, and OpenMarket/TitanCharts.

Launch with a WebGL2 chart engine, an order book, a basic depth heatmap and a usable workbench. Establish public extension contracts, then expand the feature catalog and scripting. Full Advanced Charts breadth and the wider order-flow catalog remain a continuing program. The [v0.3 PoC](poc.md) now implements a WebGL2 chart, independent candle/depth streams, a public Binance adapter, market switching, axis dragging, SMA and a [30-tool drawing suite](drawing-suite.md) with shared editing, history and plugin definitions. This advances the drawing catalog ahead of the staged plan below; the broader release gates remain open. The synthetic heatmap has been removed from the demo; its optional engine experiment remains for later recorded-data validation. P0 remains open; no comparative benchmark has been measured.

## Product commitments

- One engine supports a ready-made workbench and custom application UIs.
- The distributed engine and default UI have no React, Vue, Svelte, or Angular runtime requirement.
- Personal use supports local data, local saved work, and a setup that requires no account.
- Companies can bring their own data, storage, branding, UI and later trading services.
- Core charting, standard extensions, saved formats and the planned indicator runtime remain open source.
- Agents can inspect state and make structured changes through the same operations as the UI.
- Performance and financial correctness have published tests and measurements.
- WebGL2 is the launch renderer; the initial order-book and heatmap path must be validated before launch. Canvas2D text/overlays are optional implementation tools. A full Canvas2D fallback and Rust/Wasm are not launch requirements.

Propose Apache-2.0 for project-owned code and standard plugins. Confirm the license choice before release and maintain a dependency/notice inventory. Do not introduce a rendering license key or an advanced-feature paywall into the core. Funding options include sponsorship, integration support, hosted services and separately supplied data, with the license and availability of each component stated clearly.

## Release sequence

The durations below are planning estimates for 2 to 3 experienced engineers with part-time design and testing support. They assume sustained work, a bounded first release, and no major renderer rewrite. Estimates are phase durations, not promises or measured velocity. Phase 0 should replace them with estimates based on actual work.

| Phase | Estimated duration | Deliverable | Exit gate |
| --- | --- | --- | --- |
| P0: Research validation and contracts | 2 to 3 weeks | WebGL2 prototype, depth fixtures, API sketch, comparison baselines and resource budgets | Demonstrate candles, reconstructed depth and a heatmap with recorded evidence and explicit unresolved risks |
| P1: Core chart alpha | 8 to 12 weeks | WebGL2 chart, data lifecycle, order book, rolling depth heatmap, panes/scales, commands and minimal plugin proof | Chart and depth correctness fixtures pass; interaction and recovery meet agreed budgets |
| P2: Usable personal workbench | 6 to 8 weeks | Toolbars, order-book ladder, heatmap controls, core drawings/studies, import/save/export, mobile and keyboard workflows | A new user completes the main chart and depth analysis workflows without application code |
| P3: Embedding beta and extension SDK | 8 to 12 weeks | Stable candidate contracts, richer studies/drawings, multi-chart, comparison, replay, agent tooling | Two independent integration examples and outside plugin authors use public APIs successfully |
| P4: Version 1 release | 4 to 6 weeks | Browser/accessibility quality, migrations, documentation, release and support policy | Published acceptance matrix, benchmark report, upgrade tests and no unresolved critical defects |
| P5: Easy indicator scripting | 8 to 12 weeks | Restricted formula/runtime, editor, examples and optional agent bridge | Correct, bounded execution with repeatable diagnostics and data rules |
| P6: Advanced analysis and order flow | 10 to 16+ weeks | Specialized chart types, advanced drawings, footprints/profiles, richer heatmaps and market replay | Required data exists; results agree with reference fixtures under gaps and corrections |
| P7: Trading and hosted services | Separate estimates | Broker adapters, persistent alerts, strategy execution/backtesting, optional collaboration | Each service has its own correctness, recovery and deployment requirements |

With the expanded launch scope, P0 through P4 provisionally totals 28 to 41 weeks, approximately 7 to 10 months for the team assumption above. This replaces the earlier candle-focused estimate and assumes one documented live depth provider plus bounded heatmap history. Re-estimate after P0. A solo implementation should expect a substantially longer path, provisionally 12 to 24+ months to a comparably supported release. Broad feature parity plus scripting and advanced order flow is plausibly a 12 to 24+ month team effort. These are scope estimates, not measured velocity or delivery commitments.

P5 and P6 can overlap after P3 when different maintainers own the work. Their data and execution contracts must still be anticipated in P0. P7 does not block a useful library release.

## P0 Research validation and contracts

Freeze a dated feature inventory from the [research](research.md), including the comparator product, documentation link, data requirements and acceptance scenario for each feature. Track support as absent, experimental, usable, or stable. Marketing counts do not determine completion.

Build the selected independent WebGL2 prototype. Use KLineChart and Lightweight Charts as baselines on supported conventional-chart scenarios and evaluate reusable components. Mark unsupported depth workloads explicitly. A complete Canvas2D renderer is not needed for this comparison.

The experiment includes candles, volume, one stateful indicator, one editable trend line, symbol switching, a saved document, one scripted inspection/edit, an order book reconstructed from snapshots/deltas, and a rolling depth heatmap. Pin candidate versions and record licenses. Test both continuous trading and a session-based instrument with a DST transition; depth fixtures include duplicates, sequence gaps and resynchronization.

Record reuse opportunities without exposing upstream state in the public contracts. Revisit the independent-engine choice only if evidence shows an existing engine satisfies the full launch workload through maintainable public APIs with a material advantage. A fork is a separate maintenance commitment and needs its own rationale.

Define representative desktop and mobile devices, browser versions, dataset provenance and budgets. Measure WebGL2 batching, texture updates, memory, text composition and optional worker boundaries. Exercise context loss, restoration and unavailable-WebGL2 behavior. Produce an architecture decision record with benchmark artifacts and known gaps.

Gate: a reproducible WebGL2 chart/depth result, resource budgets, and a limited first-release contract. No claim of being faster than TradingView or OpenMarket without a comparable, permitted measurement.

## P1 Core chart alpha

Deliver candles, OHLC bars, line, area and volume histogram; crosshair; pan/zoom; autoscale; axes; multiple panes; resize and pixel-density handling. Add linear and log scale behavior, explicit invalid-domain handling, and keyboard navigation of values.

Implement static data and a deterministic streaming fixture adapter. Normalize instrument/time metadata, history pages, last-bar replacement, corrections, cancellation, reconnects and stale-result rejection. Include an exchange-session fixture even if the first live example uses a continuous crypto feed.

Add snapshot/delta order-book reconstruction and a bounded rolling depth heatmap. Use explicit time/price aggregation and quantity units. Show gaps as unavailable data and resynchronize before trusting subsequent depth. Retain canonical state through GPU context loss; rebuild rendering resources on restoration. Report unsupported WebGL2 clearly.

Prove plugins through a candle series, editable trend line and EMA or SMA. Do not fill the catalog yet. Establish versioned documents, stable IDs, read-only inspection, commands, disposal, and a headless calculation entrypoint.

Gate: batch calculation agrees with streaming and corrected-history replay; pan and crosshair interaction meet the selected budget; mount/dispose cycles do not accumulate listeners, workers or subscriptions. A symbol switch cannot display data from a cancelled request.

## P2 Usable personal workbench

Ship a static-hostable reference application with built-in demo data, CSV import, a provider configuration path, local persistence and portable JSON export/import. Clearly identify simulated, delayed or unavailable data. A free library does not guarantee a free market-data service.

Add symbol/interval search, theme settings, searchable indicator picker, drawing toolbar, selected-object settings, context menus, favorites and an initial object tree. Touch controls, keyboard focus, labels and readable values belong in this release.

Add a readable order-book ladder, heatmap visibility/intensity controls, data-availability status, and one documented live depth adapter. Offline fixtures keep these workflows usable without credentials. Label whether history comes from provider records or observations captured since connection.

Target 10 to 12 core drawing tools and 6 to 8 common studies. Prioritize trend lines, horizontal/vertical lines, rays, rectangles, text, measurements, channels and Fibonacci retracement. Prioritize SMA/EMA, RSI, MACD, Bollinger Bands, ATR and VWAP. Count a tool only when editing, undo, persistence and restoration work.

Implement selection, snapping, lock/hide, copy/paste, undo/redo, drawing cleanup, and PNG export. Share schemas between settings forms and programmatic operations. Local storage should not perform synchronous writes during pointer movement.

Gate: a user can open/import data, navigate, add and configure a study, draw and edit a line, undo, save, reload and export. Verify the same workflow with mouse, keyboard and touch where applicable. The basic path must not require an account or API key.

## P3 Embedding beta and extension SDK

Publish a candidate plugin SDK, adapter conformance suite, versioned schemas and public lifecycle rules. Add a plugin starter and provider examples. Ship vanilla integration plus thin examples or bindings for React, Vue and Svelte; framework dependencies stay outside the engine.

Expand toward 20 to 30 verified studies and 25 to 40 drawing tools, selected by users. Add scale modes, comparisons, synchronized chart groups, shared data subscriptions, richer object management, study presets, and document migrations. Deliver Heikin Ashi before the more complex non-time-based chart transforms.

Add deterministic bar replay over the existing data lifecycle, and local alert conditions with host callbacks. Clearly state that browser-local evaluation stops when the browser is unavailable. Persistent alert delivery belongs to P7.

Extend calculation dependencies to multi-timeframe and multi-symbol inputs with explicit alignment, warm-up and confirmation rules. These contracts prepare scripting even though an end-user language is not shipped yet.

Deliver generated agent documentation, command schemas, atomic document edits, dry runs, structured errors, data inspection and reproducible bug fixtures. Do not require a language model to use these capabilities.

Gate: build one personal workbench and one custom enterprise-style host UI with different feeds and storage adapters. A contributor adds an indicator and a drawing without importing internal modules. Saved documents preserve unknown plugin objects and report unsupported features. Documentation examples execute in CI.

## P4 Version 1 release

Complete the supported browser matrix for Chromium, Firefox and WebKit, including real mobile checks. Verify strict CSP deployment, server-rendered import safety, resize, page visibility changes, input conflicts, locale formatting and right-to-left layout behavior where claimed.

Include WebGL2 initialization failure, forced context loss/restoration, GPU resource disposal, heatmap retention limits, depth gap recovery and the combined chart/heatmap interaction workload in launch acceptance.

Audit keyboard access, screen-reader paths to OHLC and study values, dialog focus, contrast and non-color cues. State the tested accessibility scope. Automated checks alone do not establish usable chart interaction.

Publish numerical reference fixtures, performance methodology/results, supported feature matrix, package compatibility table, migration policy, changelog and contributor guide. Keep code examples versioned alongside their API. Add a release smoke test that installs the built package into a fresh project.

Gate: no known critical data-corruption, teardown or interaction defects; release budgets pass on supported reference devices; old saved documents migrate predictably; public APIs have a deprecation policy. Stability is the release criterion, not reaching 100 indicators.

## P5 Easy indicator scripting

Start with a small authoring experience that combines named data series, typed inputs, familiar mathematical expressions and plot declarations. Reuse the P3 calculation graph rather than building a second study engine.

Ship syntax checking, completion, inline diagnostics, error locations, console/value inspection, versioned examples and an explicit resource model. Separate trusted developer plugins from user-authored restricted scripts. Expose data access through declared capabilities, with quotas and cancellation.

Specify historical versus live execution, provisional values, missing data, higher-timeframe alignment, persistence and correction behavior. Validate whole-history results against incremental and replayed execution. Test infinite loops, excessive allocations, excessive plot objects and cancellation.

An optional CLI or MCP bridge can inspect capabilities, validate a script, run it on a fixture, apply it and return diagnostics. Host applications control access. AI-assisted authoring can use any model; the runtime does not depend on one provider.

Gate: a user writes a basic moving-average study with inputs and plots, receives precise errors for invalid code, and sees reproducible results without access to unrestricted application APIs. Pine compatibility remains a separate future proposal.

## P6 Advanced analysis and order flow

Expand transformed bars and specialized drawings according to the feature inventory. For each transform, document whether underlying ticks or lower-resolution bars are required and how provisional history can change.

Expand the launch order-book and heatmap path with profiles, footprints, TPO, CVD, longer historical heatmaps and synchronized market replay in dependency order. Begin each extension with deterministic fixtures before promising a particular live provider. Preserve snapshot/delta recovery and retention rules across additional venues. Footprint and delta tools need reliable volume-side semantics; label inferred classifications.

Extend the launch WebGL2 backend for the denser plots. Evaluate another backend or Wasm computation only if measurements identify a worthwhile benefit. Keep public plugin and data contracts independent of GPU internals and document backend-specific extensions.

Gate: visual and numeric results agree with reference data; reload, gaps and replay recover consistently; rendering remains responsive under the documented density. Do not substitute a visually plausible heatmap for a validated dataset.

## P7 Trading and services

Treat these as optional projects with independent deployment and failure models:

- Broker adapters and order/position/fill overlays, with explicit order intents, host confirmation policy, idempotency and reconciliation against broker state.
- Persistent alert evaluation and delivery, including restart recovery, deduplication and missed-data policy.
- Backtesting and strategy services with recorded data versions, costs, fills, funding and ambiguity assumptions. Chart replay alone is not a realistic execution simulator.
- Shared workspaces and collaboration, with conflict resolution and access control.
- Optional hosted data or plugin discovery services, while retaining local/offline use of the library.

The first release does not need social feeds, screeners, a hosted broker platform, an indicator marketplace or an AI chatbot. Keep them in the broader product backlog without making them engine dependencies.

## Proposed performance budgets

All numbers below are initial engineering targets, not measured results. Phase 0 records exact hardware, browser builds, renderer, package version, viewport, pixel ratio, warm/cold conditions and enabled features. Use the same inputs and behavior when comparing projects; mark unsupported workloads rather than approximating them silently.

| Scenario | Initial proposed gate |
| --- | --- |
| Desktop interaction: 100,000 resident bars, up to 2,000 visible, 3 panes, 5 common studies, 50 drawings, 1440 by 900 CSS pixels at DPR 2 | p95 chart work per active frame at or below 8 ms; fewer than 1% frame intervals above 33.3 ms during a 60-second interaction sequence on a 60 Hz reference device |
| Pointer input to displayed crosshair under the desktop workload | p95 at or below 50 ms, measured across event handling and presentation rather than only handler duration |
| Streaming: 1,000 ordered updates per second across 10 series for 60 seconds | No incorrect or lost canonical updates; bounded queues; display work coalesced to frames; desktop interaction budget still holds |
| First useful render with 10,000 already available bars | At or below 150 ms on the reference desktop; report parsing, ingestion and render components separately; network excluded |
| Mobile baseline: 20,000 resident bars, 2 panes, 3 studies, 20 drawings | p95 chart work at or below 16 ms on a named mid-range device; no repeated library-owned long tasks above 50 ms during normal interaction |
| Teardown and repeated mount, fixed data | No retained chart listeners/workers/subscriptions after disposal; post-GC retained-memory trend does not grow monotonically across 100 cycles |
| Launch depth workload | Initial fixture: 1,000 maintained levels per side, 100 delta messages per second with 20 level changes per message, and a 1,024 by 512 time/price heatmap grid; pan/zoom and crosshair meet the desktop interaction budget, with bounded queues and declared aggregation |
| Core distribution | Establish a WebGL2 bundle budget in P0, including shaders and any text assets; report core, depth plugin, workbench and full preset sizes separately. The earlier Canvas2D-based 70 KB target is withdrawn pending measurement. |

Stress cases add one million resident bars, an overview with heavy aggregation, four synchronized charts, 500 drawings, prolonged streaming, background/resume, rapid symbol changes, and historical corrections. Publish their measurements separately from the normal acceptance workload. One million stored bars does not mean one million independently drawn candles per frame.

Memory budgets must account for canonical arrays, indexes, object overhead, worker copies, render caches and GPU allocations. A million rows of six Float64 fields already occupies 48,000,000 bytes before that overhead. Set a measured memory ceiling in P0 rather than advertising an arbitrary total.

Use dedicated reference runs for regression decisions. Shared CI can check bundle size, correctness and broad performance regressions, but noisy timing alone should not block or bless a release. Pin the comparison conditions and retain raw results.

## Quality and acceptance model

Each shipped feature needs applicable checks across five dimensions:

| Dimension | Evidence |
| --- | --- |
| Financial semantics | Independent numerical fixtures; batch/live/correction equivalence; sessions, gaps, precision and missing values |
| User interaction | Visible browser workflows, selection/drag behavior, undo, accessibility and mobile behavior |
| Extension compatibility | Public API integration and conformance tests for adapters/plugins |
| Persistence | Save/reload, migration, unknown objects and conflict handling |
| Performance | Representative frame, latency, memory and lifecycle measurements |

Use meaningful regression tests for behavior. Avoid tests that merely assert the same constants as the implementation. Visual regression needs stable fonts, fixture data, viewport and clock; numerical correctness needs an independent reference, not only image comparison.

## First implementation backlog

These are proposed tasks after the research review, not work performed in this repository yet.

| ID | Task | Depends on | Completion evidence |
| --- | --- | --- | --- |
| R01 | Write product boundaries and public API examples | This proposal | Personal, custom UI and automation examples use one coherent model |
| R02 | Create feature catalog with comparator references | R01 | Every scoped family has acceptance criteria and a phase |
| R03 | Specify bar, instrument, interval, depth and drawing identities | R01 | Fixture cases cover DST, session dates, duplicate times, history insertion and depth sequencing |
| R04 | Define commands, document schema and plugin manifest | R01, R03 | Validation rejects invalid commands and preserves unknown plugin records |
| R05 | Build deterministic bar and depth feed fixtures | R03 | Replaying updates yields expected bars and books; depth gaps force resynchronization |
| R06 | Pin baseline engines and benchmark protocol | R02, R05 | Reproducible installs, license inventory, device list and scenario definitions |
| R07 | Build the WebGL2 chart and depth slice | R03 to R06 | Candles, indicator, editable line, book, heatmap, inspect and save/restore work |
| R08 | Exercise comparable scenarios on baseline engines | R04 to R06 | Supported comparisons, public-API gaps and unavailable workloads are recorded explicitly |
| R09 | Validate rendering, resource and recovery design | R07, R08 | Decision record includes raw results, context recovery and remaining bottlenecks |
| R10 | Scaffold package structure and docs | R09 | Plain HTML quickstart and headless calculation example run locally |
| R11 | Complete ingestion, cancellation and teardown | R10 | Stale loads, history/live overlap and repeated disposal fixtures pass |
| R12 | Publish the alpha acceptance report | R11 and P1 scope | Supported capabilities, known gaps and measured budgets are visible |

## Open decisions and maintenance

The user has settled the audience, TypeScript source choice and WebGL2 launch direction with order-book and heatmap support. Remaining decisions include project name, final license, supported browser floor, first live data providers, initial locale coverage and available maintainer capacity. These do not block a prototype using a placeholder package name and deterministic data.

Use a public RFC process for data formats, command schemas, scripting semantics and plugin changes. Set maintainer ownership by subsystem, keep a compatibility matrix, and require migration notes for breaking changes. Publish a clear security-reporting route before accepting third-party script execution.

The next useful milestone is the P0 WebGL2 chart/depth experiment. Its output should be a working, measured prototype and a smaller, evidence-based implementation plan.
