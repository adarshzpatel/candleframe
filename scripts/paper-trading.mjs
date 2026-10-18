#!/usr/bin/env node
// Checks the trading plugin on the demo (`?trading`) with the paper broker: the order panel, a market buy, a TP
// dragged out of the position line, the right-click menu and Flatten all.
//
//   node scripts/paper-trading.mjs                          # starts Vite on 5198
//   node scripts/paper-trading.mjs --url http://127.0.0.1:5173 --out artifacts/paper-trading
//
// Screenshots go to --out (default artifacts/paper-trading).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/paper-trading';
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
  // Offline: the seeded simulation, so prices move without a network.
  await page.goto(`${url}?offline&trading`);
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });

  const panel = page.getByRole('region', { name: 'Order panel' });
  check(await panel.isVisible(), 'the order panel shows');
  const status = () => panel.locator('.status').innerText();
  check((await status()) === 'Flat', 'starts flat', await status());

  await panel.getByLabel('Trading').check();
  const confirm = async () => {
    const ticket = page.getByRole('dialog', { name: 'Confirm order' });
    await ticket.waitFor();
    const text = (await ticket.innerText()).replace(/\n+/g, ' | ');
    await page.keyboard.press('Enter');
    // Closed, or replaced by the next ticket (Flatten all asks twice).
    await page.waitForFunction(previous => {
      const find = root =>
        root.querySelector('[role="dialog"]') ??
        [...root.querySelectorAll('*')].map(e => e.shadowRoot && find(e.shadowRoot)).find(Boolean);
      const dialog = find(document);
      return !dialog || dialog.innerText.replace(/\n+/g, ' | ') !== previous;
    }, text);
    return text;
  };

  await panel.getByRole('button', { name: 'Buy MKT' }).click();
  const buyTicket = await confirm();
  check(
    /BUY 1 .* MARKET/.test(buyTicket) && /Opens long 1/.test(buyTicket),
    'a market buy asks first',
    buyTicket,
  );
  await page.waitForFunction(() => true);
  await sleep(300);
  check(/^Long 1 @/.test(await status()), 'the buy opens a long position', await status());

  // Find the position line: hovering it shows the ns-resize cursor on the plot.
  const plotCursor = () =>
    page.evaluate(() => {
      const walk = root =>
        [...root.querySelectorAll('*')].some(
          e =>
            (e.getAttribute('role') === 'group' && e.style.cursor === 'ns-resize') ||
            (e.shadowRoot && walk(e.shadowRoot)),
        );
      return walk(document);
    });
  let lineY = null;
  for (let y = 120; y < 700 && lineY === null; y += 2) {
    await page.mouse.move(700, y);
    if (await plotCursor()) lineY = y;
  }
  check(lineY !== null, 'the position line can be grabbed');
  if (lineY !== null) {
    await page.mouse.move(700, lineY);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(700, lineY - i * 8);
    await page.screenshot({ path: `${out}/drag-tp.png` });
    await page.mouse.up();
    const tpTicket = await confirm();
    check(
      /^TP: SELL 1 .* LIMIT @/.test(tpTicket),
      'dragging the position line up places a TP limit',
      tpTicket,
    );
  }

  // Adding to the position resizes the single TP to the whole position.
  await panel.getByRole('button', { name: 'Buy MKT' }).click();
  await confirm();
  const resized = page.getByRole('status').filter({ hasText: /Resized order .* to 2/ });
  await resized.waitFor({ timeout: 5000 }).catch(() => {});
  check(await resized.isVisible(), 'adding to the position resizes the TP to 2');
  check(/^Long 2 @/.test(await status()), 'the position is long 2', await status());

  // Right-click below the market: a buy limit and a sell stop.
  await page.mouse.click(700, (lineY ?? 400) + 120, { button: 'right' });
  const menu = page.getByRole('menu');
  const menuText = (await menu.innerText()).replace(/\n+/g, ' | ');
  check(
    /Buy 1 limit @/.test(menuText) && /Sell 1 stop @/.test(menuText) && /Flatten 2/.test(menuText),
    'right-click offers orders at that price',
    menuText,
  );
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${out}/position.png` });

  await panel.getByRole('button', { name: 'Flatten all' }).click();
  const cancelTicket = await confirm();
  check(/Cancel all 1 working/.test(cancelTicket), 'Flatten all cancels the TP first', cancelTicket);
  const flattenTicket = await confirm();
  check(/Flatten: SELL 2 .* MARKET/.test(flattenTicket), 'then sells the position at market', flattenTicket);
  await sleep(300);
  check((await status()) === 'Flat', 'ends flat', await status());
  await page.screenshot({ path: `${out}/flat.png` });

  // Show fills hides the B and S badges and stays off after a reload.
  const fills = panel.getByLabel('Show fills');
  check(await fills.isChecked(), 'fills show by default');
  await fills.uncheck();
  await page.screenshot({ path: `${out}/fills-hidden.png` });
  await page.reload();
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  check(
    !(await page.getByRole('region', { name: 'Order panel' }).getByLabel('Show fills').isChecked()),
    'hiding fills is remembered',
  );
  await page.getByRole('region', { name: 'Order panel' }).getByLabel('Show fills').check();
} finally {
  await browser.close();
  server?.kill();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`\nScreenshots in ${out}`);
