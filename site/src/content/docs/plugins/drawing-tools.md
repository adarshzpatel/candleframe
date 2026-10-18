---
title: Custom drawing tools
description: Add your own drawing tools with DrawingToolDefinition, give them settings and custom handles, and keep their drawings safe in saved layouts.
---

A custom drawing tool appears in the widget's drawing rail next to the built-in tools. Users place, select, move, style, undo and save its drawings like any other. You declare how many points the tool takes and write a `project` function that turns those points into lines, fills and text. The chart does the pointer handling, hit testing, selection, undo and persistence.

This page builds a price target tool with settings, then a time window tool with custom handles, and covers how layouts keep drawings whose tool is missing.

## A first tool

```ts
import type { DrawingToolDefinition } from 'candleframe/core';
import { createChartWidget } from 'candleframe/widget';

const level: DrawingToolDefinition = {
  type: 'acme:level',
  label: 'Level',
  group: 'Custom',
  points: 1,
  hint: 'Click a price.',
  project(drawing, { geometry: g }) {
    const y = g.y(drawing.points[0].price);
    return [{ kind: 'path', points: [{ x: g.left, y }, { x: g.left + g.plotWidth, y }] }];
  },
};

const widget = createChartWidget(host, { feed, drawingTools: [level] });
```

Pass definitions in the `drawingTools` option. `createChart`, `createChartWidget` and `ChartRuntime` all take it. The headless runtime needs the definitions too, so it can validate drawings and report which ones it supports.

The tool's `type` is what saved drawings store. It must start with a letter and use letters, digits, `.`, `_`, `:` and `-`, up to 80 characters. Prefix it with your own namespace, such as `acme:`, so it never collides with a future built-in. A type that is already registered throws `DUPLICATE_DRAWING_TOOL`. A definition with missing or wrong fields throws `INVALID_DRAWING_TOOL`.

## The definition

`DrawingToolDefinition` is in `src/drawing-types.ts`.

| Field | Required | What it does |
| --- | --- | --- |
| `type` | yes | The stored drawing type. |
| `label` | yes | The tool's name in menus and the object list. |
| `group` | yes | The rail button the tool lives under. Built-in groups come first. New groups follow in the order you register them. |
| `section` | no | A heading inside the group's menu, such as Channels under Lines. |
| `points` | yes | A count from 1 to 1024, `'path'` (click points, finish with Enter or a double-click) or `'freehand'`. Paths and freehand drawings need at least 2 points. |
| `hint` | yes | The instruction shown while placing. |
| `project(drawing, context)` | yes | Returns the primitives to paint. |
| `validate(drawing)` | no | Throws to reject a drawing. |
| `settings` | no | Fields for the settings form. Values are stored in `drawing.options`. |
| `handles(drawing, context)` and `moveHandle(drawing, id, anchor, context)` | no, but both or neither | Custom edit handles. |
| `create(anchor, context)` | no | One-click placement that returns all the points. |
| `editableText` | no | Opens a text editor after placement and when the drawing is activated. |
| `editableProperties` | no | Activating the drawing (double-click or Enter) calls the bare chart's `onDrawingEdit` without opening anything on placement. |
| `fixedToPlot` | no | The drawing stays at one spot on the plot while the chart pans and zooms. The spot is stored in `options.plotX` and `options.plotY`. |

There is no icon field. Custom tools use the trend line icon in the rail and menus.

## Project to primitives

`project` runs on every paint of a visible drawing. It gets the stored `Drawing` and a `DrawingContext`, and returns an array of primitives in CSS pixels. The same primitives are hit-tested, so a click on a line or fill you return selects the drawing.

The parts of the context you will use most:

| Field | What it holds |
| --- | --- |
| `geometry` | The displayed chart geometry. `x(timeMs)` and `y(price)` map to pixels. `left`, `top`, `plotWidth` and `plotHeight` bound the price plot. `price(y)` and `anchor(x, y)` map back. |
| `formatPrice(price)` | The instrument's price format. |
| `formatTime(timeMs)` | The axis time format. Headless hosts may leave it out. |
| `intervalMs`, `interval` | The chart's bar length and interval string. |
| `tickSize` | The instrument's tick size, when the host supplies it. |
| `candles` | The loaded candles, for tools that read price history. |
| `theme` | The resolved chart theme. May be missing headless. |
| `selected`, `hovered` | Whether this drawing is selected or under the pointer, for details shown only then. |

Three primitive kinds exist. Anything left out falls back to the drawing's own style, which the user sets in the drawing toolbar.

| Kind | Fields | Defaults |
| --- | --- | --- |
| `path` | `points`, `closed`, `fill`, `color`, `width`, `dash`, `opacity` | Stroke in `style.color` at `style.width`, dashed or dotted per `style.lineStyle`. A `fill` uses `style.fillOpacity`, unless `width` is 0 and `opacity` is set. `width: 0` draws no stroke. |
| `text` | `at`, `text`, `color`, `size`, `align`, `middle`, `background`, `plain`, `bold`, `italic`, `border`, `radius`, `wrap`, `angle`, `backgroundOpacity` | Text in `style.color` on the theme's annotation background. `plain: true` drops the box. `middle: true` centres it vertically on `at`. |
| `axis` | `axis` (`'price'` or `'time'`), `value`, `color`, `text` | A tag in the axis gutter at `value`, showing the formatted price or time. |

Paths and text are clipped to the price plot. Axis tags draw outside the clip.

While the user is still placing a drawing, `project` receives a preview with fewer points than `points`. Read the later points with a fallback, as in `const [entry, target = entry] = drawing.points`.

:::note
The library builds its own tools with helpers such as `screen`, `line`, `rectangle`, `fill` and `text` from `src/drawing-primitives.ts`. They are not exported, so a plugin writes primitives as plain objects. `drawingOption`, which reads a setting, is exported.
:::

## Worked example: a price target

This tool takes an entry and a target. It shades the zone between them, draws the target line, labels the move and tags the price axis. Its settings choose the label and the zone colour.

```ts
import { drawingOption, type DrawingPrimitive, type DrawingToolDefinition } from 'candleframe/core';

export const priceTarget: DrawingToolDefinition = {
  type: 'acme:price-target',
  label: 'Price target',
  group: 'Custom',
  section: 'Targets',
  points: 2,
  hint: 'Click the entry, then the target.',
  settings: [
    { key: 'extend', label: 'Extend right', kind: 'boolean', default: false, section: 'Line' },
    {
      key: 'label',
      label: 'Label',
      kind: 'select',
      default: 'percent',
      choices: [
        { value: 'percent', label: 'Percent' },
        { value: 'price', label: 'Price' },
        { value: 'none', label: 'None' },
      ],
      section: 'Text',
    },
    { key: 'zoneColor', label: 'Zone colour', kind: 'color', default: '', section: 'Zone' },
    { key: 'zoneOpacity', label: 'Opacity', kind: 'number', default: 0.12, min: 0, max: 1, step: 0.01, section: 'Zone' },
  ],
  validate(drawing) {
    const [a, b] = drawing.points;
    if (a.timeMs === b.timeMs && a.price === b.price) throw new Error('PRICE_TARGET_EMPTY');
  },
  project(drawing, context) {
    const option = <T extends boolean | number | string>(key: string) => drawingOption<T>(drawing, priceTarget, key);
    const g = context.geometry;
    // While placing, the preview may have only the entry.
    const [entry, target = entry] = drawing.points;
    const x1 = g.x(entry.timeMs);
    const x2 = option<boolean>('extend') ? g.left + g.plotWidth : g.x(target.timeMs);
    const y1 = g.y(entry.price);
    const y2 = g.y(target.price);
    const scene: DrawingPrimitive[] = [
      {
        kind: 'path',
        points: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
        closed: true,
        fill: option<string>('zoneColor') || drawing.style.color, // empty: follow the drawing colour
        width: 0,
        opacity: option<number>('zoneOpacity'),
      },
      { kind: 'path', points: [{ x: x1, y: y2 }, { x: x2, y: y2 }] },
      { kind: 'axis', axis: 'price', value: target.price },
    ];
    const label = option<string>('label');
    if (label !== 'none') {
      const change = (target.price - entry.price) / entry.price;
      scene.push({
        kind: 'text',
        at: { x: x2, y: y2 },
        text:
          label === 'percent'
            ? `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`
            : context.formatPrice(target.price),
        align: 'right',
        middle: true,
      });
    }
    return scene;
  },
};
```

Agents and scripts can place it with a command:

```ts
chart.execute({
  type: 'drawing.add',
  drawing: {
    id: 'target-1',
    type: 'acme:price-target',
    points: [
      { timeMs: Date.UTC(2026, 9, 16, 14), price: 100 },
      { timeMs: Date.UTC(2026, 9, 16, 18), price: 105 },
    ],
    options: { zoneOpacity: 0.2 },
  },
});
```

## Settings

Each entry in `settings` becomes a field in the widget's settings form, grouped under its `section`.

| `kind` | Extra fields | Stored value |
| --- | --- | --- |
| `boolean` | | `true` or `false` |
| `select` | `choices: { value, label }[]` | One of the choice values |
| `color` | | A hex colour: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. An empty `default` means "follow the drawing's colour" until the user picks one. |
| `number` | `min`, `max`, optional `step` | A number within `min` and `max` |

Setting keys use letters and digits only, starting with a letter. `drawing.options` stores only the values that differ from their defaults, so the drawing above saves `{ zoneOpacity: 0.2 }` and nothing for `label`. Read a value with `drawingOption(drawing, definition, key)`, which falls back to the default.

The runtime checks options on every add and update. A wrong type, an out-of-range number or an unknown choice fails with `INVALID_DRAWING_OPTIONS`, and the document does not change. `inspect().capabilities.drawingTools` lists each tool's settings, so an agent can discover them.

## Validate drawings

`validate` runs whenever the runtime normalizes a drawing of your type. That happens on `drawing.add`, on `drawing.update` and when a document is restored. Throw to reject it. The edit fails as a whole and the document, its revision and the undo stack stay as they were.

The runtime has already checked the basics by then: the point count, the style, the text length and the options. `validate` is for rules only your tool knows, such as "the entry and target must differ".

## Custom handles

By default each stored point gets a handle that moves it freely. `handles` and `moveHandle` replace that. You must supply both or neither.

`handles` returns where to draw each handle and which cursor it shows (`'move'`, `'ns-resize'` or `'ew-resize'`). Use string ids. `moveHandle` gets the drawing as it was when the drag started, the handle id and the anchor under the pointer. It returns the new points.

This time window tool shades a span of time across the whole plot. Its two handles sit halfway down and only change time:

```ts
import type { DrawingToolDefinition } from 'candleframe/core';

export const timeWindow: DrawingToolDefinition = {
  type: 'acme:time-window',
  label: 'Time window',
  group: 'Custom',
  points: 2,
  hint: 'Click the start and end of the window.',
  project(drawing, { geometry: g }) {
    const [start, end = start] = drawing.points;
    const left = g.x(start.timeMs);
    const right = g.x(end.timeMs);
    return [
      {
        kind: 'path',
        points: [
          { x: left, y: g.top },
          { x: right, y: g.top },
          { x: right, y: g.top + g.plotHeight },
          { x: left, y: g.top + g.plotHeight },
        ],
        closed: true,
        fill: drawing.style.color,
      },
    ];
  },
  handles(drawing, { geometry: g }) {
    const y = g.top + g.plotHeight / 2;
    return [
      { id: 'start', at: { x: g.x(drawing.points[0].timeMs), y }, cursor: 'ew-resize' },
      { id: 'end', at: { x: g.x(drawing.points[1].timeMs), y }, cursor: 'ew-resize' },
    ];
  },
  moveHandle(drawing, handle, anchor) {
    const [start, end] = drawing.points;
    return handle === 'start'
      ? [{ timeMs: anchor.timeMs, price: start.price }, end]
      : [start, { timeMs: anchor.timeMs, price: end.price }];
  },
};
```

The magnet does not snap a handle whose cursor is `'ew-resize'`. The built-in bars pattern tool in `src/drawing-tools-forecast.ts` uses the same idea for its edge handles.

## Saved layouts and missing tools

Drawings are saved in the chart document as `Drawing` records with their `type`, points, style, text, levels and options. A document can come back on a chart that does not have your tool, for example an older app version or a different host. The runtime keeps those drawings instead of dropping them:

- The drawing stays in the document unchanged, so saving again does not lose it.
- It does not draw, cannot be hit and shows no handles.
- `state().unsupportedDrawingTypes` and `inspect().unsupportedDrawingTypes` list its type.
- The widget's object list shows it as "Unsupported: acme:price-target".

When the same document loads on a chart that registers the tool, the drawing draws again, and `validate` runs on it then.

## Drawing tools are trusted code

`project`, `validate`, `handles` and `moveHandle` run on the main thread with no sandbox, on every paint and pointer move. Keep them fast and free of side effects, and register only code you ship. Do not run drawing tools written by your users.
