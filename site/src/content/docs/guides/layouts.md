---
title: Save layouts
description: Save and restore chart documents, let the widget autosave to localStorage or your own backend, and keep named multi-chart layouts.
---

A chart's drawings, indicators, chart type and view live in a JSON document. This page shows how to save and restore documents yourself, how the widget saves them for you, and how to store them in your own backend.

```ts
const saved = chart.exportDocument();
await fetch('/api/layouts/btc', { method: 'PUT', body: JSON.stringify(saved) });

// Later, on a chart showing the same market.
const response = await fetch('/api/layouts/btc');
chart.restoreDocument(await response.json());
```

## Documents

`exportDocument()` returns a copy of the document. It holds:

- the source id, symbol and interval it belongs to,
- the viewport and price scale, including log mode,
- the chart type and footprint settings,
- which layers show (candles, volume, indicators),
- the indicators with their inputs,
- the drawings and drawing groups.

Candles are not part of it. The document is plain JSON, so you can store it anywhere.

`restoreDocument(value, expectedRevision?, options?)` validates the whole document before it changes anything. A document belongs to one market. Restoring it on a chart with another symbol throws `SYMBOL_MISMATCH`. Another source or interval throws `MARKET_MISMATCH`. Older document versions migrate on load.

A restore is one undo step. Pass `{ undoable: false }` to load without one, which suits loading a saved layout at startup:

```ts
declare const saved: unknown;

chart.restoreDocument(saved, undefined, { undoable: false });
```

Pass `expectedRevision` (from `inspect().documentRevision`) to fail with `REVISION_CONFLICT` if the user edited the chart since you last looked.

## Widget autosave

The widget saves each chart's document by itself. It saves 400 ms after each change, and it saves pending changes when the page is hidden, the market switches or the widget is disposed. On mount and after each market switch it loads the saved document for that market. The load keeps the live viewport and an automatic price range, and adds no undo step.

Where it saves depends on `storageKey`:

- **Without `storageKey`.** Documents stay in memory for the life of the widget. Save and Revert stay hidden, because autosave already covers the session.
- **With `storageKey`.** Documents go to `localStorage`. The header shows Save, which writes at once, and Revert, which reloads the saved document including its viewport.

```ts
import { createChartWidget } from 'candleframe/widget';

createChartWidget(host, { feed, storageKey: 'terminal-main-chart' });
```

Each market gets its own key, built from the namespace, source id, symbol and interval: `JSON.stringify([storageKey, feedId, symbol, interval])`. Give each independently saved widget its own `storageKey`. Two widgets with the same key and market write to the same entry and overwrite each other.

The `storageKey` namespace also holds the user's appearance and the intervals they typed. Those always use `localStorage`.

## Store layouts in your backend

Pass a `layoutStore` to save somewhere other than `localStorage`. It needs a `storageKey` too, which namespaces the keys. Without one, `createChartWidget` throws `WIDGET_STORAGE_KEY_REQUIRED`.

```ts
import { createChartWidget } from 'candleframe/widget';
import type { WidgetLayoutStore } from 'candleframe/widget';

const layoutStore: WidgetLayoutStore = {
  async load(key) {
    const response = await fetch(`/api/layouts?key=${encodeURIComponent(key)}`);
    return response.ok ? response.json() : null;
  },
  async save(key, value) {
    await fetch(`/api/layouts?key=${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(value) });
  },
  async remove(key) {
    await fetch(`/api/layouts?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  },
};

createChartWidget(host, { feed, storageKey: 'user-42:left', layoutStore });
```

Each method may return a value or a promise. `load` returns the saved value, or `null` or `undefined` when there is none. `remove` is optional. The widget calls it when the user deletes a named layout, and without it the deleted record stays in your store.

Treat the values as opaque JSON. A store receives three kinds, typed as `WidgetStoredValue`:

| Value | Key | Contents |
| --- | --- | --- |
| `ChartDocument` | `[storageKey, feedId, symbol, interval]` | One market's drawings, indicators and view. |
| `WidgetWorkspace` | `[storageKey, 'workspace', id]` | One named layout: grid preset, sync settings, active chart and each chart's market. |
| `WidgetWorkspaceIndex` | `[storageKey, 'workspaces']` | The list of named layouts and the one in use. |

Keys are the `JSON.stringify` of the arrays shown. A slow `load` cannot overwrite edits the user made while it was pending, or a market they switched away from.

Drawing templates and favourite tools have their own stores, `drawingTemplateStore` and `drawingFavouriteStore`. `layoutStore` does not hold them.

## Multi-chart grids

The Layout button splits the widget into a grid of up to eight charts. Grids need a `markets` catalog, because each extra chart creates its own feed. A new chart copies the active chart's market. See [Embed the widget](../widget/#let-users-switch-markets) for `markets`.

```ts
import { createChartWidget } from 'candleframe/widget';
import type { WidgetMarketSource } from 'candleframe/widget';

declare const markets: WidgetMarketSource[];

const chart = createChartWidget(host, {
  feed,
  markets,
  storageKey: 'terminal',
  layout: { preset: '2x2', sync: { interval: true } },
});

chart.setActiveChart(2); // The toolbar and the widget API now act on the third chart.
chart.setLayout({ preset: '1+2', sync: { symbol: true } });
console.log(chart.getLayout().preset); // '1+2'
```

| Preset | Arrangement |
| --- | --- |
| `1` | One chart |
| `2h` | Two side by side |
| `2v` | Two stacked |
| `1+2` | One large, two stacked |
| `2x2` | Four in a grid |
| `3x2` | Six in a grid |
| `4x2` | Eight in a grid |

`LAYOUT_PRESETS` exports the same list with cell, column and row counts. Each chart owns a WebGL context, and browsers cap how many a page can hold, which is why the largest grid has eight. Each chart also opens its own feed connection.

The sync settings link the charts of one grid:

| Setting | Effect | Default |
| --- | --- | --- |
| `symbol` | A symbol change in one chart applies to every chart. | `false` |
| `interval` | An interval change in one chart applies to every chart. | `false` |
| `crosshair` | Hovering one chart shows a time line on the others. | `true` |
| `time` | Panning one chart moves the others to the same right edge. Each keeps its zoom. | `true` |
| `dateRange` | Every chart shows the same time range. | `false` |

`DEFAULT_WIDGET_SYNC` exports these defaults. Synced navigation adds no undo steps.

Charts showing the same source, symbol and interval share one document. A drawing added on one appears on the others, while each keeps its own view.

## Named layouts

The Layout panel lets users save the current grid under a name, switch between named layouts, rename them and delete them. Each named layout stores the preset, sync settings, active chart and each chart's market. Drawings and indicators stay in the per-market documents, so two layouts that show the same market share its drawings.

Changes save into the open layout. On the next mount the widget reopens the last layout, and replaces the `layout` option you passed. The first chart keeps the `feed` you passed, and the other charts open the markets the layout saved.

## Next

- [Embed the widget](../widget/) covers the other widget options.
- [Run headless](../headless/) uses the same documents in Node.
- [Use the bare chart](../bare-chart/#link-charts) links bare charts with `createChartGroup`.
