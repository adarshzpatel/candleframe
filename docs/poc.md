# PoC implementation, version 0.3

Built October 2, 2026, with embedding and latency updates on October 3. This extends the second implementation slice with a drawing suite and self-contained widget. P0 remains open and the contracts are experimental.

## Implemented behavior

| Area | Working behavior |
| --- | --- |
| Rendering | WebGL2 instanced geometry with price-pane clipping; Canvas2D drawings, text and overlays |
| Chart | Candles, volume, crosshair, OHLC inspection, pan/zoom, automatic or manual price range, independent axis dragging |
| Markets | BTC, ETH and SOL; 1m to 1w; USD simulation or Binance USDT spot. Any feed may use other fixed intervals and session gaps |
| Feeds | Independent candle/depth events and health, metadata, cancellation, reconnect and stale-result rejection |
| Depth | Full snapshots or normalized sequenced deltas, atomic validation, gaps and snapshot recovery |
| Indicator | SMA 20, last-bar updates and corrected-history recalculation |
| Drawing | 30 tools, shared selection/editing, snapping, style, lock/hide, z-order and undo/redo |
| Persistence | Version 3 document with source, symbol, interval, price scale and drawings |
| Agent API | DOM-free runtime, owned inspection snapshots, typed commands and expected document revisions |
| Lifecycle | Feed replacement/disposal, resize, pointer capture, GPU loss and resource restoration |
| UI | Source/symbol/interval controls, connection errors, pause/resume, saved layouts, PNG preview, keyboard controls, candle table |

The demo no longer contains a heatmap or its controls. The engine retains experimental heatmap code behind `heatmap: true`; it is disabled by default. Disabled runtimes ignore heatmap history, normalize it off when restoring layouts and reject attempts to enable the layer. They allocate no heatmap history or GPU texture storage.

See the [drawing suite guide](drawing-suite.md) for the catalog, gesture semantics, plugin API, limits and browser verification.
The [embedding guide](embedding.md) covers `createChartWidget`, instance-owned controls, market catalogs and layout storage. The demo mounts this public widget directly.

## Feed contract

A `FeedAdapter` describes one source, instrument and interval. `connect(emit)` returns pause, snapshot-request and disposal methods. Each connection owns its transport and recovery state. Bootstrap may emit synchronously.

| Event | Meaning |
| --- | --- |
| `instrument` | Validated metadata update for the selected instrument |
| `candles.history` | Ascending history, replacing the retained candle series |
| `candles.prepend` | Older candles in reply to `loadOlder`, with `exhausted` or `error` |
| `candle` | Full candle replacement, correction or next contiguous interval |
| `depth.snapshot` | Complete book snapshot with an update ID |
| `depth.delta` | Absolute quantities with previous/current sequence IDs |
| `stream.status` | Loading, stale or error for candles or depth separately |
| `heatmap.history` | Optional experimental depth history, ignored when disabled |

Intervals are a count and a unit: `30s`, `1m`, `4h`, `1d`, `1w`. `intervalToMs()` parses them; calendar months are not supported because their length varies. Candle timestamps are UTC milliseconds aligned to the interval. Weekly candles align to Monday 00:00 UTC, as exchanges publish them. Prices must be positive.

Set `gaps: true` on the descriptor for markets with sessions, weekends or holidays. Candle times then only need to ascend, live bars may follow a gap, and the time axis gives each loaded bar one slot so closed hours take no space. Viewport limits (20 to 2,200) count bars, not milliseconds. Continuous feeds keep the strict checks. Feeds without an order book declare `depth: { kind: 'none', levels: 0 }`. The runtime keeps up to `maxCandles` candles (default 10,000; 100 to 100,000) and accepts history batches up to 100,000, retaining the newest.

A connection may implement `loadOlder(beforeMs)` to page history. The chart calls `loadOlderHistory()` when the view comes within 50 bars of the first loaded candle; hosts and agents can call it too. The feed replies with `candles.prepend`. Those candles must end before the first loaded candle; overlapping or invalid pages set `olderHistory.status` to `error` without touching the live stream, and the next request retries. Paging stops at `maxCandles` or when a page says `exhausted`. `inspect()` reports `olderHistory`, `maxCandles` and `firstCandleTimeMs`.

`createStaticFeed({ candles, interval, instrument })` charts an array. It infers precision from the data, sends the newest `initialBars` (1,000), pages the rest in `pageSize` steps, and exposes `update(candle)` and `setCandles(candles)` for host-driven updates. The runtime recalculates indicator outputs after history replacement or correction. Unknown older candles and skipped live intervals are errors.

Depth quantities are absolute; zero deletes a level in a delta. Normalized deltas require `previousSequence === currentSequence` and `sequence === currentSequence + 1`. Duplicate messages do not add quantity twice. A gap blocks deltas until a current snapshot arrives. Providers with sequence ranges must normalize them or use full snapshots. Complete snapshot IDs may skip values.

`replaceFeed()` increments the runtime generation before disposing the old connection. Late events cannot populate the new market. It clears candles, depth, indicator values, undo and the viewport. It keeps layer preferences, the indicator list and the log-scale setting, and keeps drawing anchors only when the source and symbol match. The price range resets to automatic. A paused replacement connects only on resume. Stream health remains independent: a successful candle cannot clear a depth error.

## Included adapters

**Simulation** uses a seeded minute series and aggregates it into the selected interval. Each selection starts with 360 historical bars and then streams a current candle at 40 times real time. Recreating a simulated feed starts its deterministic clock again. The book supplies 80 levels per side, with a test hook to omit one depth sequence. Pausing freezes the clock; repeated snapshot requests coalesce.

**Binance Spot** uses the public market-data-only REST and WebSocket endpoints, without credentials. It resolves instrument filters, opens the combined kline/top-20 stream, loads 360 historical candles and reconciles buffered updates. It checks event ordering and cumulative volume. A skipped candle interval triggers history recovery. Depth messages replace the top 20 levels independently; this is neither a full exchange book nor an archived depth feed.

The live adapter aborts requests and closes sockets on pause/disposal, reloads history on resume, marks silent streams stale and retries with bounded exponential backoff. HTTP 429/418 retries respect `Retry-After`, including across replacements. A transport argument permits fixture tests without network access. Network and geographic restrictions can prevent live access; the UI shows errors and never substitutes simulation.

Provider references: [market-data-only endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md), [REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md).

## Public API

```ts
const chart = createChart(container, {
  feed,
  indicators: [sma(20)],
  renderer,                 // Optional ChartRenderer; WebGL2 by default.
  heatmap: false,
  panMotion: true,          // Eased plot drag and bounded release glide.
  scaleMotion: true,        // Eased zoom, axis resize, resets and autoscale.
  drawingTools: [],         // Additional trusted drawing definitions.
  onStats(stats) {},
  onHover(candle) {},
  onToolChange(tool) {},
  onDrawingChange(state) {},
  onError(error) {},
});

chart.replaceFeed(nextFeed, expectedDocumentRevision);
chart.execute(command, expectedDocumentRevision);
chart.inspect();
chart.exportDocument();
chart.restoreDocument(unknownValue, expectedDocumentRevision);
chart.subscribe(state => {}); // Returns unsubscribe.
chart.setTool('trendline');
chart.setDrawingOptions({ magnet: 'weak' });
chart.selectDrawing(id);
chart.drawingTools();
chart.capture();              // PNG data URL.
chart.dispose();
```

Commands include `layer.set`, `viewport.set`, `viewport.reset`, `priceScale.set`, `priceScale.reset`, `priceScale.log`, `indicator.add`, `indicator.update`, `indicator.remove`, `feed.pause` and experimental `heatmap.intensity`. Drawing commands cover add, update, remove, duplicate, ordering, lock-all and clear, with `history.undo` and `history.redo`; see the [drawing API](drawing-suite.md). Validation occurs before document replacement. Failures throw `ChartError`, which has a stable `code`, an optional `path` to the bad input and `details`. Examples: `INVALID_PRICE_SCALE` (path `priceScale`, details `{ tickSize }`), `MARKET_MISMATCH` (expected and actual market), `REVISION_CONFLICT` (expected and actual revision) and `DRAWING_NOT_FOUND` (the id). `JSON.stringify(error)` gives `{ code, message, path, details }`. `onError` always receives a `ChartError`; `toChartError()` converts anything else.

`inspect()` and `exportDocument()` return owned copies. Subscription views and `state()` are borrowed; do not mutate them. Data and explicit document edits have separate revisions. A live-following viewport moves with ticks without incrementing the document revision. The revision guards edits, not a frozen market snapshot.

`viewport.set` can include `priceScale` to move both axes in one validated edit. Plot dragging translates the initial time and price ranges together without changing either span. Time panning keeps five loaded intervals in view at the boundary, or the available history if shorter. These limits remain ordered even when the viewport is wider than the entire history. Pointer overshoot is discarded at an edge so reversing responds immediately. A three-pixel threshold keeps clicks from disabling autoscale or live following. Fit and a plot double-click reset both axes.

Plot panning uses a 12 ms exponential response while held and a cubic ease-out on release, with at most 60 pixels of extra travel over 180 ms. Holding still for 80 ms before release removes the fling. A new pointer gesture, wheel/key action, host command, feed replacement, resize, lost capture, blur or disposal cancels pending pan motion. Drawing handles stay direct.

Scale changes ease out over 90 ms, or 40 ms while dragging an axis. This includes wheel/keyboard zoom, axis resizing, Fit, restored layouts and automatic price ranges. The runtime document takes the exact target immediately; animation changes only displayed geometry and does not produce extra document revisions. All rendered layers and pointer hit tests share these displayed ranges. Grabbing an unfinished transition commits the displayed ranges before starting the new gesture. Initial history and market replacements start at their own ranges without animating across instruments.

`panMotion: false` and `scaleMotion: false` independently disable these view effects. Both honor `prefers-reduced-motion`. Animation uses the existing redraw scheduler and stops requesting frames when settled. These options belong to the host view and are not saved in market documents.

Undo and redo cover content edits while retaining both current scales. Axis gestures do not add undo entries. Manual price ranges persist through ticks, horizontal navigation and layout save/restore. Double-click the price axis to return to autoscale. Time-axis dragging anchors the right edge and disables following; double-click it to restore the default live viewport. Both axes support focus, arrow-key scaling and Home/Enter reset. Wheel gestures inside the chart prevent page scrolling even before focus; the price axis scales prices and the plot scales time. Touch drags use pointer capture with native scrolling disabled within the chart. Keyboard Tab can still leave it.

Documents exclude data and connections. Restore requires matching source, symbol and interval. Documents are version 4 and list their indicators. Version 2 and 3 layouts migrate with the host's constructor indicators. Version 2 trend lines migrate to normalized drawing records. Missing drawing plugins are preserved and reported. Version 1 layouts migrate only on the original simulated BTC/USD one-minute market. Layouts without `priceScale` default to automatic scaling. Unsupported versions and malformed documents fail atomically.

`IndicatorPlugin` receives candles, prior outputs and the first changed index. It returns one numeric value per candle; `NaN` means warmup or missing output. Plugins with `outputs` implement `calculateOutputs` and return one array per output; a `histogram` output draws bars from zero. `pane: 'separate'` puts the indicator in its own pane below the volume band, with optional fixed `range` and guide `levels`. This is trusted synchronous host code, with no language runtime or sandbox.

## Indicators and panes

The registry includes `sma`, `ema`, `bb` (Bollinger Bands), `rsi` and `macd`. Hosts add kinds with the `indicatorDefinitions` option: a `kind`, a `name`, a `pane`, input specs with defaults and limits, and `create(inputs, id)`. Documents store `{ id, kind, inputs, visible }`, so layouts and undo cover indicator changes. `indicator.add` validates inputs against the spec and generates an id (`rsi`, then `rsi-2`) unless one is given. `indicator.update` merges inputs. Unknown kinds in a restored layout stay in the document and appear in `unsupportedIndicatorKinds`. Indicators passed to the constructor are used as-is while their id, kind and inputs match the document. `inspect()` lists each indicator's latest value per output and the available kinds with their input specs.

Each separate pane takes about a fifth of the chart height; together they take at most 55%. RSI uses a fixed 0 to 100 range with 30 and 70 guides; other panes fit their visible values. The crosshair spans every pane and labels the value in the pane under the pointer.

`priceScale.log` switches the price axis to a log scale, where equal percentage moves have equal height. Navigation, resets, panning and market changes keep the setting. Dragging and panning the axis work by ratio on a log scale. `ChartRenderer` still exposes PoC geometry and optional heatmap storage; it is not a stable third-party renderer ABI.

## Rendering and measurements

Axis marks sit on round values and move with the data, as in TradingView. Price marks use steps of 1, 2, 2.5 or 5 times a power of ten, about one per 32 pixels; log axes spanning more than 3x use 1, 2 and 5 per decade. Time marks fall on calendar boundaries in the label time zone (every 15 minutes, every hour, every few days, monthly) at whichever step keeps labels about 60 pixels apart. A new day shows its number, a new month its name and a new year the year, in bold; when marks crowd, these win over clock times. With session gaps, marks land on the first bar of each period, never inside a gap. Grid lines follow the marks; custom renderers receive their positions as `RenderFrame.grid`.

The demo submits one instanced market-geometry batch. Per-instance vertical clipping keeps candles and indicators within the price pane even at a manually enlarged scale. Drawings, text and crosshairs render through the clipped Canvas2D overlay; those and DOM controls are separate from the WebGL draw-call count. GPU recovery rebuilds resources from CPU state.

A single `requestAnimationFrame` schedules redraws from data, input or resize. Crosshair movement paints a separate canvas without rebuilding market geometry or drawing scenes. Drawing previews repaint the annotation canvas without a WebGL upload. Market changes and animations redraw all layers. PNG capture forces a fresh WebGL frame before composing the three canvases. Hover callbacks fire only when the candle changes. The widget skips book formatting for document-only gesture updates and exposes render diagnostics on demand through Inspect. Device pixel ratio is capped at 2.5. Calculations and rendering run on the main thread. When bars are narrower than two pixels, the renderer merges the bars in each two-pixel column into one OHLC bar with summed volume, so zoomed-out views of long histories draw a few hundred candles.

`npm run bench` measures the repeated main-thread work with a no-op WebGL context. On an Apple M3 Pro with 10,000 candles, SMA, EMA, Bollinger Bands, RSI and MACD, and 2,200 visible bars:

| Work | Median |
| --- | --- |
| Apply a tick and recalculate indicators | 1.1 ms |
| Fit autoscale and panes | 0.02 ms |
| Build and upload a frame's instances | 0.56 ms (2.08 ms before bar merging) |

That is under 2 ms of a 16.7 ms frame. Moving indicators to a worker would add a copy of every candle per tick, which costs more than the calculation, so the engine stays single-threaded until a measured workload needs otherwise. GPU timing and columnar storage remain future work.

The CPU timer covers `renderer.render()`. It excludes geometry setup outside that method, text, UI work, GPU completion and presentation latency. It is not FPS or an end-to-end benchmark. No comparative performance result has been established.

## Verification

`npm test` covers book validation and sequencing, heatmap bounds and gaps, indicator corrections, document revisions/migration, market cancellation, independent health, disabled heatmaps, simulator aggregation, live-adapter history reconciliation, retries and disposal. Axis regressions check scale direction, anchors, limits, persistence through ticks, independent resets and atomic rejection of invalid ranges. Motion tests use a deterministic clock to check refresh-rate independence, bounded deceleration, pause/reversal/cancellation, direct mode, wide-zoom and price limits, continuous scale retargeting and coordinate round-trips. `npm run build` type-checks and emits the demo and declarations. `npm run example:headless` exercises the command API without a browser.

Browser verification is recorded in the [v0.2 design and verification notes](v0.2-design.md) and [v0.3 drawing guide](drawing-suite.md). `npm run smoke` drives the offline demo (`?offline`) in Chromium, Firefox and WebKit, plus iPhone and Pixel touch emulation. It adds indicator panes, switches to log scale, pans, opens the gapped sample equity market, saves screenshots to `artifacts/smoke/` and fails on page or console errors. CI runs it on Linux. Firefox does not launch on the macOS 27 development machine, so it is covered by CI only. Native file-save behavior, real touch hardware, screen readers, extended soak tests, leak profiles and comparative benchmarks remain unverified.

## Next slice

1. Capture replayable real depth fixtures and measure full-frame latency, memory and burst recovery.
2. Introduce multiple panes and explicit scale ownership, then prove EMA and another drawing through extension contracts.
3. Add history paging, session-aware fixtures and reconnect soak tests before expanding chart types.
4. Formalize schemas/errors, document package delivery before public release.

Reintroduce a heatmap demo only after recorded data, aggregation semantics and presentation are validated.
