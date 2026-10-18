#!/usr/bin/env node
// Screenshots the chart pattern and Elliott wave tools with realistic anchors, one PNG per tool and
// setting variant. The price scale is pinned around the close so every anchor stays in view.
//
//   node scripts/patterns-gallery.mjs --url http://127.0.0.1:5211/ --out artifacts/patterns
//   node scripts/patterns-gallery.mjs --url http://127.0.0.1:5211/ --theme paper
//
// It needs a running dev server (`npx vite --host 127.0.0.1 --port 5211 --strictPort`).
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const url = arg('url');
if (!url) throw new Error('Pass --url of a running dev server, for example http://127.0.0.1:5211/');
const out = arg('out') ?? 'artifacts/patterns';
await mkdir(out, { recursive: true });

// Each shape lists [bars back from the right, price as a fraction of the pinned range (0 bottom, 1 top)].
const shapes = {
  xabcd: [
    [100, 0.15],
    [82, 0.8],
    [66, 0.42],
    [50, 0.66],
    [30, 0.22],
  ],
  cypher: [
    [100, 0.15],
    [84, 0.6],
    [70, 0.38],
    [52, 0.82],
    [30, 0.3],
  ],
  'head-and-shoulders': [
    [104, 0.2],
    [92, 0.6],
    [80, 0.38],
    [66, 0.85],
    [52, 0.42],
    [40, 0.62],
    [26, 0.18],
  ],
  abcd: [
    [96, 0.15],
    [74, 0.7],
    [58, 0.4],
    [32, 0.88],
  ],
  'triangle-pattern': [
    [100, 0.85],
    [86, 0.15],
    [70, 0.72],
    [56, 0.3],
  ],
  'three-drives': [
    [104, 0.12],
    [92, 0.42],
    [84, 0.28],
    [70, 0.62],
    [62, 0.48],
    [46, 0.86],
    [32, 0.5],
  ],
  'elliott-impulse': [
    [100, 0.12],
    [88, 0.42],
    [80, 0.26],
    [62, 0.78],
    [52, 0.58],
    [36, 0.88],
  ],
  'elliott-correction': [
    [96, 0.85],
    [76, 0.35],
    [62, 0.62],
    [40, 0.15],
  ],
  'elliott-triangle': [
    [100, 0.9],
    [88, 0.15],
    [76, 0.75],
    [64, 0.28],
    [52, 0.62],
    [42, 0.4],
  ],
  'elliott-double-combo': [
    [96, 0.85],
    [76, 0.35],
    [62, 0.6],
    [40, 0.15],
  ],
  'elliott-triple-combo': [
    [104, 0.88],
    [90, 0.45],
    [80, 0.65],
    [66, 0.3],
    [56, 0.5],
    [40, 0.12],
  ],
};
// Extra screenshots for settings that change the look.
const variants = [
  ['xabcd', 'no-background', { background: false, ratios: false }],
  ['elliott-impulse', 'primary', { degree: 'primary' }],
  ['elliott-impulse', 'minute', { degree: 'minute' }],
  ['elliott-correction', 'cycle', { degree: 'cycle' }],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log(`pageerror: ${e.message}`));
  await page.goto(`${url}?offline`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  if (arg('theme')) await page.evaluate(id => window.candleframe.setTheme(id), arg('theme'));
  const runs = [
    ...Object.keys(shapes).map(type => [type, type, {}]),
    ...variants.map(([type, name, options]) => [type, `${type}-${name}`, options]),
  ];
  for (const [type, name, options] of runs) {
    const placed = await page.evaluate(
      ({ type, shape, options }) => {
        const chart = window.candleframe;
        chart.execute({ type: 'drawing.clear' });
        const { latestCandle: last, feed } = chart.inspect();
        const bar = feed.intervalMs,
          toMs = last.timeMs + 10 * bar,
          low = last.close * 0.994,
          high = last.close * 1.006;
        chart.execute({ type: 'viewport.set', fromMs: toMs - 120 * bar, toMs });
        chart.execute({ type: 'priceScale.set', minPrice: low, maxPrice: high });
        const points = shape.map(([back, at]) => ({
          timeMs: last.timeMs - (back * 0.62 + 6) * bar,
          price: low + (high - low) * at,
        }));
        try {
          chart.execute({ type: 'drawing.add', drawing: { id: 'gallery', type, points, options } });
          chart.selectDrawing('gallery');
          return true;
        } catch (error) {
          return String(error);
        }
      },
      { type, shape: shapes[type], options },
    );
    if (placed !== true) {
      console.log(`skip ${name}: ${placed}`);
      continue;
    }
    await sleep(250);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`ok   ${name}`);
  }

  // The Patterns menu, then an XABCD placed with five real clicks and its settings panel.
  const host = page.locator('#app > *');
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  await host.locator('.drawing-group-more').nth(2).click();
  await sleep(150);
  const sections = await host.locator('.drawing-tool-section').allTextContents();
  console.log(`menu sections: ${sections.join(', ')}`);
  await host.locator('.drawing-flyout').screenshot({ path: `${out}/patterns-menu.png` });
  await host.locator('.drawing-tool-item', { hasText: 'XABCD' }).first().click();
  const plot = await host.locator('.chart-host').first().boundingBox();
  const at = (fx, fy) => [plot.x + plot.width * fx, plot.y + plot.height * fy];
  for (const [fx, fy] of [
    [0.4, 0.75],
    [0.48, 0.25],
    [0.55, 0.55],
    [0.62, 0.35],
    [0.7, 0.7],
  ]) {
    await page.mouse.click(...at(fx, fy));
    await sleep(80);
  }
  const placed = await page.evaluate(() => window.candleframe.exportDocument().drawings);
  const ok = placed.length === 1 && placed[0].type === 'xabcd' && placed[0].points.length === 5;
  console.log(`${ok ? 'ok  ' : 'FAIL'} five clicks place an XABCD (${placed.map(d => d.type).join()})`);
  await page.mouse.dblclick(...at(0.48, 0.25));
  await sleep(200);
  const settings = host.locator('.drawing-settings');
  if (await settings.isVisible()) await settings.screenshot({ path: `${out}/xabcd-settings.png` });
  console.log(`${(await settings.isVisible()) ? 'ok  ' : 'FAIL'} double-click opens the XABCD settings`);
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(`Gallery in ${out}/`);
