#!/usr/bin/env node
// Places every registered drawing tool on the offline demo, selects it and screenshots the chart,
// one PNG per tool, for side-by-side review against reference charting apps.
//
//   node scripts/drawing-gallery.mjs                                   # starts Vite on 5197
//   node scripts/drawing-gallery.mjs --url http://127.0.0.1:5173/ --out artifacts/drawings
//   node scripts/drawing-gallery.mjs --only trendline,fib-retracement  # a subset
//   node scripts/drawing-gallery.mjs --theme paper                     # another theme
//   node scripts/drawing-gallery.mjs --fixtures scripts/drawing-fixtures/shapes.json --plot
// A fixtures file maps a tool type to { "points": [[barsBack, priceMove], ...], "text": "..." }.
// --plot crops each screenshot to the chart.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/drawings';
const only = arg('only')?.split(',');
const fixtures = arg('fixtures') ? JSON.parse(await readFile(arg('fixtures'), 'utf8')) : {};
await mkdir(out, { recursive: true });

let url = arg('url'),
  server;
if (!url) {
  const port = 5197;
  server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await sleep(200);
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log(`pageerror: ${e.message}`));
  await page.goto(`${url}?offline`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  if (arg('theme')) await page.evaluate(id => window.candleframe.setTheme(id), arg('theme'));
  const tools = await page.evaluate(() => {
    const chart = window.candleframe;
    const { latestCandle, feed } = chart.inspect();
    const toMs = latestCandle.timeMs + 10 * feed.intervalMs;
    chart.execute({ type: 'viewport.set', fromMs: toMs - 120 * feed.intervalMs, toMs });
    return chart.drawingTools().map(t => ({ type: t.type, points: t.points }));
  });
  for (const tool of tools) {
    if (only && !only.includes(tool.type)) continue;
    tool.fixture = fixtures[tool.type];
    const placed = await page.evaluate(({ type, points, fixture }) => {
      const chart = window.candleframe;
      chart.execute({ type: 'drawing.clear' });
      const { latestCandle: last, feed } = chart.inspect();
      const bar = feed.intervalMs,
        c = last.close;
      // Times count back from the latest bar, squeezed into the right part of the plot that the
      // demo's order ticket leaves clear; prices are fractions of the close.
      const at = (bars, move) => ({ timeMs: last.timeMs - (bars * 0.62 + 6) * bar, price: c * (1 + move) });
      const presets = {
        1: [at(50, 0)],
        2: [at(90, -0.006), at(30, 0.006)],
        3: [at(90, -0.006), at(50, 0.007), at(25, -0.002)],
      };
      const special = {
        'parallel-channel': [at(90, -0.006), at(30, 0.002), at(80, 0.0)],
        'fib-channel': [at(90, -0.006), at(30, 0.002), at(80, 0.0)],
        'long-position': [at(80, 0), at(30, 0.008), at(30, -0.004)],
        'short-position': [at(80, 0), at(30, -0.008), at(30, 0.004)],
        callout: [at(60, 0), at(45, 0.006)],
        'flat-top-bottom': [at(90, -0.004), at(30, 0.001), at(60, 0.004)],
        'disjoint-channel': [at(90, 0.001), at(30, 0.004), at(90, -0.001)],
        'cyclic-lines': [at(95, 0), at(80, 0)],
        'time-cycles': [at(95, -0.001), at(75, -0.001)],
      };
      const count = typeof points === 'number' ? points : 6;
      const path = Array.from({ length: count }, (_, i) =>
        at(95 - i * 14, (i % 2 ? 0.005 : -0.004) + i * 0.0006),
      );
      const fixed = fixture?.points?.map(([bars, move]) => at(bars, move));
      const anchors = fixed ?? special[type] ?? presets[count] ?? path;
      try {
        chart.execute({
          type: 'drawing.add',
          drawing: { id: 'gallery', type, points: anchors, text: fixture?.text ?? 'Gallery note' },
        });
        chart.selectDrawing('gallery');
        return true;
      } catch (error) {
        return String(error);
      }
    }, tool);
    if (placed !== true) {
      console.log(`skip ${tool.type}: ${placed}`);
      continue;
    }
    await sleep(250);
    const clip = process.argv.includes('--plot') && (await page.locator('.chart-host').first().boundingBox());
    await page.screenshot({ path: `${out}/${tool.type}.png`, ...(clip ? { clip } : {}) });
    console.log(`ok   ${tool.type}`);
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(`Gallery in ${out}/`);
