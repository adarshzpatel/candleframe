# Drawing suite implementation

## Work plan

- [x] Ground the existing interaction, document, rendering and history paths.
- [x] Sketch two designs and compare their ownership boundaries.
- [x] Select the design. No approval checkpoint was requested.
- [x] Implement tools and shared editing workflows, then verify them.
- [x] Review the resulting boundaries and revise if implementation exposes a mismatch.

## Grounding

`chart.ts` converts pointer coordinates through the displayed `ChartGeometry`, previews a two-point trend line, then issues `drawing.add`. Endpoint edits replace the entire saved document. `types.ts` stores only `{ id, start, end }`. `runtime.ts` validates before publishing, scopes drawings by source and instrument, and retains them across interval changes. Its undo history restores content while preserving the current scales, but has no redo. `webgl-renderer.ts` draws trend segments; `chart.ts` independently draws their handles. The demo owns HTML controls and layout storage.

The drawing extension must preserve scale animation, pointer capture, gesture scroll isolation, feed generation cancellation, headless commands and legacy layouts. Committed edits belong to the runtime; unfinished gestures and selection belong to the view. A completed drag should make one undo entry.

The architect skill calls for two independent candidates. Its nested `how`, `why` and `arena` skills are not installed here, so the trace above and two independent design agents provide those steps directly.

## Usage and shape

```ts
const chart = createChart(host, { feed, drawingTools: [myCustomTool] });
chart.setTool('fib-retracement');
chart.execute({ type: 'drawing.add', drawing: {
  id: 'support', type: 'horizontal-line', points: [{ timeMs: 0, price: 65000 }],
  style: { color: '#a9efc4', width: 2 },
}});
chart.execute({ type: 'drawing.update', id: 'support', patch: { locked: true } });
chart.execute({ type: 'history.redo' });
```

`Drawing` stores a tool ID, market points, common style, text, levels, lock and visibility. `DrawingToolDefinition` owns placement count, validation and pure scene projection. `DrawingRegistry` validates at the command boundary and exposes a catalog. A shared scene draws paths, fills and text and performs hit tests; the interaction controller owns drafts and selection and commits one command per completed gesture. Custom definitions are trusted host code.

## Synthesis decision

The registry candidate is the base because third-party tool IDs are a stated project requirement. It hides tool validation and geometry behind one definition. The second candidate's generic interaction session and semantic scene avoid separate pointer handlers and hit-test implementations per tool. Its closed union of built-in drawing types was rejected because it would require engine type edits for every plugin. Stateful per-tool pointer/render/hit-test plugins were rejected because they expose cancellation, snapping and history policy repeatedly. Both candidates were screened for shallow modules and duplicated geometry.

The public contract is sketched in `src/drawing-types.ts`. Committed drawings remain runtime-owned; previews are view-owned. Array order defines z-order. A v3 document migrates old trend lines. Unknown plugin records are preserved and reported, and do not render until their tool is supplied. Both undo and redo preserve live data and current navigation.

## Accepted tradeoffs

- Drawings use the existing Canvas2D overlay for text, dashes, fills and exact stacking; market data stays in WebGL2. The shared primitive model permits another drawing renderer later.
- Single selection keeps editing precise; object groups and multi-selection remain later work.
- Snapshot undo remains bounded, with separate drawing and point budgets.
- This catalog covers common analysis workflows. Specialized Gann, harmonic patterns and drawing-based studies need separate semantics and validation; no complete TradingView catalog parity is claimed.

## Implementation review

The final code follows the sketch. Shared scene paths supply rendering and hit testing, the controller commits gestures once, and the runtime owns validation/history. Review led to narrow corrections for fill-only strokes, selected-handle stacking, stationary handle clicks, axis reset routing, and a navigation path that reuses validated drawings. These did not require changing the ownership model. The runtime catalog is available as serializable inspection metadata.
