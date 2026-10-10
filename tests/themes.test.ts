import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartThemes, colorRGBA, createTheme, resolveTheme, themeColor } from '../src/themes.ts';
import type { ThemeInput } from '../src/themes.ts';

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
    assert.ok(contrast(p.indicator, p.background) >= 3, `${theme.name} indicator`);
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
    layout = { bookWidth: 300 };
  const resolved = createTheme('paper', { layout, chart: { crosshairDash: dash } });
  dash[0] = 40;
  layout.bookWidth = 400;
  assert.equal(resolved.layout.bookWidth, 300);
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
  assert.equal(chartThemes.paper.palette.accent, '#5657be');
});
