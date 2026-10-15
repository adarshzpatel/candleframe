#!/usr/bin/env node
// Checks that the demo widget autosaves drawings and loads them again, and that
// chart settings stay with the pane across interval and symbol changes.
//
//   node scripts/layout-persistence.mjs                    # starts Vite on 5198
//   node scripts/layout-persistence.mjs --url http://127.0.0.1:5173
//
// Adds a drawing, reloads, moves it, reloads straight away (the pagehide flush),
// then switches symbol and back. Fails if a drawing or its position is lost. Then visits
// another interval (so it has a saved layout), adds an indicator and switches to
// footprints, then switches interval, symbol and reloads: both must stay on the pane.
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
        const chosen =
          value ?? select.items.find(item => !item.disabled && item.value !== select.value).value;
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

  // Chart settings: the indicator list and the chart type.
  const settings = () =>
    page.evaluate(() => {
      const d = window.candleframe.inspect().document;
      return { tideline: d.indicators.some(i => i.kind === 'tideline'), chartType: d.chartType ?? 'candles' };
    });
  const kept = async label => {
    const now = await settings();
    check(now.tideline && now.chartType === 'footprint', `chart settings stay on the pane ${label}`);
  };
  const switchTo = async (id, value) => {
    const chosen = await pick(id, value);
    const field = id === 'symbol' ? 'symbol' : 'interval';
    await page.waitForFunction(
      ([field, value]) =>
        (field === 'symbol'
          ? window.candleframe.inspect().symbol
          : window.candleframe.inspect().feed.interval) === value,
      [field, chosen],
    );
    await sleep(700);
    return chosen;
  };
  const interval = await page.evaluate(() => window.candleframe.inspect().feed.interval);
  const other = await switchTo('interval');
  // A drawing makes the other interval save a layout of its own, without these settings.
  await page.evaluate(() => {
    const { timeMs, close } = window.candleframe.inspect().latestCandle;
    window.candleframe.execute({
      type: 'drawing.add',
      drawing: { id: 'other-interval', type: 'horizontal-line', points: [{ timeMs, price: close }] },
    });
  });
  await sleep(700);
  await switchTo('interval', interval);
  await page.evaluate(() => {
    window.candleframe.execute({ type: 'indicator.add', indicator: { kind: 'tideline' } });
    window.candleframe.execute({ type: 'chartType.set', chartType: 'footprint' });
  });
  await sleep(700);
  await switchTo('interval', other);
  await kept(`switching ${interval} to ${other}`);
  await switchTo('symbol');
  await kept('switching symbol');
  await page.reload();
  await ready();
  await sleep(300);
  await kept('after a reload');
} catch (error) {
  problems.push(`step failed: ${error.message}`);
  console.log(`FAIL ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems.filter(p => p.startsWith('pageerror'))) console.log(`FAIL ${problem}`);
process.exit(problems.length ? 1 : 0);
