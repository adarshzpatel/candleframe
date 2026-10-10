import type { ChartApi } from './chart.ts';
import { chartThemes, createTheme, resolveTheme, themeColor, themeTokenSchema } from './themes.ts';
import type { ResolvedChartTheme, ThemeInput, ThemeOverrides, ThemeToken } from './themes.ts';

const title = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
function explainError(cause: unknown): string {
  if (cause instanceof SyntaxError)
    return 'The JSON could not be read. Check its quotes, commas and brackets.';
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === 'INVALID_CHART_THEME')
    return 'A theme needs an ID, name, light or dark mode, and a complete color palette.';
  if (message === 'UNSUPPORTED_THEME_VERSION')
    return 'This theme uses an unsupported version. Export it in version 1 format.';
  if (message === 'THEME_JSON_TOO_LARGE')
    return 'The theme JSON is too large. Use a file smaller than 64 KB.';
  const path = message.split(': ')[1]?.split('.').map(title).join(' / ');
  if (message.startsWith('UNKNOWN_THEME_TOKEN:'))
    return `Unknown setting: ${path}. Remove it before applying this theme.`;
  if (message.startsWith('INVALID_THEME_COLOR:'))
    return `${path} needs a six-digit hex color, such as #70cced.`;
  if (message.startsWith('INVALID_THEME_TOKEN:'))
    return `${path} has an unsupported value. Check its format or allowed range.`;
  return message;
}

/** Instance-owned editor. Every change uses the same validated public theme API. */
export function createThemeEditor(chart: ChartApi, doc: Document) {
  const abort = new AbortController();
  const element = doc.createElement('details');
  element.className = 'theme-customize';
  const summary = doc.createElement('summary');
  summary.textContent = 'Customize theme';
  const error = doc.createElement('p');
  error.className = 'theme-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const search = doc.createElement('input');
  search.type = 'search';
  search.placeholder = 'Find a setting…';
  search.setAttribute('aria-label', 'Find theme setting');
  const identity = doc.createElement('div');
  identity.className = 'theme-fields';
  const nameLabel = doc.createElement('label');
  nameLabel.className = 'theme-field';
  nameLabel.textContent = 'Theme name';
  const name = doc.createElement('input');
  name.maxLength = 64;
  name.setAttribute('aria-label', 'Theme name');
  nameLabel.append(name);
  const modeLabel = doc.createElement('label');
  modeLabel.className = 'theme-field';
  modeLabel.textContent = 'Color scheme';
  const mode = doc.createElement('select');
  mode.setAttribute('aria-label', 'Theme color scheme');
  for (const value of ['dark', 'light']) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = title(value);
    mode.append(option);
  }
  modeLabel.append(mode);
  identity.append(nameLabel, modeLabel);
  element.append(summary, error, identity, search);
  const fields: {
    group: string;
    key: string;
    input: HTMLInputElement;
    swatch?: HTMLInputElement;
    row: HTMLElement;
    spec: ThemeToken;
  }[] = [];
  const sections: HTMLDetailsElement[] = [];
  const paletteSchema = Object.fromEntries(
    Object.entries(chart.getTheme().palette).map(([key, value]) => [
      key,
      { kind: 'color', default: value } satisfies ThemeToken,
    ]),
  );
  const schemas: Record<string, Record<string, ThemeToken>> = { palette: paletteSchema, ...themeTokenSchema };
  const base =
    Object.values(chartThemes).find(theme => theme.id === chart.getTheme().id) ?? chartThemes.evergreen;
  function attempt(action: () => void) {
    try {
      action();
      error.hidden = true;
      error.textContent = '';
      sync();
    } catch (cause) {
      error.textContent = explainError(cause);
      error.hidden = false;
    }
  }
  function update(group: string, key: string, value: unknown) {
    attempt(() =>
      chart.setTheme(
        createTheme(chart.getTheme(), { id: 'custom', [group]: { [key]: value } } as ThemeOverrides),
      ),
    );
  }
  for (const [group, schema] of Object.entries(schemas)) {
    const section = doc.createElement('details');
    section.className = 'theme-section';
    const heading = doc.createElement('summary');
    heading.textContent = title(group);
    const grid = doc.createElement('div');
    grid.className = 'theme-fields';
    section.append(heading, grid);
    sections.push(section);
    element.append(section);
    for (const [key, spec] of Object.entries(schema)) {
      const row = doc.createElement('div');
      row.className = 'theme-field';
      const label = doc.createElement('label');
      label.textContent = title(key);
      const controls = doc.createElement('span');
      controls.className = 'theme-field-input';
      const input = doc.createElement('input');
      input.setAttribute('aria-label', `${title(group)} ${title(key)}`);
      input.type = spec.kind === 'number' ? 'number' : 'text';
      if (spec.kind === 'number') {
        input.min = String(spec.min);
        input.max = String(spec.max);
        input.step = String(spec.step);
      }
      if (spec.kind === 'dash') input.placeholder = '3, 4';
      if (spec.kind === 'color')
        input.title = group === 'palette' ? 'Six-digit hex color' : 'Six-digit hex color or @paletteToken';
      label.append(input);
      controls.append(label);
      let swatch: HTMLInputElement | undefined;
      if (spec.kind === 'color') {
        swatch = doc.createElement('input');
        swatch.type = 'color';
        swatch.setAttribute('aria-label', `${title(group)} ${title(key)} color`);
        swatch.addEventListener('change', () => update(group, key, swatch!.value), { signal: abort.signal });
        controls.append(swatch);
      }
      const reset = doc.createElement('button');
      reset.type = 'button';
      reset.className = 'theme-field-reset';
      reset.textContent = '↺';
      reset.setAttribute('aria-label', `Reset ${title(group)} ${title(key)}`);
      reset.title = 'Reset to default';
      reset.addEventListener(
        'click',
        () =>
          update(
            group,
            key,
            group === 'palette' ? base.palette[key as keyof typeof base.palette] : spec.default,
          ),
        { signal: abort.signal },
      );
      controls.append(reset);
      input.addEventListener(
        'change',
        () => {
          const value =
            spec.kind === 'number'
              ? input.value.trim()
                ? Number(input.value)
                : NaN
              : spec.kind === 'dash'
                ? input.value.trim()
                  ? input.value.split(',').map(Number)
                  : []
                : input.value;
          update(group, key, value);
        },
        { signal: abort.signal },
      );
      row.append(controls);
      grid.append(row);
      fields.push({ group, key, input, swatch, row, spec });
    }
  }
  name.addEventListener(
    'change',
    () => attempt(() => chart.setTheme(createTheme(chart.getTheme(), { id: 'custom', name: name.value }))),
    { signal: abort.signal },
  );
  mode.addEventListener(
    'change',
    () =>
      attempt(() =>
        chart.setTheme(createTheme(chart.getTheme(), { id: 'custom', mode: mode.value as 'dark' | 'light' })),
      ),
    { signal: abort.signal },
  );
  search.addEventListener(
    'input',
    () => {
      const query = search.value.trim().toLowerCase();
      for (const field of fields)
        field.row.hidden = !`${field.group} ${title(field.key)}`.toLowerCase().includes(query);
      for (const section of sections) {
        section.hidden = ![...section.querySelectorAll<HTMLElement>('.theme-field')].some(row => !row.hidden);
        if (query && !section.hidden) section.open = true;
      }
    },
    { signal: abort.signal },
  );
  const exchange = doc.createElement('details');
  exchange.className = 'theme-section';
  const exchangeTitle = doc.createElement('summary');
  exchangeTitle.textContent = 'Import / export JSON';
  const json = doc.createElement('textarea');
  json.className = 'theme-json';
  json.rows = 8;
  json.spellcheck = false;
  json.setAttribute('aria-label', 'Theme JSON');
  const actions = doc.createElement('div');
  actions.className = 'theme-editor-actions';
  const current = doc.createElement('button');
  current.className = 'button';
  current.textContent = 'Current JSON';
  const apply = doc.createElement('button');
  apply.className = 'button primary';
  apply.textContent = 'Apply JSON';
  const download = doc.createElement('button');
  download.className = 'button';
  download.textContent = 'Download';
  current.addEventListener(
    'click',
    () => {
      json.value = JSON.stringify(chart.getTheme(), null, 2);
    },
    { signal: abort.signal },
  );
  apply.addEventListener(
    'click',
    () =>
      attempt(() => {
        if (json.value.length > 64_000) throw new Error('THEME_JSON_TOO_LARGE');
        chart.setTheme(resolveTheme(JSON.parse(json.value) as ThemeInput));
      }),
    { signal: abort.signal },
  );
  download.addEventListener(
    'click',
    () => {
      const theme = chart.getTheme(),
        link = doc.createElement('a');
      link.download = `${theme.id}.theme.json`;
      link.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(theme, null, 2))}`;
      link.click();
    },
    { signal: abort.signal },
  );
  actions.append(current, apply, download);
  exchange.append(exchangeTitle, json, actions);
  element.append(exchange);
  function sync(theme: ResolvedChartTheme = chart.getTheme()) {
    name.value = theme.name;
    mode.value = theme.mode;
    for (const field of fields) {
      const values = theme[field.group as keyof ResolvedChartTheme] as Record<string, unknown>;
      const value = values[field.key];
      field.input.value = Array.isArray(value) ? value.join(', ') : String(value);
      if (field.swatch) field.swatch.value = themeColor(theme, String(value));
    }
  }
  sync();
  json.value = JSON.stringify(chart.getTheme(), null, 2);
  return {
    element,
    sync,
    dispose() {
      abort.abort();
      element.remove();
    },
  };
}
