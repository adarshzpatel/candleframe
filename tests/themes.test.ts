import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chartThemes,
  colorRGBA,
  compactTheme,
  createTheme,
  resolveTheme,
  restoreTheme,
  themeColor,
  themeTokenDefaults,
} from '../src/themes.ts';
import type { ThemeInput, ThemePalette } from '../src/themes.ts';

function luminance(hex: string) {
  const values = colorRGBA(hex)
    .slice(0, 3)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('built-in palettes provide readable text on both chart and control surfaces', () => {
  for (const theme of Object.values(chartThemes)) {
    const p = resolveTheme(theme).palette;
    for (const surface of [p.background, p.surface]) {
      for (const text of [p.text, p.textStrong, p.textMuted])
        assert.ok(contrast(text, surface) >= 4.5, `${theme.name} text ${text} on ${surface}`);
    }
    assert.ok(contrast(p.accent, p.accentText) >= 4.5, `${theme.name} accent button`);
    for (const slot of [
      'indicator',
      'indicator2',
      'indicator3',
      'indicator4',
      'indicator5',
      'indicator6',
    ] as const)
      assert.ok(contrast(p[slot], p.background) >= 3, `${theme.name} ${slot}`);
    for (const tone of [p.positive, p.negative, p.drawing])
      assert.ok(contrast(tone, p.background) >= 3, `${theme.name} ${tone} graphics`);
    assert.ok(contrast(p.markerText, p.markerBackground) >= 4.5, `${theme.name} price marker`);
  }
});

test('legacy palettes acquire visual defaults and partial themes merge without losing settings', () => {
  const legacy = resolveTheme({
    id: 'brand',
    name: 'Brand',
    mode: 'dark',
    palette: chartThemes.evergreen.palette,
  });
  assert.equal(legacy.layout.toolbarHeight, 44);
  assert.equal(legacy.chart.priceAxisWidth, 78);
  const branded = createTheme(legacy, {
    layout: { controlHeight: 32 },
    chart: { crosshairDash: [2, 6], candleUp: '@accent' },
  });
  const updated = createTheme(branded, { palette: { accent: '#ff8800' }, typography: { axisSize: 14 } });
  assert.equal(updated.layout.controlHeight, 32);
  assert.equal(updated.layout.railWidth, 42);
  assert.equal(updated.chart.candleUp, '@accent');
  assert.equal(themeColor(updated, updated.chart.candleUp), '#ff8800');
  assert.deepEqual(resolveTheme(JSON.parse(JSON.stringify(updated))), updated);
  assert.deepEqual(updated.chart.crosshairDash, [2, 6]);
});

test('resolved token groups and arrays are owned and immutable', () => {
  const dash = [2, 7],
    layout = { railWidth: 50 };
  const resolved = createTheme('paper', { layout, chart: { crosshairDash: dash } });
  dash[0] = 40;
  layout.railWidth = 60;
  assert.equal(resolved.layout.railWidth, 50);
  assert.deepEqual(resolved.chart.crosshairDash, [2, 7]);
  assert.ok(Object.isFrozen(resolved.chart.crosshairDash));
  assert.ok(Object.isFrozen(resolved.typography));
  assert.ok(Object.isFrozen(resolved.effects));
});

test('invalid portable themes fail validation before application', () => {
  const base = chartThemes.evergreen;
  for (const bad of [
    { ...base, version: 2 },
    { ...base, unknown: true },
    { ...base, chart: { ...base.chart, crosshairDash: [-1, 3] } },
    { ...base, chart: { ...base.chart, gridRows: 2.5 } },
    { ...base, chart: { ...base.chart, candleUp: '@missing' } },
    { ...base, layout: { ...base.layout, controlHeight: NaN } },
    { ...base, typography: { ...base.typography, uiFamily: 'sans-serif; color:red' } },
    { ...base, effects: { ...base.effects, invented: 4 } },
  ])
    assert.throws(() => resolveTheme(bad as ThemeInput));
  assert.throws(() => createTheme('paper', { layout: null } as never));
  assert.throws(() => createTheme('paper', JSON.parse('{"__proto__": {"polluted": true}}')));
  assert.equal(chartThemes.evergreen.chart.candleUp, '@positive');
});

test('custom themes are validated and owned without sharing caller state', () => {
  const custom = {
    ...chartThemes.paper,
    id: 'custom',
    name: 'Custom',
    palette: { ...chartThemes.paper.palette, accent: '#774488' },
  };
  const resolved = resolveTheme(custom);
  custom.palette.accent = '#000000';
  assert.equal(resolved.palette.accent, '#774488');
  assert.ok(Object.isFrozen(resolved.palette));
  assert.equal(resolveTheme().id, 'evergreen');
  for (const invalid of [
    'missing',
    '__proto__',
    null,
    {},
    { ...custom, palette: { ...custom.palette, background: 'red' } },
  ])
    assert.throws(() => resolveTheme(invalid as ThemeInput));
  assert.equal(chartThemes.paper.palette.accent, '#5050c5', 'the preset is untouched');
});

test('saved appearances keep only their changes, so later default changes still apply', () => {
  const custom = createTheme('graphite', { chart: { candleMaxWidth: 30 }, typography: { uiSize: 13 } });
  const saved = compactTheme(custom);
  assert.deepEqual(saved.chart, { candleMaxWidth: 30 });
  assert.deepEqual(saved.typography, { uiSize: 13 });
  assert.equal(saved.layout, undefined);
  assert.deepEqual(restoreTheme(JSON.parse(JSON.stringify(saved))), custom);
});

test('appearances saved in full drop values that were defaults at the time', () => {
  const legacy = JSON.parse(JSON.stringify(resolveTheme('graphite')));
  legacy.chart.candleMaxWidth = 18;
  legacy.chart.candleBodyRatio = 0.62;
  legacy.typography.titleSize = 23;
  const restored = restoreTheme(legacy);
  assert.equal(restored.chart.candleMaxWidth, themeTokenDefaults.chart.candleMaxWidth);
  assert.equal(restored.chart.candleBodyRatio, themeTokenDefaults.chart.candleBodyRatio);
  assert.equal(restored.typography.titleSize, themeTokenDefaults.typography.titleSize);
  assert.deepEqual(restored, resolveTheme('graphite'));
});

test('themes that carry retired tokens still load and drop them', () => {
  const older = JSON.parse(JSON.stringify(resolveTheme('graphite')));
  older.layout.bookWidth = 250;
  older.effects.bookFillOpacity = 0.1;
  older.chart.heatmapPeak = '#fabf57';
  assert.deepEqual(restoreTheme(older), resolveTheme('graphite'));
  assert.deepEqual(resolveTheme(older), resolveTheme('graphite'));
  assert.throws(() => resolveTheme({ ...older, layout: { panelWidth: 1 } }), /UNKNOWN_THEME_TOKEN/);
});

test('themes saved before the extra indicator slots borrow them from a preset of their mode', () => {
  const older = Object.fromEntries(
    Object.entries(chartThemes.sand.palette).filter(([key]) => !/^indicator\d$/.test(key)),
  ) as unknown as ThemePalette;
  const restored = resolveTheme({ id: 'old', name: 'Old', mode: 'light', palette: older });
  assert.equal(restored.palette.indicator2, chartThemes.paper.palette.indicator2);
  assert.equal(restored.palette.indicator, older.indicator);
});
