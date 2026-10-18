# Drawing suite, version 0.3

The workbench includes 85 drawing tools and a shared editing workflow.

## Tools

The rail has six families, each split into sections in its menu. Tools place with as many clicks as they have anchors; paths finish with Enter or a double-click, brushes with a release, and position plans with one click.

| Family | Section | Tools |
| --- | --- | --- |
| Lines | Lines | Trend line, ray, info line, extended line, trend angle, horizontal line, horizontal ray, vertical line, cross line |
| Lines | Channels | Parallel channel, regression trend, flat top/bottom, disjoint channel |
| Lines | Pitchforks | Pitchfork, Schiff, modified Schiff, inside pitchfork |
| Fib & Gann | Fibonacci | Retracement, trend-based extension, channel, time zone, speed resistance fan, trend-based time, speed resistance arcs, circles, spiral, wedge, pitchfan |
| Fib & Gann | Gann | Gann box, Gann square fixed, Gann square, Gann fan |
| Patterns | Chart patterns | XABCD, cypher, head and shoulders, ABCD, triangle pattern, three drives |
| Patterns | Elliott waves | Impulse, correction, triangle, double combo, triple combo |
| Patterns | Cycles | Cyclic lines, time cycles, sine line |
| Forecasting | Projection | Long position, short position, forecast, bars pattern, ghost feed, projection |
| Forecasting | Volume-based | Anchored VWAP, fixed range volume profile |
| Forecasting | Measurer | Date range, price range, date and price range |
| Shapes | Brushes | Brush, highlighter |
| Shapes | Arrows | Arrow, arrow marker, arrow mark up, arrow mark down |
| Shapes | Shapes | Rectangle, ellipse, triangle, polyline, rotated rectangle, circle, path, arc, curve, double curve |
| Annotations | Text and notes | Text, callout, price label, note, price note, pin, signpost, flag mark, comment, table, anchored text, anchored note |

Each family has its own module, `src/drawing-tools-<family>.ts`.

Clicking a family button picks the last tool used from it. The small corner button, or a right-click, opens the family menu. Alt+T, Alt+H, Alt+J, Alt+V, Alt+C and Alt+F pick the trend line, horizontal line, horizontal ray, vertical line, cross line and Fibonacci retracement.

A Fibonacci retracement counts from its second anchor (0) back to its first (1). Saved retracements from earlier versions draw with their labels in that order; set **Reverse** to restore the old direction.

Position plans start at 1:1 reward/risk. Target and stop labels show the price, distance, percentage and tick count. The entry label shows side, entry and reward/risk, plus the trade's state when candles are loaded: waiting for entry, open P&L, target hit or stopped. The plan fills on the first candle inside its width that trades through entry, then closes on the first candle that reaches target or stop; a candle that reaches both counts as stopped. A darker fill and a dashed line trace the trade from fill to exit or the latest candle. Entry, target and stop handles sit on the left edge and move vertically, and the right-edge handle adjusts width. Dragging a shaded region moves the whole plan. Prices are constrained during handle drags so crossing entry cannot produce an invalid position on release. They do not submit orders or calculate account position sizes. Fibonacci levels are editable and can be cleared to restore defaults. Measurements use the selected interval and elapsed UTC time; exchange session calendars are not implemented.

## Editing

Choose a family in the left rail, then a tool from its menu; arrow keys move through the menu. A tool returns to Cursor after placement unless **Keep drawing** is on. The drawing strip controls color, width and line style for the selected object or the next drawing. Its gear opens the tool's settings, text, fill, font size, Fibonacci levels and anchor coordinates, plus duplicate and ordering; lock and delete sit beside it. Double-click or Enter opens the same settings for any drawing. **Objects** opens the drawing list, with show, lock and delete on each row.

Each tool remembers the last style, settings and Fibonacci levels you chose, and its next drawing starts with them. With a `storageKey` the widget keeps these defaults across reloads. Named looks per tool are covered in [Templates](#templates).

- Hovering a drawing shows its handles faintly. Selecting it shades its price and time extent on both axes, with a tag at each anchor.
- Shift while placing a point or dragging an anchor snaps the segment to 0°, 45° or 90° on screen.
- Alt, Ctrl or Command while dragging a drawing's body drags a copy and leaves the original in place.
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

## Templates

The Template button in the drawing strip and the Template button at the foot of the settings panel open the same menu. It acts on the selected drawing's tool, or on the active tool when nothing is selected.

- **Save as…** asks for a name inside the widget and stores the drawing's style, settings and Fibonacci levels. Points and text stay out of templates. Names are 1 to 64 characters. Reusing a name that tool already has, ignoring case, asks before replacing it. Each tool holds up to 20 templates.
- Saved templates are listed by name. Clicking one applies it to the selection as one `drawing.update`, so one undo reverts it. Settings the template leaves out return to their defaults. The trash button beside a name deletes that template without asking.
- **Save as default** makes the selection's look the tool's default for new drawings.
- **Apply default** gives the selection the look a new drawing of its tool would get.
- **Reset** gives the selection `DEFAULT_DRAWING_STYLE`, clears its settings and restores the built-in Fibonacci levels.

With nothing selected, applying a template sets the active tool's defaults, so the next drawing starts with it, and Reset clears those defaults. Apply and Reset cover the settings a tool declares; option keys outside its `settings` stay on the drawing.

Templates and tool defaults belong to the widget, not the chart document, so they cover every chart and market in it. With a `storageKey` the widget keeps them in localStorage under `["<storageKey>","drawing-templates"]`. Without one they last for the widget session. To keep them with an account, pass `drawingTemplateStore`:

```ts
createChartWidget(container, {
  feed,
  storageKey: 'terminal',
  drawingTemplateStore: {
    load: () => account.load('drawing-templates'),
    save: value => account.save('drawing-templates', value),
  },
});
```

Either method may return a promise. `save` receives the whole `DrawingTemplateData` after each change. On load the widget checks every entry against the registered tools and drops invalid ones; templates for a plugin tool that is not registered stay as they are. Edits made before a slow `load` answers win over the stored copy. A failed load or save shows a message, and templates keep working for the session.

The bare `createChart` engine stores nothing. A host sets per-tool defaults with `setDrawingOptions({ toolDefaults })`. Each entry replaces that tool's defaults, `null` clears them, and the registry checks style, settings and levels the same way it checks a drawing:

```ts
chart.setDrawingOptions({ toolDefaults: { trendline: { style: { width: 3 }, options: { extendRight: true } } } });
chart.setDrawingOptions({ toolDefaults: { trendline: null } });
```

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

Groups, multi-selection, per-interval visibility, specialized Gann/harmonic/Elliott tools, anchored drawing studies and touch-hardware certification remain future work.

## Tool settings

A definition may declare `settings`: booleans, selects, colors and bounded numbers, each with a key, label, default and optional section. The widget builds the settings form from them, and `inspect().capabilities.drawingTools[].settings` lists them for agents. Values live in `Drawing.options`, which stores only values that differ from the defaults, so drawings without changes serialize as before. `drawing.update` merges an `options` patch. Read a value with `drawingOption(drawing, definition, key)`.

Built-in settings include extend left/right, arrow ends, middle point and stats for lines; axis labels and text position for level lines; per-level colours, background bands, label side, level format, reverse and extend for Fibonacci tools; background, extend and middle line for shapes; and bold, italic, border and an optional background for text. The text tool has no background by default; callouts and price labels start with one. The background is the text colour at 20% opacity unless you pick a colour and opacity in Settings.

Tools can return `axis` primitives for tags in the price or time gutter, such as the horizontal line's price tag. `DrawingContext.selected` lets a tool show details, like line stats, only while selected.

`node scripts/drawing-behaviour.mjs` checks the rail, hotkeys, Shift snapping, clone drags, settings, remembered defaults and templates across reloads with real input. It starts Vite itself and clears the demo's saved templates before and after the run. `node scripts/drawing-gallery.mjs` screenshots every tool.

Measurement tools draw a dashed diagonal between the two anchors while retaining their brackets, filled range and labels. The diagonal uses `theme.chart.measurementDash`; its color and thickness follow the drawing style.

## Semantic placement and handles

Tools may implement `create(anchor, context)` for one-click placement while retaining a different persisted `points` count. Position plans still serialize as the original entry, target and stop anchors; no document migration is needed. `inspect().capabilities.drawingTools` distinguishes single-click placement from stored point count.

Optional `handles(drawing, context)` and `moveHandle(drawing, id, anchor, context)` hooks must be supplied together. They define projected handle locations, cursors and constrained anchor updates. The shared scene paints and hit-tests those same locations. Numeric IDs address ordinary raw anchors; custom handles should use string IDs and their paired move hook. `DrawingContext.tickSize` is available to constrain prices. `editableProperties: true` enables double-click/Enter activation through `onDrawingEdit` without opening an editor immediately on placement.

Account sizing, leverage and quantity remain outside this position-plan implementation.
