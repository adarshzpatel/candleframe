# Embed the complete chart widget

`createChartWidget` mounts the chart and its controls in one sized container. It returns `ChartWidgetApi`: the `ChartApi` of `createChart` plus grid controls, acting on the active chart. The demo uses this public entry point; no demo markup, global CSS, framework or runtime dependency is required.

```ts
import { createChartWidget, createSimulatedFeed, sma } from 'candleframe';

const container = document.querySelector<HTMLElement>('#chart')!;
container.style.height = '600px';
const chart = createChartWidget(container, {
  feed: createSimulatedFeed(),
  indicators: [sma(20)],
  orderBook: true,
  storageKey: 'terminal-main-chart',
});

chart.execute({ type: 'priceScale.reset' });
chart.setTool('fib-retracement');
chart.inspect();
chart.exportDocument();
chart.dispose(); // Unmounts controls, observers, subscriptions and the engine.
```

Give the container a nonzero width and height. A useful minimum is 360 by 420 CSS pixels. The widget fills its container, adapts controls to its width and observes plot size changes. At widths of 850 pixels or less, the order book starts closed and opens as a dismissible panel over the chart. Wider embeds can show it alongside the chart. Depth rows adapt to the available height so both bids and asks stay visible around the midpoint. The toolbar, drawing picker, object properties, help, notifications and PNG preview stay inside the widget.

The widget owns an open shadow root. Host CSS cannot accidentally restyle its buttons or hide its canvases. Multiple widgets have separate drawing selections, menus, history, session saves and lifecycles. Use `createChart` when the application supplies its own controls.

## Market selection

Without a market catalog, the current source, symbol and interval are read-only. Supply factories to enable these controls:

```ts
const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const;
const chart = createChartWidget(container, {
  feed: createSimulatedFeed({ symbol: symbols[0] }),
  markets: [{
    id: 'simulated', // Must match the adapter's descriptor.id.
    label: 'Simulation',
    symbols,
    intervals: ['1m', '5m', '15m', '1h'],
    createFeed: ({ symbol, interval }) => createSimulatedFeed({
      symbol: symbol as typeof symbols[number], interval,
    }),
  }],
});
```

Factories synchronously return disconnected `FeedAdapter` instances. Adapters own asynchronous history, sockets, recovery and disposal. The widget validates source, symbol and interval before replacing the current feed. A factory error retains the previous market. Host calls to `replaceFeed` update the controls too. Changing source or symbol clears drawings; changing the interval preserves time/price anchors.

The optional order book uses the adapter's depth events. Indicator controls reflect the supplied plugins. Drawing tools from `drawingTools` appear in the same picker as built-ins. Existing chart callbacks are composed with internal UI callbacks.

## Layout storage

The widget autosaves the layout 400 ms after each document change, and saves any pending change when the page is hidden, the market switches or the widget is disposed. It loads the saved layout on mount and after each market switch, keeping the live viewport and an automatic price range; that load adds no undo step. Without a namespace, layouts last for the widget session. Set a stable `storageKey` to use localStorage. Give independently saved charts different namespaces. Keys include the namespace, source, symbol and interval. Save writes immediately; Restore reloads the saved layout, including its viewport.

For server-backed or application storage, supply `layoutStore` and a namespace:

```ts
createChartWidget(container, {
  feed,
  storageKey: 'workspace-42:left-chart',
  layoutStore: {
    load: key => applicationLayouts.load(key),
    save: (key, value) => applicationLayouts.save(key, value),
    remove: key => applicationLayouts.remove(key), // Optional; used when a saved layout is deleted.
  },
});
```

Methods may be synchronous or return promises. `load` returns the saved value, `null` or `undefined`. Values are chart documents, saved grid layouts (`WidgetWorkspace`) and the list of saved layouts (`WidgetWorkspaceIndex`); store them as opaque JSON. A pending load cannot overwrite newer edits, a different market or a disposed widget. Layout validation and v1/v2 migrations remain in the runtime. The demo also reads layouts saved under its previous storage key.

## Chart grids and saved layouts

The **Layout** button in the header opens the grid presets, the sync checkboxes and the saved layouts. Grids need a `markets` catalog, because each extra chart creates its own feed. A new chart copies the active chart's market.

```ts
const chart = createChartWidget(container, {
  feed,
  markets,
  storageKey: 'terminal',
  layout: { preset: '2x2', sync: { interval: true } },
});

chart.charts(); // Four ChartApi objects in cell order. The widget disposes them.
chart.setActiveChart(2); // The toolbar, keyboard shortcuts and the widget API now act on chart 3.
chart.execute({ type: 'viewport.reset' }); // Runs on the active chart.
chart.setLayout({ preset: '1+2', sync: { symbol: true } });
chart.getLayout(); // { preset: '1+2', sync: { symbol: true, interval: true, crosshair: true, ... } }
```

The presets are `1`, `2h`, `2v`, `1+2`, `2x2`, `3x2` and `4x2`. Each chart owns a WebGL context, and browsers allow about 16 per page, so the largest grid holds 8. Each chart also opens its own feed connection.

| Sync option | Effect | Default |
| --- | --- | --- |
| Symbol | A symbol or source change applies to every chart. Each keeps its interval. | Off |
| Interval | An interval change applies to every chart. | Off |
| Crosshair | Hovering one chart draws a time line on the others; their summaries show that bar. | On |
| Time | Panning or zooming one chart moves the others to the same right edge. Each keeps its zoom. | On |
| Date range | Every chart shows the same time range, within its 8 to 2,200 bar limit. | Off |

Synced navigation adds no undo steps. While a chart follows live data, each new bar moves its view, but other charts stay where they are; only returning to live or leaving it is linked. Turning an option on brings the other charts to the active one.

Click a chart, focus it, or press Alt + 1 to 8 to make it active. A selected drawing tool moves with the click, so a line can start on any chart. Appearance and drawing defaults apply to every chart. Below 580 pixels wide the grid shows only the active chart, with tabs for the rest.

Chart documents stay per market. Charts in one grid that show the same source, symbol and interval share drawings and indicators: an autosave from one updates the others and keeps each chart's own view. Saved layouts hold the preset, sync settings, active chart and each chart's market. Changes save into the open layout; **Save as new** starts another. On mount the widget reopens the last layout, but the first chart keeps the host's `feed`.

To link bare charts from `createChart`, use `createChartGroup`. It handles crosshair, time and date range; symbol and interval belong to the host, which owns the feeds.

```ts
import { createChart, createChartGroup } from 'candleframe/chart';

const left = createChart(leftHost, { feed: btc1m });
const right = createChart(rightHost, { feed: btc1h });
const group = createChartGroup([left, right], { crosshair: true, time: true });
group.setSync({ dateRange: true });
group.dispose(); // Unlinks; the charts stay mounted.
```

`chart.setCrosshair(timeMs)` and `chart.subscribeCrosshair(listener)` are the hooks the group uses, for hosts that link charts their own way.

## Drawings and themes

Drawing settings appear in a floating bar when a drawing tool or object is selected. The layers button in the chart header opens the object list. Tool categories and individual drawing tools use a shared SVG icon set, with keyboard labels and tooltips.

## Themes

Open Appearance with the palette button in the top toolbar. Evergreen is the default forest-green palette. The widget also includes Graphite and Midnight dark palettes, and Paper and Sand light palettes. Its picker previews each palette and applies changes immediately.

Both the bare chart and the complete widget accept the same theme API:

```ts
import { createChartWidget, createTheme } from 'candleframe';

const chart = createChartWidget(container, { feed, theme: 'midnight' });
chart.setTheme('paper');
const current = chart.getTheme(); // Owned copy, safe for agent inspection.
chart.setTheme(createTheme('paper', {
  id: 'my-product',
  name: 'My product',
  palette: { accent: '#7152a3' },
  typography: { uiFamily: 'Arial, sans-serif', axisSize: 12 },
  layout: { spacingScale: 0.85, bookWidth: 250, controlHeight: 28 },
  effects: { radius: 4, iconStroke: 1.75 },
  chart: { candleUp: '@accent', gridOpacity: 0.5, crosshairDash: [2, 5] },
}));
```

Use `createTheme(base, overrides)` to merge partial overrides. Direct `ChartTheme` objects still require a complete palette; older palette-only objects inherit compact defaults. `getTheme()` returns the complete version-1 portable theme. Colors accept six-digit hex values. Chart and effect colors also accept palette references such as `@positive`, which remain linked when the palette changes. Invalid themes are rejected before changing the view. `onThemeChange(theme)` receives an owned copy after a change. `RenderFrame.theme` gives renderer adapters the resolved theme; `DrawingContext.theme` exposes it to drawing plugins.

Themes cover fonts, text sizes, spacing, control and panel sizes, borders, corners, icon weight, opacity, shadows, grids, candles and wicks, volume, axes, crosshairs, price labels, watermarks, drawing chrome, heatmap ramps and PNG exports. New drawing defaults follow the theme unless the user has changed those defaults. Existing drawing colors stay intact. Indicators retain their explicit `color` unless they opt into `themeColor: 'indicator'`, as the included SMA does.

Themes belong to the view, so switching one leaves the market, viewport, drawings, revision and undo history unchanged. The widget saves its appearance separately when `storageKey` is provided, as the differences from its preset, so default changes in later versions still apply. It restores that choice on mount unless an explicit `theme` option is supplied. Without a namespace, changes last for the widget session. Custom `layoutStore` adapters still handle chart layouts only; browser appearance storage is optional and failure does not prevent switching themes.

The Appearance panel's **Customize theme** section edits the same tokens with searchable groups and per-field resets. Its JSON section imports, displays and downloads portable themes. Changes apply immediately and persist with the widget's appearance namespace. Invalid imports leave the active theme unchanged. The editor does not run imported JavaScript or CSS.

`themeTokenSchema` exports token kinds, defaults and allowed ranges for generated controls and agent validation. The groups are `typography`, `layout`, `effects` and `chart`; `palette` supplies semantic colors. Themes are JSON data and never contain callbacks. Font families can refer to host-loaded fonts; the chart repaints when fonts finish loading. See [theming](theming.md) for token groups and integration details.

## Styling and lifecycle

Set `--oc-font`, `--oc-serif`, `--oc-text`, `--oc-background`, `--oc-border` or `--oc-accent` on the host to customize widget chrome. These CSS overrides affect controls; use the theme API to coordinate controls with the canvas palette. Styles ship inside the JavaScript module, so there is no CSS loader or stylesheet import requirement.

The widget bundles a Latin WOFF2 build of Inter for controls and headings under the SIL Open Font License. They load once per document under private family names, with system-font fallbacks. Prices retain tabular monospace text. Keep `dist/lib/fonts/` alongside the built modules when serving the plain JavaScript library; bundlers resolve the font URLs as assets. No external font service is required. License notices ship with both build outputs.

The `fonts` option controls loading. `'bundled'` (the default) resolves the files next to the module with `new URL(..., import.meta.url)`, which Vite, webpack 5, Rollup, esbuild and native ES modules handle. If your bundler or CDN does not copy them, serve `dist/lib/fonts/` yourself and pass its URL, for example `fonts: '/static/candleframe-fonts/'`. `fonts: false` skips the files and uses system fonts.

The dialog for indicators, help and inspection keeps keyboard focus inside until Escape or Close, then returns focus to the button that opened it.

Unmount with `dispose()` before removing the host. Repeated disposal is harmless. The widget removes only its own mount element. Headless users can keep importing `ChartRuntime`; importing the public module does not access the DOM until a chart or widget is mounted.

## Verification

After `npm run build`, open [the two-widget example](../examples/embed.html) through the development server at `/examples/embed.html`. It imports `dist/lib/index.js`, mounts Bitcoin and Ethereum with different themes, applies deliberately conflicting host CSS and exposes dispose/remount controls. Restart Vite after rebuilding the library if this example still shows cached compiled modules.

`node scripts/multi-chart.mjs` checks grids in Chromium: presets, the active chart, each sync option, shared drawings, saved layouts across reloads, rename and delete, and the narrow view. It writes screenshots to `artifacts/multi-chart/`.

Browser checks covered independent drawing creation, session save/clear/restore, an untouched second widget, disposal/remount, nested-panel focus return, market interval changes and a widget-local PNG preview. Theme checks covered Graphite, Midnight, Paper and Sand, appearance restoration after reload, themed PNGs and changing one compiled widget while the other retained its palette. Evergreen checks covered the full widget, appearance persistence, the drawing menu in Paper, bundled font loading and two compiled widgets at 611 pixels wide. The main demo uses the same implementation as this example. There is no iframe requirement.

The rendering tests run the actual chart scheduler with a counting renderer: 50 hover frames produce zero additional market uploads or annotation repaints; drawing previews also skip market uploads. Navigation, streamed candles and PNG capture still repaint. These checks verify work scheduling, not GPU timing or measured browser input latency. Pan easing now uses a 12 ms response; scale transitions use 90 ms, or 40 ms during axis dragging.
