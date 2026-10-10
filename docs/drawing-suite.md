# Drawing suite, version 0.3

The workbench includes 30 drawing tools and a shared editing workflow. The catalog is an implementation of common chart-analysis drawings, not the complete TradingView catalog. Its [public drawing list](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/) was used to check tool families; no proprietary implementation was copied.

## Tools

| Category | Tools | Placement |
| --- | --- | --- |
| Lines | Trend line, ray, extended line, arrow | Two clicks |
| Levels | Horizontal line, horizontal ray, vertical line, cross line | One click |
| Channels | Parallel channel, pitchfork, Schiff pitchfork | Three clicks |
| Fibonacci | Retracement, extension, channel, fan, time zones | Two or three clicks; picker shows instructions |
| Shapes | Rectangle, ellipse, triangle, polyline | Two/three clicks; Enter or double-click finishes a polyline |
| Freehand | Brush, highlighter | Drag, then release |
| Annotations | Text, callout, price label | One click; callout uses tip then label location |
| Measurements | Price range, date range, date and price range | Two clicks |
| Position plans | Long position, short position | One click at entry, then drag level or width handles |

Position plans start at 1:1 reward/risk and show target/stop prices, percentage distances and a compact entry badge. Target and stop handles move vertically, the side handle adjusts width, and the entry handle adjusts entry between the two levels. Dragging a shaded region moves the whole plan. Prices are constrained during handle drags so crossing entry cannot produce an invalid position on release. They do not submit orders or calculate account position sizes. Fibonacci levels are editable and can be cleared to restore defaults. Measurements use the selected interval and elapsed UTC time; exchange session calendars are not implemented.

## Editing

Choose a category in the left rail, or search the tool picker. A tool returns to Cursor after placement unless **Keep drawing** is on. The drawing strip controls color, width and line style for the selected object or the next drawing. **Objects** opens the drawing list and properties.

- Click an object to select it. Drag its body to move all points together or drag a handle to edit an anchor. Paths with more than eight points expose endpoint handles.
- Text, callouts and price labels open a text editor after placement. Double-click an annotation, select it and press Enter, or use **Edit text** to reopen it. Enter inserts a new line; Ctrl/Command+Enter or **Apply text** saves text, size and color together as one undo step. Escape or **Cancel** discards the pending edit. Streamed prices do not replace typed text.
- Double-click a position, select it and press Enter, or choose **Settings** in its drawing strip to edit entry, target, stop and width in bars. Reward/risk input and 1R/2R/3R presets adjust the target while retaining the stop. **Apply position** commits all fields as one undo step; Cancel leaves the plan unchanged.
- Change fill opacity, font size, Fibonacci levels or exact UTC/price anchors in Objects. Its Text field also edits drawing labels and defaults. Text is plain text, never HTML.
- Duplicate, move to front/back, lock, hide or delete individual objects. Lock prevents canvas movement and coordinate edits; explicit property changes and removal remain available in Objects.
- Hide all is a view preference. Lock all is one undoable document edit. Individual lock/visibility flags persist.
- Magnet off preserves exact pointer coordinates. Weak magnet snaps within 12 CSS pixels of visible candle OHLC locations. Strong magnet chooses the nearest visible OHLC point. Candle timestamps are positioned at their visual center.
- A completed creation or drag adds one undo entry. Escape, lost pointer capture, blur, market replacement or a conflicting host edit discards the preview. Streamed data does not invalidate a draft.

When the chart has focus, Delete/Backspace removes an unlocked selection, Ctrl/Command+C copies, V pastes and D duplicates. Ctrl/Command+Z undoes; Shift+Ctrl/Command+Z or Ctrl/Command+Y redoes. Enter opens the selected annotation or position editor, or finishes a polyline. Escape cancels placement and clears selection. Drawing and axis gestures remain separate; selected drawings do not block axis resets.

Save layout and Restore include drawings. The storage key is retained from v0.2 so existing layouts can migrate. PNG export includes drawings and their labels. Native file-download handling is not newly certified by this change.

## Public API

```ts
import { createChart, createSimulatedFeed } from './dist/lib/index.js';

const chart = createChart(host, {
  feed: createSimulatedFeed({ symbol: 'BTC/USD', interval: '1m' }),
  onDrawingChange(state) { /* Owned tool, selection and preference snapshot. */ },
  onError(error) { /* Show validation failures from pointer edits. */ },
});
chart.setTool('fib-retracement');
chart.setDrawingOptions({ magnet: 'weak', stayInDrawingMode: true });
chart.execute({ type: 'drawing.add', drawing: {
  id: 'support', type: 'horizontal-line',
  points: [{ timeMs: Date.UTC(2026, 9, 2), price: 67000 }],
  style: { color: '#a9efc4', width: 2 },
} }, chart.inspect().documentRevision);
chart.execute({ type: 'drawing.update', id: 'support', patch: {
  style: { lineStyle: 'dashed' }, locked: true,
} });
chart.execute({ type: 'drawing.duplicate', id: 'support', newId: 'support-copy' });
chart.execute({ type: 'drawing.order', id: 'support-copy', where: 'front' });
chart.execute({ type: 'drawing.remove', id: 'support-copy' });
chart.execute({ type: 'history.undo' });
chart.execute({ type: 'history.redo' });
chart.selectDrawing('support');
chart.drawingState();
chart.drawingTools();
chart.inspect().capabilities.drawingTools; // Serializable catalog for agents.
chart.restoreDocument(saved, chart.inspect().documentRevision);
```

`DrawingInput` contains `id`, `type` and `points`; optional style, text, levels, lock and visibility are normalized by the runtime. `drawing.update` merges a partial style rather than replacing it. `drawing.duplicate` accepts an optional `{ timeMs, price }` offset; it makes an unlocked, visible copy. IDs are supplied explicitly so agents can detect duplicate requests. `drawing.clear` removes all drawings. `drawing.lockAll` sets all lock flags as one edit.

The headless `ChartRuntime` supports the same drawing commands, registry and persistence without a DOM or GPU. Navigation and streamed data remain outside content history, and neither clears redo. Undo/redo preserve current scales and live market data.

## Add a tool

```ts
import type { DrawingToolDefinition } from './dist/lib/index.js';

const customLevel: DrawingToolDefinition = {
  type: 'example:level', label: 'Custom level', group: 'Custom', points: 1,
  hint: 'Click one price.',
  project(drawing, { geometry: g }) {
    const y = g.y(drawing.points[0].price);
    return [{ kind: 'path', points: [
      { x: g.left, y }, { x: g.left + g.plotWidth, y },
    ] }];
  },
};
const chart = createChart(host, { feed, drawingTools: [customLevel] });
```

The registry includes built-ins and rejects duplicate IDs. A definition supplies a numeric point count, `path` or `freehand`, optional extra validation, and pure scene projection. Set `editableText: true` to opt into annotation editing. The bare chart calls `onDrawingEdit(drawing)` with an owned copy after text placement, double-click or Enter; hosts supply their own editor. The widget provides its own editor inside its shadow root. Partial creation previews can have fewer points than the final drawing; projection must tolerate them. Tools return paths/fills and text in CSS pixels through the displayed geometry. The shared scene renders and hit-tests those primitives, so plugins do not implement their own pointer or undo lifecycle. Registered definitions are trusted application code, not sandboxed scripts. Common points, styles, text and levels are the current persisted extension fields.

## Persistence and limits

Version 3 stores normalized drawing records. Old version-2 trend lines migrate automatically, and legacy `drawing.add` calls remain accepted. Version-1 migration retains its original simulated BTC/USD one-minute restriction. Missing plugin types survive round-trip and appear in `unsupportedDrawingTypes`; they remain in Objects but do not draw or expose handles until registered.

Limits are 100 drawings, 1,024 points per drawing, 8,192 total points, 2,000 text characters per object, 24 custom levels and 256 KiB of serialized drawing data. Undo and redo each retain at most 40 snapshots. Invalid edits fail before changing the document, revision or either history stack.

## Rendering and validation

Market candles and indicators remain WebGL2. Drawing scenes render in order on the existing Canvas2D overlay, clipped to the price pane. Selection handles render last. The existing scale animation supplies the same coordinates to drawing projection, hit tests and overlays. Navigation reuses validated drawing data instead of revalidating or copying every object on every animation frame.

The browser creation pass exercised all 30 tools through their real pointer gestures. It also checked body movement as one document revision, styling, duplicate, lock/hide, undo/redo, axis reset with a selection, native text editing and the resulting PNG preview. The browser-created v3 layout containing every tool round-tripped exactly through the headless runtime. The test suite, production build and headless example pass. Tests cover validation, plugin restoration, geometry, limits, scene hit tests, creation/edit cancellation and history. These are correctness checks, not a comparative drawing-performance benchmark. The toolbar now ships inside [the embeddable widget](embedding.md).

Groups, multi-selection, specialized Gann/harmonic/Elliott tools, anchored drawing studies and touch-hardware certification remain future work.

Measurement tools draw a dashed diagonal between the two anchors while retaining their brackets, filled range and labels. The diagonal uses `theme.chart.measurementDash`; its color and thickness follow the drawing style.

## Semantic placement and handles

Tools may implement `create(anchor, context)` for one-click placement while retaining a different persisted `points` count. Position plans still serialize as the original entry, target and stop anchors; no document migration is needed. `inspect().capabilities.drawingTools` distinguishes single-click placement from stored point count.

Optional `handles(drawing, context)` and `moveHandle(drawing, id, anchor, context)` hooks must be supplied together. They define projected handle locations, cursors and constrained anchor updates. The shared scene paints and hit-tests those same locations. Numeric IDs address ordinary raw anchors; custom handles should use string IDs and their paired move hook. `DrawingContext.tickSize` is available to constrain prices. `editableProperties: true` enables double-click/Enter activation through `onDrawingEdit` without opening an editor immediately on placement.

The position interaction was checked against [OpenMarket's live chart](https://openmarket.xyz/chart/) and [TradingView's long/short drawing documentation](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/). OpenChart implements the placement and editing workflow independently. Account sizing, leverage, quantity and simulated trade P&L remain outside this position-plan implementation.
