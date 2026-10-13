# Multi-chart layouts and saved workspaces

Status: implemented, unreleased. Usage is in [embedding](embedding.md#chart-grids-and-saved-layouts).

## Starting point

- `createChartWidget` owned one `chart`. The header, tool rail, footer, order book and dialogs read `chart` and `lastState` directly.
- A saved layout was one `ChartDocument` per market, keyed `[storageKey, source, symbol, interval]`, with debounced autosave.
- Each chart owns a WebGL2 context and a feed adapter. Browsers allow about 16 WebGL contexts per page, so a grid holds at most 8 charts.
- Navigation commands (`viewport.*`, `priceScale.*`) already skip undo history. They do bump the document revision, so synced charts autosave their view like a user pan would.
- A viewport spans 20 to 2,200 bars. Date range sync across intervals must clamp.
- A chart that follows live data moves its viewport on every new bar. Those moves must not reach other charts.

## Decisions

- **Two layers.** `createChartGroup` (`src/chart-group.ts`) links bare charts for crosshair, time and date range. The widget adds symbol and interval sync, because it owns the market catalog and feeds.
- **Proxy instead of rewiring.** `createChartSwitch` (`src/chart-switch.ts`) returns one `ChartApi` that forwards to the active chart and moves subscriptions when it changes. The drawing workbench, indicator panel and theme editor kept their single-chart code. Appearance and drawing defaults go to every chart.
- **Echo control.** The group ignores publications it caused, changes of generation, and viewport moves where the chart followed live before and after.
- **Documents stay per market.** Charts in one grid on the same market share drawings and indicators: after an autosave, the others restore that content with their own viewport and no undo step. Saved layouts store markets, not documents, so existing saved documents keep working.
- **Saved layout records.** `[namespace, 'workspaces']` holds the list and current id; `[namespace, 'workspace', id]` holds each layout. Nothing is written until the user changes the grid or saves a layout, so single-chart users get no new records. `WidgetLayoutStore.remove` is optional; without it a deleted layout leaves its record behind.
- **First chart on mount.** Reopening the last layout restores every chart's market except the first, which keeps the host's `feed` option. Opening a layout from the menu restores all of them.
- **Narrow widths.** Below 580 pixels the grid shows the active chart and a row of tabs.

| Sync option | Effect | Default |
| --- | --- | --- |
| Symbol | A symbol or source change applies to every chart | off |
| Interval | An interval change applies to every chart | off |
| Crosshair | Hover draws a time line in every chart | on |
| Time | Panning aligns the right edge in time; each chart keeps its zoom | on |
| Date range | Every chart shows the same time range, clamped per interval | off |

## Verification

- `tests/chart-group.test.ts`: time and date range alignment, clamping across intervals, live-follow handling, crosshair mirroring and `align`.
- `scripts/multi-chart.mjs`: presets, activation by click, Alt + digit and tabs, each sync option, shared drawings, saved layouts across reloads, rename, delete, theme and tool handoff.
- `scripts/layout-persistence.mjs` and `scripts/smoke.mjs` pass unchanged for the single chart.

## Deferred

- Draggable splitters between charts.
- One shared Binance connection for every chart (combined streams).
- Drawings shared across intervals or kept per layout.
