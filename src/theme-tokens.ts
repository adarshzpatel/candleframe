/** Visual tokens. Numbers use CSS pixels unless the descriptor says otherwise. */
export interface ThemeToken<T = string | number | readonly number[]> {
  kind: 'number' | 'font' | 'color' | 'text' | 'dash';
  default: T;
  min?: number;
  max?: number;
  step?: number;
  unit?: 'px' | 'ratio';
}
const n = (
  value: number,
  min: number,
  max: number,
  step = 1,
  unit: 'px' | 'ratio' = 'px',
): ThemeToken<number> => ({ kind: 'number', default: value, min, max, step, unit });
const ratio = (value: number, min = 0, max = 1) => n(value, min, max, 0.05, 'ratio');
const font = (value: string): ThemeToken<string> => ({ kind: 'font', default: value });
const color = (value: string): ThemeToken<string> => ({ kind: 'color', default: value });
const text = (value: string): ThemeToken<string> => ({ kind: 'text', default: value });
const dash = (...value: number[]): ThemeToken<readonly number[]> => ({
  kind: 'dash',
  default: Object.freeze(value),
});

/** One registry drives validation, defaults, CSS variables and the Appearance editor. */
export const themeTokenSchema = {
  typography: {
    uiFamily: font('"CandleFrame UI", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
    headingFamily: font('"CandleFrame UI", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
    numberFamily: font('"SFMono-Regular", Consolas, "Liberation Mono", monospace'),
    annotationFamily: font('ui-monospace, SFMono-Regular, Menlo, monospace'),
    uiSize: n(12, 10, 20),
    smallSize: n(10, 8, 18),
    titleSize: n(18, 14, 36),
    priceSize: n(17, 10, 28),
    panelTitleSize: n(16, 12, 32),
    axisSize: n(10, 8, 20),
    markerSize: n(11, 8, 22),
    watermarkSize: n(11, 8, 32),
    uiWeight: n(400, 100, 900, 100, 'ratio'),
    headingWeight: n(600, 100, 900, 100, 'ratio'),
  },
  layout: {
    spacingScale: ratio(1, 0.5, 2),
    controlHeight: n(30, 24, 48),
    toolbarHeight: n(44, 32, 72),
    footerHeight: n(30, 24, 54),
    railWidth: n(42, 32, 72),
    railButtonSize: n(30, 24, 56),
    bookWidth: n(232, 180, 400),
    bookRowHeight: n(20, 16, 36),
    summaryHeight: n(76, 54, 140),
    summaryPadding: n(10, 4, 28),
    panelPadding: n(13, 4, 32),
    dialogWidth: n(364, 260, 700),
    textEditorWidth: n(328, 240, 600),
    themePreviewHeight: n(64, 40, 120),
    assetSize: n(24, 18, 40),
  },
  effects: {
    radius: n(2, 0, 24),
    containerRadius: n(0, 0, 32),
    borderWidth: n(1, 0, 4, 0.5),
    focusWidth: n(2, 1, 4, 0.5),
    iconStroke: n(1.5, 0.5, 3, 0.25, 'ratio'),
    iconScale: ratio(1, 0.7, 1.5),
    disabledOpacity: ratio(0.28),
    hoverOpacity: ratio(0.06),
    selectedOpacity: ratio(0.11),
    bookFillOpacity: ratio(0.08),
    bookEdgeOpacity: ratio(0.16),
    shadowColor: color('#000000'),
    shadowOpacity: ratio(0.3),
    shadowBlur: n(36, 0, 80),
    shadowY: n(12, 0, 32),
  },
  chart: {
    plotLeft: n(14, 0, 48),
    plotTop: n(16, 0, 48),
    priceAxisWidth: n(78, 40, 180),
    timeAxisHeight: n(26, 20, 60),
    axisGap: n(6, 0, 24),
    axisLabelPadding: n(10, 2, 24),
    axisColor: color('@textMuted'),
    gridRows: n(6, 2, 12, 1, 'ratio'),
    gridColumns: n(6, 2, 12, 1, 'ratio'),
    gridWidth: n(1, 0, 4, 0.5),
    gridOpacity: ratio(1),
    candleUp: color('@positive'),
    candleDown: color('@negative'),
    wickUp: color('@positive'),
    wickDown: color('@negative'),
    candleBodyRatio: ratio(0.72, 0.1, 1),
    candleMaxWidth: n(64, 1, 160),
    candleMinHeight: n(1.5, 0.5, 6, 0.5),
    wickWidth: n(1, 0.5, 4, 0.5),
    volumeUp: color('@positive'),
    volumeDown: color('@negative'),
    volumeHeight: n(46, 0, 160),
    volumeGap: n(18, 0, 40),
    volumeOpacity: ratio(0.5),
    indicatorWidth: n(1.5, 0.5, 6, 0.5),
    lastPriceColor: color('@positive'),
    lastPriceWidth: n(1, 0, 4, 0.5),
    lastPriceOpacity: ratio(0.53),
    lastPriceDash: dash(3, 5),
    markerPadding: n(7, 2, 18),
    markerHeight: n(21, 16, 42),
    crosshairColor: color('@crosshair'),
    crosshairWidth: n(1, 0, 4, 0.5),
    crosshairOpacity: ratio(0.6),
    crosshairDash: dash(3, 4),
    crosshairLabelBackground: color('@raised'),
    crosshairLabelText: color('@textStrong'),
    watermarkText: text('candleframe'),
    watermarkOpacity: ratio(1),
    annotationBackground: color('@surface'),
    annotationOpacity: ratio(0.92),
    annotationPadding: n(6, 0, 20),
    handleFill: color('@background'),
    handleColor: color('@drawing'),
    handleRadius: n(4, 2, 10),
    handleWidth: n(1.5, 0.5, 4, 0.5),
    measurementDash: dash(5, 4),
    drawingWidth: n(2, 1, 8),
    drawingFontSize: n(12, 10, 32),
    drawingFillOpacity: ratio(0.12),
    heatmapLow: color('#0f2933'),
    heatmapMid: color('#296b66'),
    heatmapHigh: color('#996e33'),
    heatmapPeak: color('#fabf57'),
    heatmapOpacity: ratio(0.85),
    heatmapUnknown: color('@textMuted'),
    heatmapUnknownOpacity: ratio(0.1),
  },
} as const;

export type ThemeTokenGroup = keyof typeof themeTokenSchema;
export type ThemeTokens = {
  readonly [G in ThemeTokenGroup]: {
    readonly [K in keyof (typeof themeTokenSchema)[G]]: (typeof themeTokenSchema)[G][K] extends ThemeToken<
      infer T
    >
      ? T
      : never;
  };
};
export type ThemeTypography = ThemeTokens['typography'];
export type ThemeLayout = ThemeTokens['layout'];
export type ThemeEffects = ThemeTokens['effects'];
export type ThemeChart = ThemeTokens['chart'];
export type ThemeTokenOverrides = { readonly [G in ThemeTokenGroup]?: Partial<ThemeTokens[G]> };

export const themeTokenDefaults = Object.freeze(
  Object.fromEntries(
    Object.entries(themeTokenSchema).map(([group, fields]) => {
      for (const spec of Object.values(fields)) Object.freeze(spec);
      Object.freeze(fields);
      return [
        group,
        Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, spec.default]))),
      ];
    }),
  ),
) as ThemeTokens;
Object.freeze(themeTokenSchema);
