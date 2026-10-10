import { ChartError } from './errors.ts';
import { themeTokenSchema } from './theme-tokens.ts';
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
  indicator: string;
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
  palette: {
    background: '#081d16',
    surface: '#0e271e',
    raised: '#19372a',
    border: '#284437',
    borderStrong: '#4b6251',
    text: '#c6d1bd',
    textStrong: '#f4f1dc',
    textMuted: '#a2b39d',
    textFaint: '#7b9680',
    accent: '#e1cc76',
    accentText: '#18251b',
    positive: '#79bf96',
    negative: '#ce887a',
    grid: '#19352a',
    crosshair: '#8ba38b',
    markerBackground: '#254b37',
    markerText: '#d4edc7',
    indicator: '#d4c383',
    drawing: '#e1cc76',
    watermark: '#406047',
  },
};
const graphite: ChartTheme = {
  id: 'graphite',
  name: 'Graphite',
  mode: 'dark',
  palette: {
    background: '#101216',
    surface: '#15171c',
    raised: '#23262f',
    border: '#292d36',
    borderStrong: '#424957',
    text: '#c5cbd6',
    textStrong: '#eceef5',
    textMuted: '#969dab',
    textFaint: '#798291',
    accent: '#b7baff',
    accentText: '#191925',
    positive: '#55c8a6',
    negative: '#e88d95',
    grid: '#242830',
    crosshair: '#828d9e',
    markerBackground: '#173b32',
    markerText: '#87e4c7',
    indicator: '#a9bcff',
    drawing: '#a9c4ff',
    watermark: '#495260',
  },
};
const midnight: ChartTheme = {
  id: 'midnight',
  name: 'Midnight',
  mode: 'dark',
  palette: {
    background: '#0b1523',
    surface: '#101e30',
    raised: '#1a2b41',
    border: '#23374d',
    borderStrong: '#3c5671',
    text: '#becfe2',
    textStrong: '#e5f1ff',
    textMuted: '#94adc7',
    textFaint: '#768fa9',
    accent: '#70cced',
    accentText: '#0b2230',
    positive: '#47d5bc',
    negative: '#f095a5',
    grid: '#1b2a3d',
    crosshair: '#789ab8',
    markerBackground: '#123e3b',
    markerText: '#80efdb',
    indicator: '#d2adf5',
    drawing: '#80c8f5',
    watermark: '#38506b',
  },
};
const paper: ChartTheme = {
  id: 'paper',
  name: 'Paper',
  mode: 'light',
  palette: {
    background: '#ffffff',
    surface: '#f6f7fa',
    raised: '#eceff5',
    border: '#e0e4ec',
    borderStrong: '#bcc5d4',
    text: '#3e4a60',
    textStrong: '#19263c',
    textMuted: '#58667b',
    textFaint: '#69778b',
    accent: '#5657be',
    accentText: '#ffffff',
    positive: '#168064',
    negative: '#c34561',
    grid: '#eef0f5',
    crosshair: '#8390a5',
    markerBackground: '#dcefe7',
    markerText: '#126c52',
    indicator: '#6967c2',
    drawing: '#5268b6',
    watermark: '#b6becc',
  },
};
const sand: ChartTheme = {
  id: 'sand',
  name: 'Sand',
  mode: 'light',
  palette: {
    background: '#f7f3ea',
    surface: '#eee9df',
    raised: '#e5ddcf',
    border: '#dbd3c3',
    borderStrong: '#b9ac98',
    text: '#534d42',
    textStrong: '#332e25',
    textMuted: '#706758',
    textFaint: '#807460',
    accent: '#955533',
    accentText: '#ffffff',
    positive: '#42775a',
    negative: '#b45245',
    grid: '#e9e2d5',
    crosshair: '#938472',
    markerBackground: '#dfebd9',
    markerText: '#355e42',
    indicator: '#927240',
    drawing: '#8f653d',
    watermark: '#baaf9c',
  },
};
const rawThemes = { evergreen, graphite, midnight, paper, sand };
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
  for (const key of paletteKeys) {
    const value = input.palette[key];
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
