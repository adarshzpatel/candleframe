import { channelsIcons } from './drawing-tools-channels.ts';
import { fibIcons } from './drawing-tools-fib.ts';
import { forecastIcons } from './drawing-tools-forecast.ts';
import { patternsIcons } from './drawing-tools-patterns.ts';
import { shapesIcons } from './drawing-tools-shapes.ts';

/** A shared 24-unit icon grid. Icons are decorative; controls own accessible labels. */
const paths: Record<string, string> = {
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="7" r=".7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  cursor: '<path d="m5 3 14 8-7 2-3 7-4-17Z"/>',
  crosshair: '<path d="M12 3v5m0 8v5M3 12h5m8 0h5"/><circle cx="12" cy="12" r="2"/>',
  trendline:
    '<path d="m6 18 12-12"/><rect x="3" y="16" width="4" height="4" rx=".5"/><rect x="17" y="3" width="4" height="4" rx=".5"/>',
  ray: '<path d="m6 18 15-15"/><circle cx="5" cy="19" r="2"/>',
  'extended-line': '<path d="m3 21 18-18M7 13l4 4m2-10 4 4"/>',
  arrow: '<path d="M4 20 20 4m-9 0h9v9"/>',
  'info-line':
    '<path d="m5 19 9-9"/><circle cx="4" cy="20" r="1.5"/><circle cx="15" cy="9" r="1.5"/><rect x="13" y="13" width="8" height="7" rx="1"/><path d="M15 16h4"/>',
  'trend-angle': '<path d="M4 19 19 6M4 19h16"/><path d="M11 19a7 7 0 0 0-2-5"/>',
  xabcd: '<path d="m3 18 4-12 5 9 4-7 5 10"/><path d="M3 18 12 15M7 6l9 2" stroke-dasharray="2 2"/>',
  'horizontal-line': '<path d="M3 12h7m4 0h7"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
  'horizontal-ray': '<path d="M7 12h14"/><circle cx="5" cy="12" r="2"/>',
  'vertical-line': '<path d="M12 3v7m0 4v7"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
  'cross-line': '<path d="M12 3v18M3 12h18"/>',
  'parallel-channel': '<path d="m3 14 15-9M6 20l15-9"/><path d="m5 17 15-9" stroke-dasharray="2 3"/>',
  pitchfork: '<path d="m4 20 16-16M4 12l4 4 4 4M4 12l9-9m-1 17 9-9"/>',
  'schiff-pitchfork':
    '<path d="m4 20 16-16M3 11l10 10M3 11l8-8m2 18 8-8"/><path d="m4 20 4-4" stroke-dasharray="1 3"/>',
  'fib-retracement':
    '<path d="M4 4h16M4 9h16M4 13h16M4 20h16"/><path d="m5 19 14-14" stroke-dasharray="2 3"/>',
  'fib-extension': '<path d="M3 4h18M10 9h11M10 14h11m-17 6 4-9 4 5 6-12"/>',
  'fib-channel': '<path d="m3 11 14-8M3 16l18-10M5 21l16-9"/>',
  'fib-fan': '<path d="M3 20 21 3M3 20 21 10M3 20h18"/>',
  'fib-time-zone': '<path d="M3 4v16M6 4v16M11 4v16M20 4v16"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  triangle: '<path d="m12 4 9 16H3L12 4Z"/>',
  polyline: '<path d="m3 17 5-10 8 9 5-12"/><circle cx="8" cy="7" r="1.5"/><circle cx="16" cy="16" r="1.5"/>',
  brush: '<path d="M3 17c2-9 5-14 7-11s-5 13 0 13c3 0 4-8 6-8s-1 8 5 3"/>',
  highlighter: '<path d="m8 15 8-11 5 4-8 11-5-4ZM8 15l-4 6h7M3 21h13"/>',
  text: '<path d="M5 7V4h14v3M12 4v16m-4 0h8"/>',
  callout: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8m-8 4h5"/>',
  'price-label': '<path d="m3 12 6-7h12v14H9l-6-7Z"/><circle cx="9" cy="12" r="1"/>',
  'price-range': '<path d="M7 3h10M7 21h10M12 3v18m-3-15 3-3 3 3m-6 12 3 3 3-3"/>',
  'date-range': '<path d="M3 7v10M21 7v10M3 12h18m-15-3-3 3 3 3m12-6 3 3-3 3"/>',
  'date-price-range': '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="m7 17 10-10m-5 0h5v5"/>',
  'long-position':
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14h16M12 7v5m-2-3 2-2 2 2"/>',
  'short-position':
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 10h16M12 12v5m-2-2 2 2 2-2"/>',
  measure: '<path d="m3 16 13-13 5 5L8 21l-5-5Zm7-8 3 3m1-7 3 3M6 12l3 3"/>',
  undo: '<path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 6 6v2"/>',
  redo: '<path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0-6 6v2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3h.01"/>',
  indicators: '<path d="M5 20 9 4h8M4 10h10m1 4 6 6m0-6-6 6"/>',
  volume: '<path d="M5 20V13m7 7V4m7 16V9"/>',
  book: '<path d="M4 5h6m4 0h6M4 10h6m4 0h6M4 15h6m4 0h6M4 20h6m4 0h6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"/>',
  restore: '<path d="M3 10V5h5M4 6a9 9 0 1 1-1 10m9-9v5l3 2"/>',
  camera: '<path d="M8 6 10 3h4l2 3h5v14H3V6h5Z"/><circle cx="12" cy="13" r="4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5" transform="translate(0 -1)"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="m3 3 18 18M9 5a10 10 0 0 1 3 0c6 0 10 7 10 7a18 18 0 0 1-3 4M6 6a20 20 0 0 0-4 6s4 7 10 7a13 13 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/>',
  keep: '<path d="M16 3h5v5M21 3l-6 6M8 21H3v-5m0 5 6-6M3 9V3h6m6 18h6v-6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>',
  arrowRight: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  candles:
    '<path d="M7 3v18M17 5v14"/><rect x="5" y="7" width="4" height="9" rx=".5"/><rect x="15" y="9" width="4" height="6" rx=".5"/>',
  footprint:
    '<path d="M5 3v18"/><rect x="8" y="5" width="12" height="14" rx="1"/><path d="M8 9.7h12M8 14.3h12M14 5v14"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4"/>',
  template:
    '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><path d="M16.5 13v7M13 16.5h7"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
  'star-filled':
    '<path fill="currentColor" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
  grip: '<circle cx="9" cy="6" r=".8"/><circle cx="15" cy="6" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="18" r=".8"/><circle cx="15" cy="18" r=".8"/>',
};
Object.assign(paths, channelsIcons, fibIcons, forecastIcons, patternsIcons, shapesIcons);
const groups: Record<string, string> = {
  Lines: 'trendline',
  'Fib & Gann': 'fib-retracement',
  Patterns: 'xabcd',
  Forecasting: 'long-position',
  Shapes: 'rectangle',
  Annotations: 'text',
};
export const uiIcon = (name: string, size = 20): string =>
  `<svg class="oc-icon" width="${size}" height="${size}" style="width:calc(${size}px * var(--theme-effects-iconScale,1));height:calc(${size}px * var(--theme-effects-iconScale,1));stroke-width:var(--theme-effects-iconStroke,1.5)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[groups[name] ?? name] ?? paths.trendline}</svg>`;
