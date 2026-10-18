// Everything. Bundlers drop unused parts (the package has no side effects).
// Narrower entries: `candleframe/core` (no DOM), `candleframe/chart`, `candleframe/widget`,
// `candleframe/trading`, `candleframe/binance`.
export * from './core.ts';
export * from './chart-entry.ts';
export * from './trading-entry.ts';
export { createChartWidget } from './widget.ts';
export type {
  ChartWidgetApi,
  ChartWidgetOptions,
  WidgetMarketSource,
  WidgetLayoutStore,
  WidgetStoredValue,
  LayoutPreset,
  WidgetLayout,
  WidgetSync,
  WidgetWorkspace,
  WidgetWorkspaceIndex,
  WorkspaceCell,
} from './widget.ts';
export { LAYOUT_PRESETS, DEFAULT_WIDGET_SYNC } from './widget-layout.ts';
export type { DrawingTemplate, DrawingTemplateData, DrawingTemplateStore } from './drawing-templates.ts';
export type { DrawingFavouriteData, DrawingFavouriteStore } from './drawing-favourites.ts';
export { parseIntervalInput, supportsInterval } from './widget-market.ts';
export type { WidgetFontSource } from './widget-fonts.ts';
export { createBinanceFeed, BINANCE_INTERVALS } from './binance-feed.ts';
