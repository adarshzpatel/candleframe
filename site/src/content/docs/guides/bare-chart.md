---
title: Use the bare chart
description: Mount the chart engine without the widget UI, draw price lines and markers, and link several charts together.
---

`createChart` from `candleframe/chart` mounts only the plot: candles, axes, panes, crosshair, drawings and indicators, with no toolbars around it. Use it when your application supplies its own controls. This page covers its options, host-owned price lines and markers, and linking charts.

```ts
import { createChart } from 'candleframe/chart';
import { createSimulatedFeed, sma } from 'candleframe/core';

host.style.height = '500px';
const chart = createChart(host, {
  feed: createSimulatedFeed({ symbol: 'BTC/USD', interval: '1m' }),
  indicators: [sma(20)],
});

chart.execute({ type: 'priceScale.set', minPrice: 66_000, maxPrice: 70_000 });
chart.execute({ type: 'priceScale.reset' });
```

## Widget or bare chart

Pick the [widget](../widget/) when you want a finished trading UI. Pick the bare chart when:

- your app already has its own symbol picker, toolbar or indicator menu,
- you want a small chart in a card or dashboard with no chrome,
- you need control over every pixel around the plot.

The bare chart still handles pointer and keyboard input on the plot. Users can drag to pan, scroll to zoom, drag the axes to rescale and draw with whichever tool you set through `setTool`. It does not load the widget's bundled fonts, and it does not follow later changes to the system color scheme. Both return the same `ChartApi`, so commands, documents and subscriptions work the same way. The widget's API adds grid methods on top.

## Options

| Option | What it does | Default |
| --- | --- | --- |
| `feed` | The data source. See [Data feeds](../../feeds/overview/). | Required |
| `indicators` | Indicator plugins to start with. | None |
| `indicatorDefinitions` | Extra indicator kinds for `indicator.add` and saved documents. | Built-ins only |
| `theme` | A preset id or a theme from `createTheme`. | Graphite, or Paper when the system prefers light |
| `timeZone` | IANA zone for axis and crosshair labels. | `'UTC'` |
| `maxCandles` | Candles kept in memory, including paged history. 100 to 100,000. | 10,000 |
| `panMotion` | Eased dragging and release momentum. | `true` |
| `scaleMotion` | Eased zoom, axis resizing and autoscale changes. | `true` |
| `candleMotion` | Eases the forming candle between ticks. | `true` |
| `autoscaleOnPan` | Keeps an automatic price scale fitted to visible candles while dragging. | `false` |
| `drawingTools` | Extra drawing tool definitions. See [Drawing tools](../../plugins/drawing-tools/). | Built-ins only |
| `renderer` | A custom `ChartRenderer` in place of `WebGL2Renderer`. | WebGL2 |

The three motion options turn themselves off when the user's system asks for reduced motion.

Callbacks report what happens in the chart:

| Callback | Receives |
| --- | --- |
| `onHover(bar)` | The candle under the pointer, or `null` when the pointer leaves. |
| `onThemeChange(theme)` | A copy of the new theme after `setTheme`. |
| `onToolChange(tool)` | The active drawing tool id. |
| `onDrawingChange(state)` | Drawing selection and tool state. |
| `onDrawingEdit(drawing)` | A copy of a drawing the user opened for editing. Text annotations open right after placement; any drawing opens on double-click or Enter. |
| `onError(error)` | A `ChartError` from a failed drawing or keyboard action. |
| `onStats(stats)` | Renderer statistics after each frame that redraws the market. |

## Price lines

Price lines are horizontal lines your app owns, such as working orders, a position's entry or an alert level. `setPriceLines` replaces the whole set each time. They are view state only: not saved in documents, not undoable and not editable by the user unless you allow dragging.

```ts
chart.setPriceLines([
  { price: 68_250, label: 'Entry', color: '@accent' },
  { id: 'tp', price: 69_000, label: 'TP', color: '@positive', style: 'dashed', drag: 'move', closable: true },
  { id: 'sl', price: 67_600, label: 'SL', color: '@negative', style: 'dashed', drag: 'move', quantity: '2' },
]);
```

Colors are a theme palette name such as `@positive`, or a six-digit hex color. A line with `drag` or `closable` needs an `id`, because events name lines by id.

### React to drags

The chart only reports a drag. Your code decides what it means, then calls `setPriceLines` again with the new prices.

```ts
import type { PriceLine } from 'candleframe/chart';

let lines: PriceLine[] = [{ id: 'order', price: 68_000, label: 'BUY LMT', drag: 'move' }];
chart.setPriceLines(lines);

const stopDrag = chart.subscribePriceLineDrag(event => {
  if (event.phase === 'end') {
    lines = lines.map(line => (line.id === event.id ? { ...line, price: event.price } : line));
    chart.setPriceLines(lines);
  }
  // A string returned on start or move labels the line while it is dragged.
  if (event.phase === 'move') return `${(event.price - event.fromPrice).toFixed(2)}`;
});
```

The event's `phase` is `start`, `move`, `end` or `cancel`. The user cancels with Escape. Prices snap to the instrument's tick size. With `drag: 'copy'` the line stays put and the user drags out a new one, which suits placing a target from an entry.

### React to the close box

`closable: true` adds a × box to the line's tag. Clicking it reports a `close` action:

```ts
const stopActions = chart.subscribePriceLineAction(event => {
  if (event.action === 'close') console.log('cancel order', event.id);
});
```

Both subscriptions return a function that removes the listener.

## Markers

Markers are shapes at a time and price, such as fills or large trades. Like price lines, `setMarkers` replaces the whole set and they are view state only.

```ts
const last = chart.inspect().latestCandle!;
chart.setMarkers([
  { timeMs: last.timeMs, price: last.low, shape: 'triangle-up', color: '@positive', label: 'Buy 2' },
  { timeMs: last.timeMs, price: last.high, glyph: 'S', color: '@negative' },
]);
```

`shape` is `circle` (the default), `triangle-up` or `triangle-down`. `glyph` draws one or two characters inside a circle. `size` is the radius in CSS pixels, default 5.

## Link charts

`createChartGroup` links several bare charts. Hovering one shows a time line on the others, and panning one moves the others.

```ts
import { createChart, createChartGroup } from 'candleframe/chart';
import { createSimulatedFeed } from 'candleframe/core';

const left = createChart(document.querySelector<HTMLElement>('#left')!, {
  feed: createSimulatedFeed({ interval: '1m' }),
});
const right = createChart(document.querySelector<HTMLElement>('#right')!, {
  feed: createSimulatedFeed({ interval: '5m' }),
});

const group = createChartGroup([left, right], { crosshair: true, time: true });
group.setSync({ dateRange: true });

// Later
group.dispose(); // Unlinks the charts. They stay mounted.
left.dispose();
right.dispose();
```

| Sync setting | Effect | Default |
| --- | --- | --- |
| `crosshair` | Hovering one plot shows a time line on the others. | `true` |
| `time` | Scrolling aligns the right edge in time. Each chart keeps its own zoom. | `true` |
| `dateRange` | Every chart shows the same time range, within its 3 to 2,200 bar limit. Implies `time`. | `false` |

The group also has `add(chart)`, `remove(chart)`, `getSync()` and `align(chart)`, which moves the others to that chart's position right away. Navigation the group applies adds no undo steps. Symbol and interval stay with you, because you own the feeds.

### Link charts your own way

The group is built on two chart methods you can call directly. `subscribeCrosshair` reports the hovered bar's time while the pointer is over a plot, then `null`. `setCrosshair` draws a time line on another chart, or hides it with `null`.

```ts
import { createChart } from 'candleframe/chart';

declare const other: ReturnType<typeof createChart>;

const unlink = chart.subscribeCrosshair(timeMs => other.setCrosshair(timeMs));
```

## Dispose

```ts
chart.dispose();
```

`dispose` closes the feed connection, frees its WebGL buffers and programs, and removes the chart's element from the host. Calling it twice is harmless.
