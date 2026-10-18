---
title: Plugins
description: The ways you can extend CandleFrame, how each one is packaged, and what plugin code can and cannot do.
---

CandleFrame has no plugin loader and no global registry. Every extension is a plain object or function that you pass in when you create a chart, or attach to one afterwards. This page lists the extension points, shows how they fit together, and says where each one stops.

## Extension points

| Extend | You write | Pass it as | Works with |
| --- | --- | --- | --- |
| Indicators | `IndicatorPlugin` objects | `indicators` | `createChart`, `createChartWidget`, `ChartRuntime` |
| Indicator kinds for the menu, commands and layouts | `IndicatorDefinition` | `indicatorDefinitions` | same three |
| Drawing tools | `DrawingToolDefinition` | `drawingTools` | same three |
| Trading | a `BrokerAdapter` | `attachTrading(chart, { broker, host })` from `candleframe/trading` | `createChart`, `createChartWidget` |
| Market data | a `FeedAdapter` | `feed`, or `markets` for the widget's pickers | all three |
| Themes | a theme id, or a theme from `createTheme` | `theme`, or `setTheme()` later | `createChart`, `createChartWidget` |
| Layout storage | `WidgetLayoutStore`, `DrawingTemplateStore`, `DrawingFavouriteStore` | `layoutStore`, `drawingTemplateStore`, `drawingFavouriteStore` | `createChartWidget` |
| Host overlays | `PriceLine` and `ChartMarker` arrays | `setPriceLines()`, `setMarkers()` | `createChart`, `createChartWidget` |
| Rendering | a `ChartRenderer` | `renderer` | `createChart`, `createChartWidget` |

The widget's options extend the bare chart's, so anything `createChart` takes, `createChartWidget` takes too.

### Indicators

An indicator is an object with a `calculate` function that returns one value per candle, or `calculateOutputs` for several series. Pass instances in `indicators` to start a chart with them. Register an `IndicatorDefinition` to let users add the kind from the Indicators menu, let agents add it with `indicator.add`, and let saved layouts restore it. See [Build an indicator](../../indicators/build-an-indicator/), [Outputs, panes and styles](../../indicators/outputs-and-panes/) and [Indicator registry](../../indicators/registry/).

### Drawing tools

A drawing tool declares how many points it takes and projects them to lines, fills, text and axis tags. The chart handles placement, hit testing, selection, undo and saving. Tools can declare settings, validation and custom handles. See [Custom drawing tools](../drawing-tools/).

### Trading

Order entry is its own entry point, `candleframe/trading`, kept out of the chart and the widget. `attachTrading` adds an order panel and draws orders and positions on any chart or widget. Orders go through a `BrokerAdapter`. `createPaperBroker` is a simulated one for demos. See [Trading plugin](../trading/).

### Feeds, themes and storage

These are interfaces the chart calls, not plugins in the menu sense, but they are how you connect CandleFrame to the rest of your app.

- A `FeedAdapter` has a `descriptor` and a `connect(emit)` method that pushes candles and depth. See [Feeds](../../feeds/overview/).
- A theme is a built-in id such as `'graphite'`, or a theme object made with `createTheme(base, overrides)`. See [Theming](../../guides/theming/).
- The widget saves layouts, drawing templates and favourite tools to browser storage under `storageKey`. The three store options send them to your own backend instead. See [Layouts](../../guides/layouts/).

### Host overlays

`setPriceLines` and `setMarkers` draw lines and markers your app owns, such as alerts or fills. They are view state only. They are not saved, not undoable and not editable by the user. `subscribePriceLineDrag` and `subscribePriceLineAction` tell you when the user drags a line or clicks its ×, and your code decides what that means. The trading plugin uses these four calls to draw and edit orders. While it is attached it owns the lines and markers, so do not set your own at the same time.

### Renderer

`renderer` replaces the WebGL2 pass. A `ChartRenderer` has a `name`, `mount(canvas, invalidate, onStatus)`, `render(frame)` returning `RendererStats`, and `dispose()`. The default is `WebGL2Renderer`. The renderer draws candles, volume, indicator series, fills and the heatmap. Drawings, indicator dots, profiles, axes and host overlays are painted on a separate Canvas 2D layer and are not part of it. Most apps never need this. The `heatmap` field of `RenderFrame` uses a type that is not exported.

## Put them together

A plugin package is an ordinary module that exports these objects. Here one module ships an indicator kind and a drawing tool, and the app wires them in with trading:

```ts
import type { DrawingToolDefinition, IndicatorDefinition } from 'candleframe/core';
import { attachTrading, createPaperBroker } from 'candleframe/trading';
import { createChartWidget } from 'candleframe/widget';

// acme-plugins.ts
export const acmeIndicators: IndicatorDefinition[] = [
  {
    kind: 'acme-range',
    name: 'Bar range',
    description: 'High minus low of each bar.',
    pane: 'separate',
    inputs: {},
    create: (_, id) => ({
      id,
      name: 'Bar range',
      pane: 'separate',
      color: [0.66, 0.74, 1, 0.95],
      calculate: candles => candles.map(bar => bar.high - bar.low),
    }),
  },
];
export const acmeTools: DrawingToolDefinition[] = [
  {
    type: 'acme:level',
    label: 'Level',
    group: 'Acme',
    points: 1,
    hint: 'Click a price.',
    project(drawing, { geometry: g }) {
      const y = g.y(drawing.points[0].price);
      return [{ kind: 'path', points: [{ x: g.left, y }, { x: g.left + g.plotWidth, y }] }];
    },
  },
];

// app.ts
const widget = createChartWidget(host, {
  feed,
  indicatorDefinitions: acmeIndicators,
  drawingTools: acmeTools,
});
const trading = attachTrading(widget, { broker: createPaperBroker(), host });
```

Register the same definitions everywhere a document might load: the widget, any bare charts, and headless runtimes on your server. A chart without them keeps the saved indicators and drawings but cannot draw them. It reports them in `unsupportedIndicatorKinds` and `unsupportedDrawingTypes`.

## What plugins can and cannot do

Plugins can:

- Compute any per-bar series from the candles, including `buyVolume`, `footprint`, `deltaRange` and `largeTrades` when the feed supplies them.
- Draw series as lines, histograms, columns, dots, fills between series and recoloured candles, on the price pane or in their own pane.
- Draw drawings from paths, fills, text and axis tags, with settings, validation and custom handles.
- Send orders through any broker you can reach from the page, through an adapter.

Plugins cannot:

- Draw arbitrary graphics from an indicator. Indicators return numbers and choose from the built-in styles. Profile-style indicators configure the built-in profile, bubble and flow-signal renderers. They cannot add their own.
- Compute asynchronously. `calculate` returns its array synchronously. Fetch data elsewhere and put it on the candles, or on a feed.
- See anything but candles. Indicators get no order book, drawings or other charts.
- Handle pointer events in a drawing tool, or give it an icon. The chart owns input, and custom tools use the trend line icon.
- Add buttons or panels to the widget. Build your UI around the widget and drive it with [commands](../../reference/commands/).

## Plugins run as trusted code

Every extension point runs your code on the main thread, in your page, with no sandbox. An indicator or drawing tool can read anything the page can and can stall rendering with a slow loop. A broker adapter sees every order.

Treat plugins as part of your application and ship only code you wrote or reviewed. Do not load indicator or drawing-tool code supplied by your users and run it as a plugin. The plugin contracts are not a safe way to execute untrusted scripts.
