#!/usr/bin/env node
// Built-in theme palettes, authored in OKLCH.
//
//   node scripts/palette.mjs           # write src/theme-palettes.ts and print the contrast report
//   node scripts/palette.mjs --check   # report only; exit 1 if any pair misses its threshold
//
// Each theme is a neutral ramp on one hue plus semantic colors. Lightness sets every
// contrast relationship; chroma is a share of the sRGB maximum for that lightness and hue,
// so colors on different hues read as equally vivid. Contrast uses APCA (Lc) and WCAG 2.
import { writeFile } from 'node:fs/promises';

// --- OKLCH to sRGB -------------------------------------------------------------------------
function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h),
    b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
const encode = v => {
  v = Math.min(1, Math.max(0, v));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
/** Largest in-gamut chroma for a lightness and hue. */
function maxChroma(L, H) {
  let lo = 0,
    hi = 0.4;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, H))) lo = mid;
    else hi = mid;
  }
  return lo;
}
/** `c` is a share of the gamut maximum (0 to 1), so vividness matches across hues. */
function color(L, c, H) {
  return absolute(L, maxChroma(L, H) * c, H);
}
/** Absolute chroma, clamped into sRGB. Neutrals use it: near black the maximum is tiny. */
function absolute(L, C, H) {
  C = Math.min(C, maxChroma(L, H));
  const hex = oklchToLinear(L, C, H)
    .map(v => Math.round(encode(v) * 255))
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
  return { hex: `#${hex}`, oklch: `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H})` };
}

// --- Contrast ------------------------------------------------------------------------------
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
function wcag(a, b) {
  const lum = hex => {
    const [r, g, b] = channels(hex).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** APCA 0.0.98G-4g. Positive Lc: dark text on light; negative: light text on dark. */
function apca(text, background) {
  const y = hex => {
    const [r, g, b] = channels(hex).map(v => v ** 2.4);
    const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    return Y > 0.022 ? Y : Y + (0.022 - Y) ** 1.414;
  };
  const [t, bg] = [y(text), y(background)];
  if (Math.abs(bg - t) < 0.0005) return 0;
  if (bg > t) {
    const s = (bg ** 0.56 - t ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (bg ** 0.65 - t ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

// --- Themes --------------------------------------------------------------------------------
/**
 * Dark ramp: surfaces climb in small steps; text sits high enough for APCA body text on
 * the background (|Lc| >= 75) and labels stay above Lc 60.
 */
function darkNeutrals(H, chroma) {
  const n = (L, c = chroma) => absolute(L, c, H);
  return {
    background: n(0.165),
    surface: n(0.195),
    raised: n(0.245),
    border: n(0.285),
    borderStrong: n(0.46),
    grid: n(0.215, chroma * 0.8),
    text: n(0.865, chroma * 0.5),
    textStrong: n(0.965, chroma * 0.25),
    textMuted: n(0.785, chroma * 0.6),
    textFaint: n(0.685, chroma * 0.6),
    crosshair: n(0.68, chroma * 0.6),
    watermark: n(0.34),
  };
}
function lightNeutrals(H, chroma, background = 1) {
  const n = (L, c = chroma) => absolute(L, c, H);
  return {
    background: n(background, background === 1 ? 0 : chroma),
    surface: n(background - 0.022),
    raised: n(background - 0.05),
    border: n(background - 0.085),
    borderStrong: n(background - 0.2),
    grid: n(background - 0.04, chroma * 0.8),
    text: n(0.39, chroma * 1.4),
    textStrong: n(0.235, chroma * 1.4),
    textMuted: n(0.47, chroma * 1.4),
    textFaint: n(0.555, chroma * 1.4),
    crosshair: n(0.6, chroma * 1.2),
    watermark: n(background - 0.17),
  };
}
/**
 * Indicator series: fixed lightness per mode, equal share of each hue's chroma limit.
 * Thin lines need more chroma than fills to read as color. Hues are spaced for separation,
 * including for red-green color vision deficiency (blue, amber, violet and pink differ in
 * more than the red-green axis), and the first series never shares the accent's hue.
 */
const SERIES_HUES = [255, 75, 305, 195, 350, 130];
const series = (L, c, hues = SERIES_HUES) => hues.map(H => color(L, c, H));

const themes = {
  evergreen: {
    mode: 'dark',
    ...darkNeutrals(165, 0.03),
    accent: color(0.86, 0.5, 92),
    accentText: color(0.22, 0.3, 165),
    // Up is lighter than down, so the pair stays apart without hue.
    positive: color(0.76, 0.95, 158),
    negative: color(0.69, 0.92, 26),
    markerBackground: color(0.33, 0.4, 158),
    markerText: color(0.94, 0.25, 158),
    series: series(0.79, 0.8, [235, 88, 310, 190, 352, 130]),
  },
  graphite: {
    mode: 'dark',
    ...darkNeutrals(262, 0.009),
    accent: color(0.8, 0.5, 282),
    accentText: color(0.2, 0.2, 282),
    positive: color(0.76, 0.95, 168),
    negative: color(0.69, 0.92, 20),
    markerBackground: color(0.33, 0.4, 172),
    markerText: color(0.94, 0.3, 172),
    series: series(0.79, 0.8, [230, 75, 330, 130, 190, 282]),
  },
  // Black, white and grays like a monochrome trading terminal. Blue marks the user's
  // own things (accent, orders); green and red stay for money and order flow.
  monochrome: {
    mode: 'dark',
    ...darkNeutrals(0, 0),
    background: absolute(0, 0, 0),
    surface: absolute(0.13, 0, 0),
    raised: absolute(0.19, 0, 0),
    border: absolute(0.24, 0, 0),
    borderStrong: absolute(0.52, 0, 0),
    grid: absolute(0.15, 0, 0),
    watermark: absolute(0.27, 0, 0),
    accent: color(0.55, 0.85, 264),
    accentText: absolute(1, 0, 0),
    // Lighter than the accent: drawings sit on black, buttons carry white text.
    drawing: color(0.74, 0.7, 264),
    positive: color(0.74, 0.9, 162),
    negative: color(0.71, 0.9, 24),
    markerBackground: absolute(0.3, 0, 0),
    markerText: absolute(0.96, 0, 0),
    series: series(0.72, 0.8, [255, 75, 330, 130, 190, 25]),
  },
  midnight: {
    mode: 'dark',
    ...darkNeutrals(252, 0.035),
    accent: color(0.82, 0.5, 215),
    accentText: color(0.2, 0.3, 240),
    positive: color(0.77, 0.95, 172),
    negative: color(0.695, 0.92, 15),
    markerBackground: color(0.34, 0.4, 178),
    markerText: color(0.95, 0.3, 178),
    series: series(0.8, 0.8, [305, 75, 130, 350, 255, 190]),
  },
  paper: {
    mode: 'light',
    ...lightNeutrals(262, 0.006),
    accent: color(0.5, 0.62, 278),
    accentText: color(1, 0, 0),
    positive: color(0.6, 0.97, 162),
    negative: color(0.54, 0.95, 24),
    markerBackground: color(0.94, 0.25, 165),
    markerText: color(0.42, 0.6, 165),
    series: series(0.55, 0.8, [235, 60, 340, 140, 190, 278]),
  },
  sand: {
    mode: 'light',
    ...lightNeutrals(78, 0.016, 0.965),
    accent: color(0.52, 0.55, 45),
    accentText: color(1, 0, 0),
    positive: color(0.58, 0.9, 152),
    negative: color(0.51, 0.88, 28),
    markerBackground: color(0.92, 0.25, 150),
    markerText: color(0.4, 0.5, 150),
    series: series(0.53, 0.8, [245, 95, 320, 190, 10, 140]),
  },
};

// --- Report --------------------------------------------------------------------------------
// [foreground, background, |Lc| minimum, WCAG minimum, what it is]
const pairs = [
  ['text', 'background', 75, 4.5, 'body text'],
  ['text', 'surface', 75, 4.5, 'body text on panels'],
  ['textStrong', 'background', 90, 7, 'headings'],
  ['textMuted', 'background', 60, 4.5, 'labels'],
  ['textMuted', 'surface', 60, 4.5, 'labels on panels'],
  ['textFaint', 'background', 45, 3, 'axis captions'],
  ['accentText', 'accent', 60, 4.5, 'accent button'],
  ['markerText', 'markerBackground', 60, 4.5, 'last-price marker'],
  ['positive', 'background', 45, 3, 'up candles'],
  ['negative', 'background', 45, 3, 'down candles'],
  ['drawing', 'background', 45, 3, 'drawings'],
  ['borderStrong', 'background', 15, 1.5, 'control borders'],
  ['grid', 'background', 0, 1.05, 'grid lines (quiet by design)'],
];
let failures = 0;
// Drawings use the accent, the brand color, never mistaken for an indicator series. A
// theme may pick its own, as monochrome does for contrast on black.
for (const t of Object.values(themes)) t.drawing ??= t.accent;
for (const [id, t] of Object.entries(themes)) {
  console.log(`\n${id} (${t.mode})`);
  const rows = [...pairs];
  t.series.forEach((_, i) => rows.push([`series${i + 1}`, 'background', 45, 3, 'indicator line']));
  for (const [fg, bg, minLc, minRatio, label] of rows) {
    const f = fg.startsWith('series') ? t.series[Number(fg.slice(6)) - 1] : t[fg];
    const lc = apca(f.hex, t[bg].hex),
      ratio = wcag(f.hex, t[bg].hex);
    const ok = Math.abs(lc) >= minLc && ratio >= minRatio;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(12)} on ${bg.padEnd(16)} Lc ${lc.toFixed(1).padStart(6)}  ${ratio.toFixed(2).padStart(5)}:1  ${label}`,
    );
  }
  // Up and down must differ in lightness, not only hue, for red-green deficiency.
  const gap = Math.abs(apca(t.positive.hex, t.background.hex) - apca(t.negative.hex, t.background.hex));
  const okGap = gap >= 8;
  if (!okGap) failures++;
  console.log(`  ${okGap ? 'ok  ' : 'FAIL'} up/down lightness gap Lc ${gap.toFixed(1)} (>= 8)`);
}

if (!process.argv.includes('--check')) {
  const keys = [
    'background',
    'surface',
    'raised',
    'border',
    'borderStrong',
    'text',
    'textStrong',
    'textMuted',
    'textFaint',
    'accent',
    'accentText',
    'positive',
    'negative',
    'grid',
    'crosshair',
    'markerBackground',
    'markerText',
    'drawing',
    'watermark',
  ];
  let out = `// Generated by scripts/palette.mjs from OKLCH sources. Edit the script, then rerun it.\n\n`;
  out += `export const builtInPalettes = {\n`;
  for (const [id, t] of Object.entries(themes)) {
    out += `  ${id}: {\n`;
    for (const key of keys) out += `    ${key}: '${t[key].hex}', // ${t[key].oklch}\n`;
    t.series.forEach((c, i) => {
      out += `    ${i ? `indicator${i + 1}` : 'indicator'}: '${c.hex}', // ${c.oklch}\n`;
    });
    out += `  },\n`;
  }
  out += `} as const;\n`;
  await writeFile(new URL('../src/theme-palettes.ts', import.meta.url), out);
  console.log('\nWrote src/theme-palettes.ts');
}
console.log(failures ? `\n${failures} pair(s) below threshold` : '\nAll pairs meet their thresholds');
process.exit(failures && process.argv.includes('--check') ? 1 : 0);
