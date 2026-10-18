/** The complete workbench UI. `candleframe/widget`. */
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
export { parseIntervalInput, supportsInterval } from './widget-market.ts';
export type { WidgetFontSource } from './widget-fonts.ts';
export type { ChartApi } from './chart.ts';
