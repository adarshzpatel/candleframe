import { ChartError } from './errors.ts';
import { builtInPalettes } from './theme-palettes.ts';
import type { IndicatorPlugin } from './types.ts';
import { themeTokenDefaults, themeTokenSchema } from './theme-tokens.ts';
import type { ThemeToken, ThemeTokenOverrides, ThemeTokens } from './theme-tokens.ts';
export { themeTokenSchema, themeTokenDefaults } from './theme-tokens.ts';
export type * from './theme-tokens.ts';

/** Shared color tokens for HTML controls, Canvas2D overlays and WebGL geometry. */
export interface ThemePalette {
  background: string;
  surface: string;
  raised: string;
  border: string;
  borderStrong: string;
  text: string;
  textStrong: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  positive: string;
  negative: string;
  grid: string;
  crosshair: string;
  markerBackground: string;
  markerText: string;
  /** First indicator series color; `indicator2` to `indicator6` follow in legend order. */
  indicator: string;
  indicator2: string;
  indicator3: string;
  indicator4: string;
  indicator5: string;
  indicator6: string;
  drawing: string;
  watermark: string;
}
export interface ChartTheme extends ThemeTokenOverrides {
  readonly version?: 1;
  readonly id: string;
  readonly name: string;
  readonly mode: 'light' | 'dark';
  readonly palette: Readonly<ThemePalette>;
}
export interface ResolvedChartTheme extends ChartTheme {
  readonly version: 1;
  readonly typography: ThemeTokens['typography'];
  readonly layout: ThemeTokens['layout'];
  readonly effects: ThemeTokens['effects'];
  readonly chart: ThemeTokens['chart'];
}
export type ThemeOverrides = ThemeTokenOverrides & {
  readonly id?: string;
  readonly name?: string;
  readonly mode?: 'dark' | 'light';
  readonly palette?: Partial<ThemePalette>;
};

const evergreen: ChartTheme = {
  id: 'evergreen',
  name: 'Evergreen',
  mode: 'dark',
  palette: { ...builtInPalettes.evergreen },
};
const graphite: ChartTheme = {
  id: 'graphite',
  name: 'Graphite',
  mode: 'dark',
  palette: { ...builtInPalettes.graphite },
};
const midnight: ChartTheme = {
  id: 'midnight',
  name: 'Midnight',
  mode: 'dark',
  palette: { ...builtInPalettes.midnight },
};
const paper: ChartTheme = {
  id: 'paper',
  name: 'Paper',
  mode: 'light',
  palette: { ...builtInPalettes.paper },
};
const sand: ChartTheme = {
  id: 'sand',
  name: 'Sand',
  mode: 'light',
  palette: { ...builtInPalettes.sand },
};
/**
 * Black, white and grays. Candles are white up and gray down; green and red stay for
 * P&L, delta and order flow, and blue marks the accent.
 */
const monochrome: ChartTheme = {
  id: 'monochrome',
  name: 'Monochrome',
  mode: 'dark',
  palette: { ...builtInPalettes.monochrome },
  chart: {
    candleUp: '@textStrong',
    candleDown: '@borderStrong',
    // Wicks match their bodies, instead of the default green and red.
    wickUp: '@textStrong',
    wickDown: '@borderStrong',
  },
};
const rawThemes = { graphite, evergreen, midnight, monochrome, paper, sand };
export type ThemeId = keyof typeof rawThemes;
export type ThemeInput = ThemeId | ChartTheme;
const paletteKeys = Object.keys(evergreen.palette) as (keyof ThemePalette)[];
const groups = Object.keys(themeTokenSchema) as (keyof ThemeTokens)[];
const themeKeys = ['version', 'id', 'name', 'mode', 'palette', ...groups];
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
function unknownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new ChartError('UNKNOWN_THEME_TOKEN', `${path}${key}`);
}
function validateToken(value: unknown, spec: ThemeToken, path: string): string | number | readonly number[] {
  let valid = false;
  switch (spec.kind) {
    case 'number':
      valid =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= spec.min! &&
        value <= spec.max! &&
        (spec.step !== 1 || Number.isInteger(value));
      break;
    case 'font':
      valid =
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 200 &&
        /^[\p{L}\p{N} ,_"'\-]+$/u.test(value);
      break;
    case 'text':
      valid = typeof value === 'string' && value.length <= 80 && !/[\u0000-\u001f]/.test(value);
      break;
    case 'color':
      valid =
        hex(value) ||
        (typeof value === 'string' &&
          value.startsWith('@') &&
          paletteKeys.includes(value.slice(1) as keyof ThemePalette));
      break;
    case 'dash':
      valid =
        Array.isArray(value) &&
        value.length <= 8 &&
        value.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 40);
      break;
  }
  if (!valid) throw new ChartError('INVALID_THEME_TOKEN', `${path}`);
  return Array.isArray(value) ? Object.freeze([...value]) : (value as string | number);
}
function normalizeTheme(input: unknown): ResolvedChartTheme {
  if (
    !plain(input) ||
    typeof input.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 64 ||
    !['light', 'dark'].includes(input.mode as string) ||
    !plain(input.palette)
  )
    throw new ChartError('INVALID_CHART_THEME');
  if (input.version !== undefined && input.version !== 1) throw new ChartError('UNSUPPORTED_THEME_VERSION');
  if (input.version === 1) unknownKeys(input, themeKeys, '');
  unknownKeys(input.palette, paletteKeys, 'palette.');
  const palette = {} as ThemePalette;
  // Themes from before the extra indicator slots borrow them from a preset of their mode.
  const fallback: Partial<ThemePalette> =
    input.mode === 'light' ? builtInPalettes.paper : builtInPalettes.graphite;
  for (const key of paletteKeys) {
    const value =
      input.palette[key] === undefined && key.startsWith('indicator') && key !== 'indicator'
        ? fallback[key]
        : input.palette[key];
    if (!hex(value)) throw new ChartError('INVALID_THEME_COLOR', `palette.${key}`);
    palette[key] = value;
  }
  const tokens: Record<string, unknown> = {};
  for (const group of groups) {
    const schema = themeTokenSchema[group],
      values = input[group];
    if (values !== undefined && !plain(values)) throw new ChartError('INVALID_THEME_TOKEN', `${group}`);
    if (values) unknownKeys(values, Object.keys(schema), `${group}.`);
    const resolved: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(schema))
      resolved[key] = validateToken(
        values && Object.hasOwn(values, key) ? values[key] : spec.default,
        spec,
        `${group}.${key}`,
      );
    tokens[group] = Object.freeze(resolved);
  }
  return Object.freeze({
    version: 1,
    id: input.id,
    name: input.name,
    mode: input.mode,
    palette: Object.freeze(palette),
    ...tokens,
  }) as ResolvedChartTheme;
}
export const chartThemes = Object.freeze(
  Object.fromEntries(Object.entries(rawThemes).map(([id, theme]) => [id, normalizeTheme(theme)])),
) as Readonly<Record<ThemeId, ResolvedChartTheme>>;

/**
 * The preset a chart starts with when the host names none: neutral Graphite, or Paper
 * when the system asks for light colors.
 */
export function systemThemeId(win: Window | null | undefined = globalThis.window): 'graphite' | 'paper' {
  return win?.matchMedia?.('(prefers-color-scheme: light)').matches ? 'paper' : 'graphite';
}

/** Validate before mutation. Old palette-only themes inherit compact visual defaults. */
export function resolveTheme(input: ThemeInput = 'evergreen'): ResolvedChartTheme {
  if (typeof input === 'string') {
    if (!Object.hasOwn(chartThemes, input)) throw new ChartError('UNKNOWN_CHART_THEME');
    return chartThemes[input];
  }
  return normalizeTheme(input);
}
/** Derive a portable theme with partial overrides. All groups merge by named token. */
export function createTheme(
  base: ThemeInput = 'evergreen',
  overrides: ThemeOverrides = {},
): ResolvedChartTheme {
  if (!plain(overrides)) throw new ChartError('INVALID_THEME_OVERRIDES');
  unknownKeys(
    overrides,
    themeKeys.filter(key => key !== 'version'),
    '',
  );
  const original = resolveTheme(base),
    merged: Record<string, unknown> = { ...original, ...overrides };
  for (const group of ['palette', ...groups] as const) {
    const patch = overrides[group];
    if (patch !== undefined && !plain(patch)) throw new ChartError('INVALID_THEME_TOKEN', `${group}`);
    merged[group] = { ...original[group], ...patch };
  }
  return normalizeTheme(merged);
}
/** Palette references stay symbolic in exported themes, so palette changes keep propagating. */
export function themeColor(theme: Pick<ChartTheme, 'palette'>, value: string): string {
  return value.startsWith('@') ? theme.palette[value.slice(1) as keyof ThemePalette] : value;
}
export function themeColorCSS(theme: Pick<ChartTheme, 'palette'>, value: string, opacity: number): string {
  const [r, g, b] = colorRGBA(themeColor(theme, value));
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
}
export function colorRGBA(hex: string, alpha = 1): readonly [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

/**
 * Defaults that have since changed. Appearances saved before `compactTheme` stored every
 * token, so these values are dropped on restore to let the current defaults through.
 */
const retiredDefaults: { readonly [G in keyof ThemeTokens]?: Readonly<Record<string, unknown>> } = {
  typography: {
    titleSize: 23,
    panelTitleSize: 20,
    headingWeight: 400,
  },
  chart: { candleBodyRatio: 0.62, candleMaxWidth: 18, volumeOpacity: 0.35 },
};

/**
 * The theme as its differences from the preset with the same id, or from the token
 * defaults. Save this rather than a resolved theme, so later default changes still apply.
 */
export function compactTheme(theme: ResolvedChartTheme): ChartTheme {
  const base: Partial<ResolvedChartTheme> =
    chartThemes[theme.id as ThemeId] ?? (themeTokenDefaults as Partial<ResolvedChartTheme>);
  const result: Record<string, unknown> = {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    palette: { ...theme.palette },
  };
  for (const group of groups) {
    const changed = Object.entries(theme[group]).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify((base[group] as Record<string, unknown> | undefined)?.[key]),
    );
    if (changed.length) result[group] = Object.fromEntries(changed);
  }
  return result as unknown as ChartTheme;
}

/** Resolves a saved appearance, dropping token values that were defaults when it was saved. */
export function restoreTheme(saved: unknown): ResolvedChartTheme {
  if (!plain(saved)) return resolveTheme(saved as ThemeInput);
  const cleaned: Record<string, unknown> = { ...saved };
  for (const [group, retired] of Object.entries(retiredDefaults)) {
    const values = saved[group];
    if (!plain(values)) continue;
    cleaned[group] = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          !Object.hasOwn(retired, key) || JSON.stringify(retired[key]) !== JSON.stringify(value),
      ),
    );
  }
  return resolveTheme(cleaned as unknown as ThemeInput);
}

/** The color of one indicator output: its theme slot when it has one, else its own color. */
export function indicatorColor(
  theme: Pick<ChartTheme, 'palette'>,
  plugin: Pick<IndicatorPlugin, 'color' | 'themeColor' | 'outputs'>,
  output = 0,
): readonly [number, number, number, number] {
  const entry = plugin.outputs?.[output];
  const own = entry?.color ?? plugin.color;
  const slot = plugin.outputs?.length ? entry?.themeColor : plugin.themeColor;
  return slot ? colorRGBA(theme.palette[slot], own[3]) : own;
}
