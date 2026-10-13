#!/usr/bin/env node
// Screenshots the footprint chart type in each cell mode, through the Chart type dialog.
//
//   node scripts/footprint-screens.mjs                                  # starts Vite on 5197
//   node scripts/footprint-screens.mjs --url http://127.0.0.1:5173/ --out artifacts/footprint
//   node scripts/footprint-screens.mjs --theme paper --width 1100
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
const out = args.out ?? 'artifacts/footprint';
await mkdir(out, { recursive: true });
let url = args.url,
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
  const dialog = host.locator('.widget-dialog');
  const close = async () => {
    await page.keyboard.press('Escape');
    await sleep(300);
  };
  await sleep(400);

  await host.locator('#chart-type').click();
  await sleep(250);
  await page.screenshot({ path: `${out}/0-dialog.png` });
  await dialog.getByRole('button', { name: 'Footprint', exact: true }).click();
  await sleep(200);
  const doc = await page.evaluate(() => window.candleframe.exportDocument());
  if (doc.chartType !== 'footprint') problems.push(`chartType is ${doc.chartType}, expected footprint`);
  for (const [i, [label, file]] of [
    ['Bid × Ask', 'bid-ask'],
    ['Delta', 'delta'],
    ['Volume', 'volume'],
  ].entries()) {
    if (!(await dialog.isVisible())) {
      await host.locator('#chart-type').click();
      await sleep(250);
    }
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await close();
    await page.screenshot({ path: `${out}/${i + 1}-${file}.png` });
  }
  await host.locator('#chart-type').click();
  await sleep(250);
  for (const label of ['Imbalances (3:1)', 'Point of control', 'Delta and volume'])
    await dialog.getByLabel(label).uncheck();
  // Read before the deep zoom turns the toggles back on.
  const toggled = await page.evaluate(() => window.candleframe.exportDocument().footprint);
  await dialog.getByRole('button', { name: 'Bid × Ask', exact: true }).click();
  await close();
  await page.screenshot({ path: `${out}/4-bid-ask-plain.png` });
  // Deep zoom: four bars wide and about $40 tall, so single buckets get their own rows.
  await page.evaluate(() => {
    const chart = window.candleframe;
    chart.execute({
      type: 'chartType.set',
      chartType: 'footprint',
      footprint: { imbalance: true, poc: true, summary: true },
    });
    const { feed, latestCandle } = chart.inspect();
    const end = latestCandle.timeMs + feed.intervalMs;
    chart.execute({ type: 'viewport.set', fromMs: end - 4 * feed.intervalMs, toMs: end });
    chart.execute({
      type: 'priceScale.set',
      minPrice: latestCandle.close - 20,
      maxPrice: latestCandle.close + 20,
    });
  });
  await sleep(400);
  await page.screenshot({ path: `${out}/5-deep-zoom.png` });
  const plain = toggled;
  if (plain.imbalance || plain.poc || plain.summary)
    problems.push(`toggles did not apply: ${JSON.stringify(plain)}`);
} catch (error) {
  problems.push(`step failed: ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`Screenshots in ${out}/`);
process.exit(problems.length ? 1 : 0);
