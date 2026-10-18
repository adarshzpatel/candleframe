#!/usr/bin/env node
// Screenshots the chart while a market loads and when loading fails, using the demo's
// Hyperliquid source with its network held or failed by Playwright. No network needed.
//
//   node scripts/loading-screens.mjs                                  # starts Vite on 5199
//   node scripts/loading-screens.mjs --url http://127.0.0.1:5173/ --out artifacts/loading
//
// Shots: the first frame after switching (before any delay elapses), the held loading
// state, the same in a light theme, and the error state. Fails on page errors.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/loading';
await mkdir(out, { recursive: true });

let server;
let url = arg('url');
if (!url) {
  const port = 5199;
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

const problems = [];
let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  page.on('pageerror', error => problems.push(error.message));
  // Hyperliquid REST never answers while `mode` is 'hold', and fails with 500 in 'fail'.
  // The socket is refused, so only REST decides what the chart shows.
  let mode = 'hold';
  await page.route('https://api.hyperliquid.xyz/**', async route => {
    if (mode === 'fail') return route.fulfill({ status: 500, body: 'unavailable' });
    await new Promise(() => {});
  });
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', ws => ws.close());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 0, null, { timeout: 15000 });
  const host = () => page.locator('#app > *').first();
  const pickSource = value =>
    page.evaluate(value => {
      const select = document.querySelector('#app > *')?.shadowRoot?.querySelector('#source');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  await pickSource('hyperliquid');
  await page.waitForFunction(() => window.candleframe.inspect().feed.id === 'hyperliquid');
  await host().screenshot({ path: `${out}/1-first-frame.png` });
  await sleep(1500);
  await host().screenshot({ path: `${out}/2-loading.png` });
  check(
    await page.evaluate(() => window.candleframe.inspect().candleCount === 0),
    'loading: no candles while history is held',
  );

  await page.evaluate(async () => {
    const { createTheme } = await import('/src/themes.ts');
    window.candleframe.setTheme(createTheme('paper'));
  });
  await sleep(300);
  await host().screenshot({ path: `${out}/3-loading-light.png` });
  await page.evaluate(async () => {
    const { createTheme } = await import('/src/themes.ts');
    window.candleframe.setTheme(createTheme('graphite'));
  });

  mode = 'fail';
  await pickSource('simulated');
  await page.waitForFunction(() => window.candleframe.inspect().candleCount > 0);
  await pickSource('hyperliquid');
  await page.waitForFunction(() => window.candleframe.inspect().stream.status === 'error', null, {
    timeout: 15000,
  });
  await sleep(300);
  await host().screenshot({ path: `${out}/4-error.png` });
  check(!problems.length, `no page errors${problems.length ? `: ${problems.join('; ')}` : ''}`);
} finally {
  await browser.close();
  server?.kill();
}
console.log(`Screenshots in ${out}/`);
process.exit(failed ? 1 : 0);
