#!/usr/bin/env node
// Live check of the Hyperliquid source in the demo. Needs network access to
// api.hyperliquid.xyz; it is not part of the offline smoke test.
//
//   node scripts/hyperliquid-live.mjs                   # starts Vite, checks BTC/USDC 1m
//   node scripts/hyperliquid-live.mjs --url http://127.0.0.1:5173 --out artifacts/hyperliquid
//   node scripts/hyperliquid-live.mjs --symbol HYPE/USDC --interval 5m --seconds 20
//
// It picks the Hyperliquid source in the demo's source picker, waits for live candle
// history, then watches for --seconds and requires a candle update in that window. It
// also checks that `?offline` drops the source. Screenshots go to --out. It fails on
// page errors, console errors or data that never arrives.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return pairs;
  }, []),
);
const out = args.out ?? 'artifacts/hyperliquid';
const symbol = args.symbol ?? 'BTC/USDC';
const interval = args.interval ?? '1m';
const seconds = Number(args.seconds ?? 15);
await mkdir(out, { recursive: true });

let server;
let url = args.url;
if (!url) {
  const port = 5198;
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

const problems = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  // A fresh profile per run, so no saved market or layout changes what loads.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 0, null, { timeout: 15000 });
  const pick = (id, value) =>
    page.evaluate(
      ([id, value]) => {
        const select = document.querySelector('#app > *')?.shadowRoot?.querySelector(`#${id}`);
        if (!select) throw new Error(`${id} picker not found`);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [id, value],
    );
  await pick('source', 'hyperliquid');
  await page.waitForFunction(() => window.candleframe.inspect().feed.id === 'hyperliquid', null, {
    timeout: 10000,
  });
  await pick('symbol', symbol);
  await pick('interval', interval);
  await page.waitForFunction(
    ([symbol, interval]) => {
      const state = window.candleframe.inspect();
      return (
        state.symbol === symbol &&
        state.feed.interval === interval &&
        state.stream.status === 'live' &&
        state.candleCount > 100
      );
    },
    [symbol, interval],
    { timeout: 30000 },
  );
  const read = () =>
    page.evaluate(() => {
      const state = window.candleframe.inspect();
      return {
        symbol: state.symbol,
        tickSize: state.feed.instrument.tickSize,
        candles: state.candleCount,
        latest: state.latestCandle,
        stream: state.stream.status,
      };
    });
  const before = await read();
  await page.screenshot({ path: `${out}/1-loaded.png` });
  await sleep(seconds * 1000);
  const after = await read();
  await page.screenshot({ path: `${out}/2-after-${seconds}s.png` });
  console.log('before', JSON.stringify(before));
  console.log('after ', JSON.stringify(after));
  const candleMoved =
    after.latest.timeMs > before.latest.timeMs ||
    after.latest.volume !== before.latest.volume ||
    after.latest.close !== before.latest.close;
  if (!candleMoved) problems.push(`no candle update in ${seconds}s`);
  if (after.stream !== 'live') problems.push(`stream ${after.stream}`);

  const offline = await browser.newPage();
  await offline.goto(new URL('?offline', url).href, { waitUntil: 'load' });
  await offline.waitForFunction(() => window.candleframe?.inspect().candleCount > 0, null, {
    timeout: 15000,
  });
  const listed = await offline.evaluate(() =>
    [...document.querySelector('#app > *').shadowRoot.querySelectorAll('#source option')].map(o => o.value),
  );
  if (listed.includes('hyperliquid') || listed.includes('binance'))
    problems.push(`?offline still lists live sources: ${listed.join(', ')}`);
} catch (error) {
  problems.push(`step failed: ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
console.log(`${problems.length ? 'FAIL' : 'ok  '} hyperliquid ${symbol} ${interval}`);
for (const problem of problems) console.log(`     ${problem}`);
process.exit(problems.length ? 1 : 0);
