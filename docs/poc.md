# PoC implementation, version 0.3

Built October 2, 2026, with embedding and latency updates on October 3. This extends the second implementation slice with a drawing suite and self-contained widget. P0 remains open and the contracts are experimental.

## Implemented behavior

| Area | Working behavior |
| --- | --- |
| Rendering | WebGL2 instanced geometry with price-pane clipping; Canvas2D drawings, text and overlays |
| Chart | Candles, volume, crosshair, OHLC inspection, pan/zoom, automatic or manual price range, independent axis dragging |
| Markets | BTC, ETH and SOL; 1m, 5m, 15m and 1h; USD simulation or Binance USDT spot |
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
| `candle` | Full candle replacement, correction or next contiguous interval |
| `depth.snapshot` | Complete book snapshot with an update ID |
| `depth.delta` | Absolute quantities with previous/current sequence IDs |
| `stream.status` | Loading, stale or error for candles or depth separately |
| `heatmap.history` | Optional experimental depth history, ignored when disabled |

Candle timestamps are UTC milliseconds aligned to the selected fixed interval. Prices must be positive. The runtime retains 2,000 candles and accepts history batches up to 10,000, retaining the newest 2,000. The runtime recalculates indicator outputs after history replacement or correction. Unknown older candles and skipped live intervals are errors.

Depth quantities are absolute; zero deletes a level in a delta. Normalized deltas require `previousSequence === currentSequence` and `sequence === currentSequence + 1`. Duplicate messages do not add quantity twice. A gap blocks deltas until a current snapshot arrives. Providers with sequence ranges must normalize them or use full snapshots. Complete snapshot IDs may skip values.

`replaceFeed()` increments the runtime generation before disposing the old connection. Late events cannot populate the new market. It clears candles, depth, indicators, undo and the viewport. It preserves layer preferences and retains drawing anchors only when the source and symbol match. Price scaling resets to automatic. A paused replacement connects only on resume. Stream health remains independent: a successful candle cannot clear a depth error.

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

Commands include `layer.set`, `viewport.set`, `viewport.reset`, `priceScale.set`, `priceScale.reset`, `feed.pause` and experimental `heatmap.intensity`. Drawing commands cover add, update, remove, duplicate, ordering, lock-all and clear, with `history.undo` and `history.redo`; see the [drawing API](drawing-suite.md). Validation occurs before document replacement. Errors include `INVALID_PRICE_SCALE`, `MARKET_MISMATCH`, `HEATMAP_DISABLED` and `REVISION_CONFLICT`. Error formatting is not yet a stable structured protocol.

`inspect()` and `exportDocument()` return owned copies. Subscription views and `state()` are borrowed; do not mutate them. Data and explicit document edits have separate revisions. A live-following viewport moves with ticks without incrementing the document revision. The revision guards edits, not a frozen market snapshot.

`viewport.set` can include `priceScale` to move both axes in one validated edit. Plot dragging translates the initial time and price ranges together without changing either span. Time panning keeps five loaded intervals in view at the boundary, or the available history if shorter. These limits remain ordered even when the viewport is wider than the entire history. Pointer overshoot is discarded at an edge so reversing responds immediately. A three-pixel threshold keeps clicks from disabling autoscale or live following. Fit and a plot double-click reset both axes.

Plot panning uses a 12 ms exponential response while held and a cubic ease-out on release, with at most 60 pixels of extra travel over 180 ms. Holding still for 80 ms before release removes the fling. A new pointer gesture, wheel/key action, host command, feed replacement, resize, lost capture, blur or disposal cancels pending pan motion. Drawing handles stay direct.

Scale changes ease out over 90 ms, or 40 ms while dragging an axis. This includes wheel/keyboard zoom, axis resizing, Fit, restored layouts and automatic price ranges. The runtime document takes the exact target immediately; animation changes only displayed geometry and does not produce extra document revisions. All rendered layers and pointer hit tests share these displayed ranges. Grabbing an unfinished transition commits the displayed ranges before starting the new gesture. Initial history and market replacements start at their own ranges without animating across instruments.

`panMotion: false` and `scaleMotion: false` independently disable these view effects. Both honor `prefers-reduced-motion`. Animation uses the existing redraw scheduler and stops requesting frames when settled. These options belong to the host view and are not saved in market documents.

Undo and redo cover content edits while retaining both current scales. Axis gestures do not add undo entries. Manual price ranges persist through ticks, horizontal navigation and layout save/restore. Double-click the price axis to return to autoscale. Time-axis dragging anchors the right edge and disables following; double-click it to restore the default live viewport. Both axes support focus, arrow-key scaling and Home/Enter reset. Wheel gestures inside the chart prevent page scrolling even before focus; the price axis scales prices and the plot scales time. Touch drags use pointer capture with native scrolling disabled within the chart. Keyboard Tab can still leave it.

Documents exclude data and connections. Restore requires matching source, symbol and interval. Version 2 trend lines migrate to normalized v3 records. Missing drawing plugins are preserved and reported. Version 1 layouts migrate only on the original simulated BTC/USD one-minute market. Layouts without `priceScale` default to automatic scaling. Unsupported versions and malformed documents fail atomically.

`IndicatorPlugin` receives candles, prior outputs and the first changed index. It returns one numeric value per candle; `NaN` means warmup or missing output. This is trusted synchronous host code, with no language runtime or sandbox. `ChartRenderer` still exposes PoC geometry and optional heatmap storage; it is not a stable third-party renderer ABI.

## Rendering and measurements

The demo submits one instanced market-geometry batch. Per-instance vertical clipping keeps candles and indicators within the price pane even at a manually enlarged scale. Drawings, text and crosshairs render through the clipped Canvas2D overlay; those and DOM controls are separate from the WebGL draw-call count. GPU recovery rebuilds resources from CPU state.

A single `requestAnimationFrame` schedules redraws from data, input or resize. Crosshair movement paints a separate canvas without rebuilding market geometry or drawing scenes. Drawing previews repaint the annotation canvas without a WebGL upload. Market changes and animations redraw all layers. PNG capture forces a fresh WebGL frame before composing the three canvases. Hover callbacks fire only when the candle changes. The widget skips book formatting for document-only gesture updates and exposes render diagnostics on demand through Inspect. Device pixel ratio is capped at 2.5. Calculations and rendering run on the main thread. Workers, GPU timing, level-of-detail aggregation and columnar storage remain future work.

The CPU timer covers `renderer.render()`. It excludes geometry setup outside that method, text, UI work, GPU completion and presentation latency. It is not FPS or an end-to-end benchmark. No comparative performance result has been established.

## Verification

`npm test` covers book validation and sequencing, heatmap bounds and gaps, indicator corrections, document revisions/migration, market cancellation, independent health, disabled heatmaps, simulator aggregation, live-adapter history reconciliation, retries and disposal. Axis regressions check scale direction, anchors, limits, persistence through ticks, independent resets and atomic rejection of invalid ranges. Motion tests use a deterministic clock to check refresh-rate independence, bounded deceleration, pause/reversal/cancellation, direct mode, wide-zoom and price limits, continuous scale retargeting and coordinate round-trips. `npm run build` type-checks and emits the demo and declarations. `npm run example:headless` exercises the command API without a browser.

Browser verification is recorded in the [v0.2 design and verification notes](v0.2-design.md) and [v0.3 drawing guide](drawing-suite.md). Native file-save behavior, Safari/Firefox, touch hardware, screen readers, extended soak tests, leak profiles and comparative benchmarks remain unverified.

## Next slice

1. Capture replayable real depth fixtures and measure full-frame latency, memory and burst recovery.
2. Introduce multiple panes and explicit scale ownership, then prove EMA and another drawing through extension contracts.
3. Add history paging, session-aware fixtures and reconnect soak tests before expanding chart types.
4. Formalize schemas/errors, choose the source license and document package delivery before public release.

Reintroduce a heatmap demo only after recorded data, aggregation semantics and presentation are validated.
