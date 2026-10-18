#!/usr/bin/env node
// Cross-browser smoke test for the demo widget.
//
//   node scripts/smoke.mjs                       # starts Vite, runs all browsers
//   node scripts/smoke.mjs --url http://127.0.0.1:5173 --out artifacts/smoke
//   node scripts/smoke.mjs --browsers chromium,webkit
//
// Each run loads the demo, adds RSI and MACD panes, switches to log scale and the
// gapped sample equity market, pans, and saves a screenshot per step. It fails on
// page errors, console errors or a chart that never renders.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, firefox, webkit, devices } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return pairs;
  }, []),
);
const out = args.out ?? 'artifacts/smoke';
const engines = { chromium, firefox, webkit };
const selected = (args.browsers ?? 'chromium,firefox,webkit').split(',');
await mkdir(out, { recursive: true });

let server;
let url = args.url;
if (!url) {
  const port = 5199;
  server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await sleep(200);
  }
}

const failures = [];
async function run(name, launch, contextOptions = {}) {
  let browser;
  try {
    browser = await launch.launch();
  } catch (error) {
    console.log(`FAIL ${name}\n     launch failed: ${error.message.split('\n')[0]}`);
    failures.push(name);
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, ...contextOptions });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  const shot = step => page.screenshot({ path: `${out}/${name}-${step}.png` });
  try {
    // Offline mode uses the seeded simulation so runs do not depend on live exchanges.
    await page.goto(new URL('?offline', url).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, {
      timeout: 15000,
    });
    await sleep(400);
    await shot('1-default');
    await page.evaluate(() => {
      const chart = window.candleframe;
      chart.execute({ type: 'indicator.add', indicator: { kind: 'rsi' } });
      chart.execute({ type: 'indicator.add', indicator: { kind: 'macd' } });
      chart.execute({ type: 'indicator.add', indicator: { kind: 'bb' } });
      chart.execute({ type: 'priceScale.log', enabled: true });
    });
    await sleep(400);
    const panes = await page.evaluate(() => window.candleframe.inspect().indicators.map(i => i.kind));
    if (!panes.includes('rsi') || !panes.includes('macd')) problems.push(`indicators missing: ${panes}`);
    await shot('2-panes-log');
    // The indicator dialog keeps keyboard focus inside until Escape, then returns it.
    if (!contextOptions.hasTouch) {
      const host = page.locator('#app > *').first();
      await host.locator('#indicator-menu').click();
      await sleep(150);
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const shadow = document.querySelector('#app > *').shadowRoot;
        return shadow.querySelector('.widget-dialog').contains(shadow.activeElement);
      });
      if (!inside) problems.push('focus left the indicator dialog');
      await shot('2b-indicator-dialog');
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => {
        const shadow = document.querySelector('#app > *').shadowRoot;
        return shadow.querySelector('.widget-dialog').hidden && shadow.activeElement?.id === 'indicator-menu';
      });
      if (!closed) problems.push('Escape did not close the dialog and restore focus');
    }
    // Drag the plot to pan, then let paging and motion settle.
    const box = await page.locator('#app').boundingBox();
    if (contextOptions.hasTouch) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 3);
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 3, { steps: 8 });
      await page.mouse.up();
    }
    await sleep(500);
    await shot('3-panned');
    // Gapped static data: weekends and nights take no space.
    await page.evaluate(() => {
      const select = document.querySelector('#app').querySelector('*')?.shadowRoot?.querySelector('#source');
      if (!select) throw new Error('source picker not found');
      select.value = 'sample-equity';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => window.candleframe?.inspect().symbol === 'ACME', null, {
      timeout: 10000,
    });
    await sleep(500);
    const equity = await page.evaluate(() => {
      const state = window.candleframe.inspect();
      return { gaps: state.feed.gaps, candles: state.candleCount, depth: state.streams.depth.status };
    });
    if (!equity.gaps || equity.candles < 100 || equity.depth !== 'unavailable')
      problems.push(`sample equity state: ${JSON.stringify(equity)}`);
    await shot('4-equity-gaps');
  } catch (error) {
    problems.push(`step failed: ${error.message}`);
    await shot('error').catch(() => {});
  }
  await browser.close();
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}`);
  for (const problem of problems) console.log(`     ${problem}`);
  if (problems.length) failures.push(name);
}

try {
  for (const engine of selected) await run(engine, engines[engine]);
  if (selected.includes('webkit')) await run('webkit-touch', webkit, { ...devices['iPhone 14'] });
  if (selected.includes('chromium')) await run('chromium-touch', chromium, { ...devices['Pixel 7'] });
} finally {
  server?.kill();
}
console.log(`Screenshots in ${out}/`);
process.exit(failures.length ? 1 : 0);
