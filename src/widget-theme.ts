import { themeColor, themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import { themeTokenSchema } from './theme-tokens.ts';
import type { ThemeToken, ThemeTokenGroup } from './theme-tokens.ts';

/** Reflect one validated theme onto this widget's shadow host. */
export function applyWidgetTheme(mount: HTMLElement, theme: ResolvedChartTheme): void {
  const style = mount.style;
  style.setProperty('--theme-mode', theme.mode);
  for (const [key, value] of Object.entries(theme.palette)) style.setProperty(`--theme-${key}`, value);
  for (const group of Object.keys(themeTokenSchema) as ThemeTokenGroup[]) {
    const values = theme[group] as Readonly<Record<string, string | number | readonly number[]>>;
    for (const [key, descriptor] of Object.entries(themeTokenSchema[group])) {
      const spec: ThemeToken = descriptor, value = values[key];
      const css = spec.kind === 'color' ? themeColor(theme, value as string)
        : spec.kind === 'number' ? `${value}${spec.unit === 'px' ? 'px' : ''}`
        : Array.isArray(value) ? value.join(' ') : String(value);
      style.setProperty(`--theme-${group}-${key}`, css);
    }
  }
  const effects = theme.effects;
  style.setProperty('--theme-shadow', `0 ${effects.shadowY}px ${effects.shadowBlur}px ${themeColorCSS(theme, effects.shadowColor, effects.shadowOpacity)}`);
  const chevron = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" fill="none" stroke="${theme.palette.textMuted}" stroke-width="${effects.iconStroke}"/></svg>`;
  style.setProperty('--theme-chevron', `url("data:image/svg+xml,${encodeURIComponent(chevron)}")`);
}
