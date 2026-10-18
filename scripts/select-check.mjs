#!/usr/bin/env node
// Checks the custom <cf-select> pickers on the demo: the interval list opens grouped,
// arrow keys and Enter change the interval, Escape closes and returns focus, type-ahead
// jumps, a click chooses, the symbol list filters as you type, and a picker in the
// transformed drawing strip opens beside its trigger without scrolling the widget.
//
//   node scripts/select-check.mjs                          # starts Vite on 5199
//   node scripts/select-check.mjs --url http://127.0.0.1:5173 --out artifacts/select
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/select';
let url = arg('url'),
  server;
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
await mkdir(out, { recursive: true });

const problems = [];
const check = (ok, message, detail) => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${message}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`,
  );
  if (!ok) problems.push(message);
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${url}?offline`);
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  const interval = () => page.evaluate(() => window.candleframe.inspect().document.interval);

  // The interval picker: a combobox that opens a listbox.
  const picker = page.getByRole('combobox', { name: /^Candle interval/ });
  check(await picker.isVisible(), 'the interval picker is a combobox');
  await picker.click();
  const list = page.getByRole('listbox');
  check(await list.isVisible(), 'clicking opens the list');
  check((await picker.getAttribute('aria-expanded')) === 'true', 'aria-expanded follows the list');
  const options = await list.getByRole('option').allInnerTexts();
  check(options.length > 3, 'the list shows the intervals', options);
  await page.screenshot({ path: `${out}/interval-open.png` });

  // Keyboard: Escape closes and keeps focus on the picker.
  await page.keyboard.press('Escape');
  check(!(await list.isVisible()), 'Escape closes the list');
  check(
    await page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active?.getAttribute('role') === 'combobox';
    }),
    'focus returns to the picker',
  );

  // ArrowDown opens on the current value; ArrowDown and Enter choose the next one.
  const before = await interval();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(previous => window.candleframe.inspect().document.interval !== previous, before);
  check((await interval()) !== before, 'arrow keys and Enter change the interval', [
    before,
    await interval(),
  ]);

  // A click on an option chooses it.
  await picker.click();
  await list.getByRole('option', { name: '1m', exact: true }).click();
  await page.waitForFunction(() => window.candleframe.inspect().document.interval === '1m');
  check((await interval()) === '1m', 'a click chooses an option');

  // Type-ahead moves to the next option starting with the typed text.
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('1');
  const active = await page.evaluate(() => {
    const host = document.querySelector('#app > *').shadowRoot.querySelector('#interval');
    return host.shadowRoot.querySelector('.option.active')?.innerText;
  });
  check(active?.startsWith('1'), 'type-ahead jumps to a matching option', active);
  await page.keyboard.press('Escape');

  // The symbol picker: a long list gets a search box that filters.
  const symbol = page.getByRole('combobox', { name: /^Symbol/ });
  await symbol.click();
  const search = page.getByRole('textbox', { name: 'Search' });
  if (await search.isVisible()) {
    await search.fill('eth');
    const shown = await page.getByRole('listbox').getByRole('option').allInnerTexts();
    check(shown.length >= 1 && shown.every(s => /eth/i.test(s)), 'search filters the symbols', shown);
    await page.screenshot({ path: `${out}/symbol-search.png` });
  } else console.log('note symbol list is short, so it has no search box');
  await page.keyboard.press('Escape');

  // A picker inside a transformed bar (the drawing strip centres itself with translateX)
  // still opens under its trigger, and opening it scrolls none of the widget's panels.
  await page.evaluate(() => {
    const chart = window.candleframe,
      { latestCandle: last, feed } = chart.inspect();
    chart.execute({
      type: 'drawing.add',
      drawing: {
        id: 'select-check',
        type: 'fib-retracement',
        points: [
          { timeMs: last.timeMs - 40 * feed.intervalMs, price: last.close * 0.998 },
          { timeMs: last.timeMs - 10 * feed.intervalMs, price: last.close * 1.002 },
        ],
      },
    });
    chart.selectDrawing('select-check');
  });
  const style = page.getByRole('combobox', { name: /^Drawing line style/ });
  await style.click();
  const styleList = page.getByRole('listbox');
  await styleList.waitFor();
  const trigger = await style.boundingBox(),
    popup = await styleList.boundingBox();
  const gap =
    popup.y >= trigger.y ? popup.y - (trigger.y + trigger.height) : trigger.y - (popup.y + popup.height);
  check(
    gap >= 0 && gap < 24 && Math.abs(popup.x - trigger.x) < 40,
    'a picker in the drawing strip opens beside its trigger',
    { trigger, popup },
  );
  const scrolled = await page.evaluate(() => {
    const found = [];
    const walk = root =>
      root.querySelectorAll('*').forEach(el => {
        if ((el.scrollTop || el.scrollLeft) && el.getAttribute('role') !== 'listbox')
          found.push(el.className || el.tagName);
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    walk(document);
    return found;
  });
  check(scrolled.length === 0, 'opening it scrolls no panel', scrolled);
  await page.screenshot({ path: `${out}/drawing-strip-select.png` });
  await styleList.getByRole('option', { name: 'Dashed' }).click();
  check(
    await page.evaluate(
      () =>
        window.candleframe.exportDocument().drawings.find(d => d.id === 'select-check')?.style.lineStyle ===
        'dashed',
    ),
    'choosing Dashed restyles the drawing',
  );
} finally {
  await browser.close();
  server?.kill();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`\nScreenshots in ${out}`);
