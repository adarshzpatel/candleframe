#!/usr/bin/env node
// Screenshot the demo at desktop and phone widths.
//
//   node scripts/screenshot.mjs                                  # starts Vite
//   node scripts/screenshot.mjs --url http://127.0.0.1:5173/ --out artifacts/screens
//   node scripts/screenshot.mjs --query offline --add vp,price-delta,cvd   # mock order flow
//   node scripts/screenshot.mjs --bars 24                                  # zoomed in to 24 bars
//   node scripts/screenshot.mjs --interval 15m --bars 600 --add vp:day=1:sessions=1   # inputs after the kind
//   node scripts/screenshot.mjs --theme paper,sand                         # one shot per theme
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
const out = args.out ?? 'artifacts/screens';
await mkdir(out, { recursive: true });

let server;
let url = args.url;
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

const browser = await chromium.launch();
try {
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('console', m => m.type() === 'error' && console.log(`${name} console: ${m.text()}`));
    page.on('pageerror', e => console.log(`${name} pageerror: ${e.message}`));
    await page.goto(args.query ? `${url}?${args.query}` : url, { waitUntil: 'load' });
    await page
      .waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 })
      .catch(() => console.log(`${name}: chart did not load 100 candles`));
    if (args.interval) {
      await page.evaluate(interval => {
        const picker = document.querySelector('#app > *').shadowRoot.querySelector('#interval');
        picker.value = interval;
        picker.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }, args.interval);
      await page
        .waitForFunction(
          interval =>
            window.candleframe.inspect().feed.interval === interval &&
            window.candleframe.inspect().candleCount > 100,
          args.interval,
          { timeout: 15000 },
        )
        .catch(() => console.log(`${name}: interval ${args.interval} did not load`));
    }
    if (args.add)
      await page.evaluate(specs => {
        for (const spec of specs) {
          // kind:key=value:key=value
          const [kind, ...pairs] = spec.split(':');
          const inputs = Object.fromEntries(
            pairs.map(pair => pair.split('=')).map(([k, v]) => [k, Number(v)]),
          );
          window.candleframe.execute({ type: 'indicator.add', indicator: { kind, inputs } });
        }
      }, args.add.split(','));
    if (args.bars)
      await page.evaluate(bars => {
        const chart = window.candleframe;
        const { latestCandle, feed } = chart.inspect();
        const toMs = latestCandle.timeMs + 2 * feed.intervalMs;
        chart.execute({ type: 'viewport.set', fromMs: toMs - bars * feed.intervalMs, toMs });
      }, Number(args.bars));
    await sleep(800);
    for (const theme of args.theme ? args.theme.split(',') : [null]) {
      if (theme) {
        await page.evaluate(id => window.candleframe.setTheme(id), theme);
        await sleep(400);
      }
      await page.screenshot({ path: `${out}/${theme ? `${name}-${theme}` : name}.png` });
    }
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(`Screenshots in ${out}/`);
