#!/usr/bin/env node
// Picks every chart type from the Chart type dialog on the offline demo, checks the
// document and the button label follow, and screenshots each one.
//
//   node scripts/chart-type-screens.mjs                                   # starts Vite on 5198
//   node scripts/chart-type-screens.mjs --url http://127.0.0.1:5173/ --out artifacts/chart-types
//   node scripts/chart-type-screens.mjs --theme paper --width 1100
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
const out = args.out ?? 'artifacts/chart-types';
await mkdir(out, { recursive: true });
let url = args.url,
  server;
if (!url) {
  const port = 5198;
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

// Menu labels by chart type, as `CHART_TYPES` lists them.
const TYPES = [
  ['candles', 'Candles'],
  ['hollow-candles', 'Hollow candles'],
  ['heikin-ashi', 'Heikin Ashi'],
  ['ohlc-bars', 'Bars'],
  ['hlc-bars', 'HLC bars'],
  ['high-low', 'High-low'],
  ['columns', 'Columns'],
  ['line', 'Line'],
  ['line-markers', 'Line with markers'],
  ['step-line', 'Step line'],
  ['area', 'Area'],
  ['baseline', 'Baseline'],
];

const browser = await chromium.launch();
const problems = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) problems.push(message);
};
try {
  const page = await browser.newPage({
    viewport: { width: Number(args.width ?? 1400), height: 860 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', error => problems.push(`page error: ${error.message}`));
  await page.goto(new URL('?offline', url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  if (args.theme) await page.evaluate(theme => window.candleframe.setTheme(theme), args.theme);
  const host = page.locator('#app > *').first();
  const dialog = host.locator('.widget-dialog');
  const button = host.locator('#chart-type');
  await sleep(400);
  await button.click();
  await sleep(250);
  await dialog.screenshot({ path: `${out}/0-dialog.png` });
  for (const [i, [type, label]] of TYPES.entries()) {
    if (!(await dialog.isVisible())) {
      await button.click();
      await sleep(200);
    }
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await sleep(300);
    const document = await page.evaluate(() => window.candleframe.exportDocument());
    check((document.chartType ?? 'candles') === type, `${label} sets chartType ${type}`);
    check((await button.getAttribute('aria-label')) === `Chart type: ${label}`, `${label} names the button`);
    await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-${type}.png` });
  }
  // Heikin Ashi changes the bars the chart reads, not only how they draw.
  const bars = await page.evaluate(() => {
    const chart = window.candleframe;
    chart.execute({ type: 'chartType.set', chartType: 'heikin-ashi' });
    const shown = chart.query({ limit: 1 }).candles[0],
      raw = chart.query({ limit: 1, raw: true }).candles[0];
    return { shown, raw };
  });
  check(
    Math.abs(bars.shown.close - (bars.raw.open + bars.raw.high + bars.raw.low + bars.raw.close) / 4) < 1e-6,
    'Heikin Ashi query returns HA closes, and raw returns the feed',
  );
} catch (error) {
  problems.push(`step failed: ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`Screenshots in ${out}/`);
process.exit(problems.length ? 1 : 0);
