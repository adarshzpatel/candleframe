#!/usr/bin/env node
// Screenshots the widget's floating panels: tool flyout, drawing objects, indicators
// and the legend's per-indicator controls.
//
//   node scripts/panel-screens.mjs                                   # starts Vite on 5196
//   node scripts/panel-screens.mjs --url http://127.0.0.1:5173/ --out artifacts/panels
//   node scripts/panel-screens.mjs --theme paper --width 900
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const out = args.out ?? 'artifacts/panels';
await mkdir(out, { recursive: true });
let url = args.url,
  server;
if (!url) {
  const port = 5196;
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
const problems = [];
try {
  const page = await browser.newPage({
    viewport: { width: Number(args.width ?? 1400), height: 860 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(new URL('?offline', url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  if (args.theme) await page.evaluate(theme => window.candleframe.setTheme(theme), args.theme);
  const host = page.locator('#app > *').first();
  // Full page, plus a crop around the panel when one is given.
  const shot = async (name, selector) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    const panel = selector && host.locator(selector);
    if (!panel || !(await panel.isVisible())) return;
    const box = await panel.boundingBox();
    await page.screenshot({
      path: `${out}/${name}-crop.png`,
      clip: {
        x: Math.max(0, box.x - 60),
        y: Math.max(0, box.y - 40),
        width: box.width + 120,
        height: box.height + 80,
      },
    });
  };
  const escape = async () => {
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 400);
    await sleep(200);
  };
  await sleep(400);

  await host.locator('.drawing-group-more').nth(3).click();
  await sleep(250);
  await shot('1-tool-flyout', '.drawing-flyout');
  await escape();

  await page.evaluate(() => {
    const chart = window.candleframe;
    const { timeMs, close } = chart.inspect().latestCandle;
    const step = chart.inspect().feed.intervalMs;
    for (const [i, type] of ['trendline', 'rectangle', 'fib-retracement'].entries())
      chart.execute({
        type: 'drawing.add',
        drawing: {
          id: `d${i}`,
          type,
          points: [
            { timeMs: timeMs - (60 - i * 15) * step, price: close - 40 - i * 20 },
            { timeMs: timeMs - (30 - i * 10) * step, price: close + 40 + i * 20 },
          ],
        },
      });
    chart.selectDrawing('d1');
  });
  await sleep(250);
  await shot('2-drawing-selected', '.drawing-strip');
  await host.locator('.drawing-objects-button').click();
  await sleep(250);
  await shot('3-drawing-objects', '.drawing-object-panel');
  await host.locator('.drawing-objects-button').click();
  const settings = host.locator('.drawing-settings-button');
  if (await settings.count()) {
    await settings.click();
    await sleep(250);
    await shot('4-drawing-settings', '.drawing-settings');
  }
  await escape();

  await host.locator('#indicator-menu').click();
  await sleep(250);
  await shot('5-indicators', '.widget-dialog');
  const searchBox = host.locator('.indicator-panel input[type=search]');
  if (await searchBox.count()) {
    await searchBox.fill('vol');
    await sleep(150);
    await shot('6-indicators-search', '.widget-dialog');
    await searchBox.fill('');
  }
  // Add one so the legend has a row, then use its hover controls.
  await host.locator('.indicator-add').first().click();
  await escape();
  const row = host.locator('.legend-item').first();
  await row.hover();
  await sleep(150);
  await shot('7-legend-hover', '.chart-legend');
  await row.locator('button[aria-label$=settings]').click();
  await sleep(250);
  await shot('8-indicator-settings', '.widget-dialog');
  await escape();
  await row.hover();
  await row.locator('button[aria-label^=Hide]').click();
  await sleep(150);
  await shot('9-legend-hidden', '.chart-legend');
} catch (error) {
  problems.push(`step failed: ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`Screenshots in ${out}/`);
process.exit(problems.length ? 1 : 0);
