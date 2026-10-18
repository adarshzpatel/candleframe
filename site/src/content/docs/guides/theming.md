---
title: Themes
description: Pick a built-in theme, derive your own with createTheme, switch themes at runtime and follow the system color scheme.
---

A theme sets every color, font, size and spacing value the chart and widget draw with, on the canvas and in the HTML controls. This page shows how to choose a preset, make your own theme and change it at runtime.

```ts
import { createChartWidget, createTheme } from 'candleframe';

const chart = createChartWidget(host, {
  feed,
  theme: createTheme('midnight', {
    palette: { accent: '#7152a3' },
    chart: { candleUp: '@accent', watermarkText: 'ACME Terminal' },
  }),
});
```

## Presets

Six presets ship with the library. Pass the id as `theme`, or read the resolved themes from `chartThemes`.

| Id | Name | Mode |
| --- | --- | --- |
| `graphite` | Graphite | dark |
| `evergreen` | Evergreen | dark |
| `midnight` | Midnight | dark |
| `monochrome` | Monochrome | dark |
| `paper` | Paper | light |
| `sand` | Sand | light |

```ts
import { chartThemes } from 'candleframe/chart';

chart.setTheme('sand');
console.log(chartThemes.graphite.palette.accent);
```

Monochrome draws white up candles and gray down candles. It keeps green and red for P&L and order flow.

## The default theme

Without a `theme` option, charts start in Graphite, or in Paper when the system asks for light colors. `systemThemeId()` returns the id the chart would pick.

The widget also follows later system changes, until the user picks a theme in the Appearance panel or your code calls `setTheme`. The bare chart from `createChart` picks once at mount and does not follow changes.

## Make your own theme

`createTheme(base, overrides)` starts from a preset and merges your changes token by token. It validates the result and returns a complete, frozen theme.

```ts
import { createTheme } from 'candleframe/chart';

const theme = createTheme('paper', {
  id: 'my-product',
  name: 'My product',
  palette: { accent: '#7152a3' },
  typography: { uiFamily: 'Arial, sans-serif', axisSize: 12 },
  layout: { spacingScale: 0.85, controlHeight: 28 },
  effects: { radius: 4 },
  chart: { gridOpacity: 0.5, crosshairDash: [2, 5], watermarkText: 'My product' },
});
chart.setTheme(theme);
```

The overrides have five groups:

| Group | Covers |
| --- | --- |
| `palette` | The semantic colors: background, surfaces, borders, text, accent, positive and negative, grid, crosshair, six indicator slots, drawing and watermark |
| `typography` | UI, heading, number and annotation font families, text sizes and weights |
| `layout` | Spacing scale, toolbar and footer heights, rail, controls, summary and dialogs |
| `effects` | Corners, borders, focus rings, icon stroke and scale, hover and selected opacity, shadows |
| `chart` | Plot insets, axes, grid, candles and wicks, volume, line and area types, last price, crosshair, watermark and drawing handles |

Palette colors must be six-digit hex. Color tokens in the other groups also accept a palette reference such as `@positive`. A reference stays linked, so changing the palette later recolors everything that points at it. A hex value stays fixed.

`createTheme` throws a `ChartError` for unknown tokens, values out of range and malformed colors. The chart keeps its current theme when that happens. Tokens that later versions retired are ignored instead, so older saved themes still load.

The watermark is empty by default. Set `chart.watermarkText` to show one.

## Tokens

`themeTokenSchema` lists every token with its kind and default. Number tokens also carry `min`, `max`, `step` and `unit`. Numbers are CSS pixels unless `unit` is `'ratio'`. Use it to build your own settings UI or to validate a theme an agent wrote.

```ts
import { themeTokenSchema, themeTokenDefaults } from 'candleframe/chart';

const wick = themeTokenSchema.chart.wickWidth;
console.log(wick.kind, wick.default, wick.min, wick.max); // number 1 0.5 4

console.log(themeTokenDefaults.typography.numberFamily);
```

Token kinds are `number`, `font`, `color`, `text` and `dash`. A dash is an array of segment lengths, and an empty array draws a solid line.

## Change the theme at runtime

`setTheme` takes a preset id or a theme object. `getTheme` returns a copy of the current theme that you can serialize.

```ts
chart.setTheme('midnight');

const portable = JSON.stringify(chart.getTheme());
chart.setTheme(JSON.parse(portable));
```

A theme change is view state. It does not touch the market, viewport, drawings, document revision or undo history. On a widget grid, `setTheme` applies to every chart.

`onThemeChange` receives a copy of each new theme. Use it to match the rest of your page:

```ts
import { createChartWidget } from 'candleframe/widget';

createChartWidget(host, {
  feed,
  onThemeChange: theme => {
    document.documentElement.style.background = theme.palette.background;
  },
});
```

## Saved appearance in the widget

With a `storageKey`, the widget saves the user's appearance in `localStorage` and restores it on the next mount. It saves only the differences from the preset (see `compactTheme`), so preset changes in later versions still reach saved themes. A `theme` option you pass at mount wins over the saved one. `restoreTheme` reads a saved appearance back into a full theme.

The widget's Appearance panel has a Customize theme section that edits the same tokens, with JSON import and export. Imported JSON goes through the same validation as `createTheme`.

## Indicator colors

Built-in indicators draw in the palette's indicator slots, `indicator` to `indicator6`, so they change with the theme. A custom indicator keeps its own `color` unless it sets `themeColor` to one of those slots. See [Outputs and panes](../../indicators/outputs-and-panes/).

## Style the widget's HTML

The widget exposes CSS shadow parts for host-specific tweaks to its HTML controls, such as `toolbar`, `footer`, `dialog` and `chart-panel`:

```css
.candleframe-widget::part(toolbar) {
  letter-spacing: 0.02em;
}
```

Parts style HTML only. Canvas pixels and PNG exports ignore them, so use theme tokens for anything the plot also draws.
