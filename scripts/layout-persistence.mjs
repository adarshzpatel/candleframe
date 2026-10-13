#!/usr/bin/env node
// Checks that the demo widget autosaves drawings and loads them again.
//
//   node scripts/layout-persistence.mjs                    # starts Vite on 5198
//   node scripts/layout-persistence.mjs --url http://127.0.0.1:5173
//
// Adds a drawing, reloads, moves it, reloads straight away (the pagehide flush),
// then switches symbol and back. Fails if a drawing or its position is lost.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
let url = arg('url'),
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

const problems = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) problems.push(message);
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  const ready = () =>
    page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  const drawings = () => page.evaluate(() => window.candleframe.inspect().document.drawings);
  const pick = (id, value) =>
    page.evaluate(
      ([id, value]) => {
        const select = document.querySelector('#app > *').shadowRoot.querySelector(`#${id}`);
        const chosen = value ?? [...select.options].map(o => o.value).find(v => v !== select.value);
        select.value = chosen;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return chosen;
      },
      [id, value],
    );

  await page.goto(new URL('?offline', url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready();
  await sleep(300);
  await page.evaluate(() => {
    const chart = window.candleframe;
    const { timeMs, close } = chart.inspect().latestCandle;
    const step = chart.inspect().feed.intervalMs;
    chart.execute({
      type: 'drawing.add',
      drawing: {
        id: 'persisted',
        type: 'trendline',
        points: [
          { timeMs: timeMs - 30 * step, price: close - 50 },
          { timeMs, price: close + 50 },
        ],
      },
    });
  });
  await sleep(700);
  await page.reload();
  await ready();
  await sleep(300);
  let current = await drawings();
  check(
    current.some(d => d.id === 'persisted'),
    'drawing survives a reload',
  );
  check(
    !(await page.evaluate(() => window.candleframe.inspect().history.canUndo)),
    'loading the layout adds no undo step',
  );

  const moved = await page.evaluate(() => {
    const chart = window.candleframe;
    const drawing = chart.inspect().document.drawings.find(d => d.id === 'persisted');
    const points = drawing.points.map(p => ({ ...p, price: p.price + 123 }));
    chart.execute({ type: 'drawing.update', id: 'persisted', patch: { points } });
    return points[0].price;
  });
  await page.reload();
  await ready();
  await sleep(300);
  current = await drawings();
  check(
    current.find(d => d.id === 'persisted')?.points[0].price === moved,
    'a move survives an immediate reload',
  );

  const symbol = await page.evaluate(() => window.candleframe.inspect().symbol);
  await pick('symbol');
  await page.waitForFunction(s => window.candleframe.inspect().symbol !== s, symbol);
  await sleep(300);
  check((await drawings()).length === 0, 'another symbol starts without the drawing');
  await pick('symbol', symbol);
  await page.waitForFunction(s => window.candleframe.inspect().symbol === s, symbol);
  await sleep(300);
  current = await drawings();
  check(current.find(d => d.id === 'persisted')?.points[0].price === moved, 'switching back restores it');
} catch (error) {
  problems.push(`step failed: ${error.message}`);
  console.log(`FAIL ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems.filter(p => p.startsWith('pageerror'))) console.log(`FAIL ${problem}`);
process.exit(problems.length ? 1 : 0);
