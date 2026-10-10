# Theming

`createTheme(base, overrides)` produces a complete, validated, immutable theme. Pass it to either `createChart` or `createChartWidget`, or apply it later with `chart.setTheme(theme)`. `chart.getTheme()` returns an owned copy suitable for JSON export. Appearance changes do not enter document history.

| Group | Controls |
| --- | --- |
| `palette` | Semantic surface, text, accent, market, grid and drawing colors |
| `typography` | UI, heading, numeric and annotation families; text sizes and weights |
| `layout` | Spacing multiplier, toolbar/footer, rail, controls, order book rows, summary and dialogs |
| `effects` | Borders, corners, focus rings, icon stroke and scale, state opacity, shadows |
| `chart` | Plot insets, axis space, grid, candles, wicks, volume, indicators, crosshair, last price, watermark, drawing chrome and heatmap |

The exported `themeTokenSchema` is the authoritative token inventory. Every descriptor includes its default and kind; numeric descriptors include bounds, step and units. Numbers use CSS pixels unless the descriptor declares `ratio`. The Appearance editor, validator and CSS adapter share this registry.

```ts
import { createTheme, themeTokenSchema } from './dist/lib/index.js';

const theme = createTheme('evergreen', {
  id: 'terminal', name: 'Terminal',
  typography: { headingFamily: 'Arial, sans-serif', titleSize: 18 },
  layout: { spacingScale: 0.75, railWidth: 36, railButtonSize: 26 },
  chart: { candleUp: '@positive', wickWidth: 1.5, watermarkText: 'My terminal' },
});
chart.setTheme(theme);
console.log(themeTokenSchema.chart.wickWidth);
const portable = JSON.stringify(chart.getTheme());
chart.setTheme(JSON.parse(portable));
```

Palette colors require six-digit hex. Visual color tokens also accept references such as `@accent`; references survive serialization. Changing the palette updates linked colors. A concrete hex override stays independent of palette changes. An empty dash array means a solid line.

The version-1 format rejects unknown tokens, unsupported versions, malformed font strings and values outside declared bounds. Validation finishes before applying a theme. Older objects containing `id`, `name`, `mode` and `palette` acquire the new defaults. Partial groups merge by token, without retaining caller-owned arrays or objects.

The widget sets variables on its own shadow host, so separate widgets can use different themes. Both canvas layers and WebGL use that same resolved theme. Geometry changes update rendering and pointer hit regions together. CSS-only host overrides remain available for compatibility, but do not affect canvas pixels or exported images.

Saved drawings retain their authored style. Drawing defaults follow the theme only while unchanged by the user. Indicators with explicit colors retain them; indicators can instead opt into a semantic theme color. A theme cannot change a market, scale mode, data range or plugin behavior. Custom fonts must be available to the document; the bundled fonts have system fallbacks.

The widget stores the active theme separately from market layouts when `storageKey` is supplied. Appearance → Customize theme includes token search, reset controls and JSON import/export. The JSON editor applies the same validation as the host API. There is no requirement to use this UI: hosts and agents can work entirely through the exported functions and schema.

For host-specific chrome, the widget exposes CSS shadow parts: `widget`, `toolbar`, `drawing-toolbar`, `chart-panel`, `chart-summary`, `order-book`, `footer`, `dialog`, `drawing-controls`, `drawing-menu`, `drawing-properties` `text-editor` and `position-editor`. For example, `.candleframe-widget::part(toolbar) { letter-spacing: 0.02em; }`. These hooks style HTML only. Use theme tokens for values shared with canvas.
