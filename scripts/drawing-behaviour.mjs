#!/usr/bin/env node
// Drives drawing interactions through real pointer and keyboard input on the offline demo:
// rail families, Alt hotkeys, Shift angle snapping, Alt-drag cloning, double-click settings,
// remembered tool defaults and templates across reloads. Prints ok/FAIL per check and saves
// screenshots of the menus.
//
//   node scripts/drawing-behaviour.mjs                                 # starts Vite on 5196
//   node scripts/drawing-behaviour.mjs --url http://127.0.0.1:5173/ --out artifacts/drawing-behaviour
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/drawing-behaviour';
await mkdir(out, { recursive: true });
let url = arg('url'),
  server;
if (!url) {
  const port = 5196;
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
const check = (ok, message, detail) => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${message}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`,
  );
  if (!ok) problems.push(message);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => check(false, `page error: ${e.message}`));
  const templateKey = JSON.stringify(['demo', 'drawing-templates']);
  const load = async () => {
    await page.goto(`${url}?offline`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, {
      timeout: 15000,
    });
  };
  // Saved templates and defaults from an earlier run would change what new drawings look like.
  await load();
  await page.evaluate(key => localStorage.removeItem(key), templateKey);
  await load();
  // Template writes wait briefly to batch rapid edits, so reads wait a little longer.
  const stored = () =>
    sleep(450).then(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), templateKey));
  const host = page.locator('#app > *');
  const state = () => page.evaluate(() => window.candleframe.drawingState());
  const drawings = () => page.evaluate(() => window.candleframe.exportDocument().drawings);
  // The plot's right half stays clear of the demo's order ticket.
  const plot = await host.locator('.chart-host').first().boundingBox();
  const at = (fx, fy) => ({ x: plot.x + plot.width * fx, y: plot.y + plot.height * fy });
  const click = async p => page.mouse.click(p.x, p.y);
  const focusChart = () => click(at(0.62, 0.08)).then(() => page.keyboard.press('Escape'));

  await host.locator('.drawing-group-button').first().click();
  check((await state()).tool === 'trendline', 'a family button picks its first tool');
  await host.locator('.drawing-group-more').first().click();
  await sleep(150);
  const sections = await host.locator('.drawing-tool-section').allTextContents();
  check(sections.join() === 'Lines,Channels,Pitchforks', 'the Lines menu has section headings', sections);
  await host.locator('.drawing-flyout').screenshot({ path: `${out}/lines-menu.png` });
  await host.locator('.drawing-tool-item', { hasText: 'Ray' }).first().click();
  await host.locator('.drawing-group-button').first().click();
  check((await state()).tool === 'ray', 'the family button then reuses the last tool');

  await page.evaluate(() => window.candleframe.setTool('cursor'));
  await focusChart();
  await page.keyboard.press('Alt+KeyH');
  check((await state()).tool === 'horizontal-line', 'Alt+H picks the horizontal line');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  await page.evaluate(() => window.candleframe.setTool('trendline'));
  await click(at(0.55, 0.3));
  await page.keyboard.down('Shift');
  await click(at(0.8, 0.34));
  await page.keyboard.up('Shift');
  const [line] = await drawings();
  check(
    line?.points[0].price === line?.points[1].price,
    'Shift snaps a nearly flat line to horizontal',
    line?.points,
  );

  await page.evaluate(() => window.candleframe.setTool('cursor'));
  const body = at(0.67, 0.3);
  await page.mouse.move(body.x, body.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(body.x, body.y + 80, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const cloned = await drawings();
  check(cloned.length === 2, 'Alt-drag leaves the original and adds a copy', cloned.length);
  check(
    cloned[0]?.points[0].price === line?.points[0].price,
    'the original keeps its anchors after a clone drag',
  );

  await page.mouse.dblclick(body.x, body.y);
  await sleep(200);
  const settings = host.locator('.drawing-settings');
  check(await settings.isVisible(), 'double-click opens the drawing settings');
  await settings.screenshot({ path: `${out}/trendline-settings.png` });
  await settings.locator('label', { hasText: 'Extend right' }).locator('input').check();
  const extended = (await drawings()).find(d => d.id === cloned[0].id);
  check(
    extended?.options?.extendRight === true,
    'a settings checkbox updates the drawing',
    extended?.options,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.candleframe.setTool('trendline'));
  await click(at(0.6, 0.6));
  await click(at(0.75, 0.7));
  const next = (await drawings()).at(-1);
  check(
    next?.options?.extendRight === true,
    'the next trend line remembers the last settings',
    next?.options,
  );

  await page.mouse.move(at(0.67, 0.65).x, at(0.67, 0.65).y);
  await sleep(100);
  await page.screenshot({ path: `${out}/chart.png` });

  // Templates: save from a styled line, replace after confirming, reload, apply, reset, delete.
  const menu = host.locator('.drawing-template-menu');
  const menuItem = name => menu.locator('.drawing-tool-item', { hasText: name }).first();
  const drawLine = async (from, to) => {
    await page.evaluate(() => window.candleframe.setTool('trendline'));
    await click(at(...from));
    await click(at(...to));
    return (await drawings()).at(-1);
  };
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  const source = await drawLine([0.55, 0.3], [0.8, 0.4]);
  await page.evaluate(
    id =>
      window.candleframe.execute({
        type: 'drawing.update',
        id,
        patch: { style: { color: '#ff3366', width: 5, lineStyle: 'dashed' }, options: { extendLeft: true } },
      }),
    source.id,
  );
  await host.locator('.drawing-template-button').click();
  check(await menu.isVisible(), 'the strip Template button opens the template menu');
  await menuItem('Save as').click();
  await page.keyboard.type('Pink dashed');
  await page.keyboard.press('Enter');
  check(await menu.isHidden(), 'saving closes the menu');
  check(
    (await stored())?.templates?.trendline?.[0]?.name === 'Pink dashed',
    'Save as stores the template under the widget storage key',
    await stored(),
  );
  await host.locator('.drawing-template-button').click();
  await menuItem('Save as').click();
  await page.keyboard.type('pink DASHED');
  await page.keyboard.press('Enter');
  const replace = menu.locator('button', { hasText: 'Replace' });
  check(await replace.isVisible(), 'a duplicate name asks to replace inside the widget');
  await menu.screenshot({ path: `${out}/template-replace.png` });
  await replace.click();
  const replaced = (await stored())?.templates?.trendline ?? [];
  check(
    replaced.length === 1 && replaced[0].name === 'pink DASHED',
    'replacing keeps one template under the new spelling',
    replaced,
  );
  await host.locator('.drawing-template-button').click();
  await menu.screenshot({ path: `${out}/template-menu.png` });
  await page.screenshot({ path: `${out}/template-menu-chart.png` });
  await page.keyboard.press('Escape');
  check(await menu.isHidden(), 'Escape closes the template menu');

  await load();
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  const plain = await drawLine([0.55, 0.55], [0.8, 0.65]);
  check(plain?.style.color !== '#ff3366', 'a new line does not start with the template look', plain?.style);
  const before = await page.evaluate(() => window.candleframe.inspect().documentRevision);
  await host.locator('.drawing-template-button').click();
  await menuItem('pink DASHED').click();
  const applied = (await drawings()).find(d => d.id === plain.id);
  check(
    applied?.style.color === '#ff3366' &&
      applied.style.width === 5 &&
      applied.style.lineStyle === 'dashed' &&
      applied.options?.extendLeft === true,
    'after a reload, applying the template restyles the selected line',
    applied,
  );
  check(
    (await page.evaluate(() => window.candleframe.inspect().documentRevision)) === before + 1,
    'applying a template is one document edit',
  );
  await page.evaluate(() => window.candleframe.execute({ type: 'history.undo' }));
  check(
    (await drawings()).find(d => d.id === plain.id)?.style.color === plain.style.color,
    'one undo reverts the template',
  );
  await page.evaluate(id => window.candleframe.selectDrawing(id), plain.id);
  await host.locator('.drawing-template-button').click();
  await menuItem('Reset').click();
  const reset = (await drawings()).find(d => d.id === plain.id);
  check(
    reset?.style.color === '#a9c4ff' && reset.style.width === 2 && reset.options === undefined,
    'Reset gives the built-in style and clears settings',
    reset,
  );

  await page.mouse.dblclick(at(0.675, 0.6).x, at(0.675, 0.6).y);
  await sleep(150);
  await host.locator('.drawing-template-open').click();
  check(await menu.isVisible(), 'the settings panel Template button opens the same menu');
  await page.screenshot({ path: `${out}/template-menu-settings.png` });
  await menuItem('Save as default').click();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.candleframe.setTool('trendline'));
  await host.locator('.drawing-template-button').click();
  await menuItem('pink DASHED').click();
  check(
    (await state()).options.toolDefaults.trendline?.style?.color === '#ff3366',
    'with no selection, applying a template sets the tool defaults',
    (await state()).options.toolDefaults.trendline,
  );
  await page.evaluate(() => window.candleframe.setTool('cursor'));
  await load();
  check(
    (await state()).options.toolDefaults.trendline?.style?.color === '#ff3366',
    'tool defaults survive a reload',
    (await state()).options.toolDefaults.trendline,
  );
  const seeded = await drawLine([0.3, 0.2], [0.45, 0.25]);
  check(
    seeded?.style.color === '#ff3366' && seeded.options?.extendLeft === true,
    'the next line after a reload starts with the saved defaults',
    seeded,
  );
  await host.locator('.drawing-template-button').click();
  await menu.getByRole('button', { name: 'Delete template pink DASHED' }).click();
  check(
    (await menu.locator('.drawing-template-row').count()) === 0,
    'Delete removes the template from the menu',
  );
  await page.keyboard.press('Escape');
  await load();
  check(
    !(await stored())?.templates?.trendline,
    'the deleted template stays gone after a reload',
    await stored(),
  );

  // Drawing popups open above the demo's order panel, which the trading layer stacks over the widget.
  const covering = async selector =>
    page.evaluate(selector => {
      const [mount, shell] = document.querySelectorAll('#app > div');
      const popup = mount.shadowRoot.querySelector(selector),
        panel = shell?.shadowRoot?.querySelector('.panel');
      if (!popup || !panel) return 'missing';
      const a = popup.getBoundingClientRect(),
        b = panel.getBoundingClientRect();
      const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2,
        y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
      if (x < Math.max(a.left, b.left) || y < Math.max(a.top, b.top)) return 'no overlap';
      return (
        document.elementFromPoint(x, y) === mount &&
        !!mount.shadowRoot.elementFromPoint(x, y)?.closest(selector)
      );
    }, selector);
  await page.evaluate(() => window.candleframe.setTool('cursor'));
  await host.locator('.drawing-group-more').first().click();
  await sleep(150);
  check(
    (await covering('.drawing-flyout')) === true,
    'the tool menu opens above the order panel',
    await covering('.drawing-flyout'),
  );
  await page.screenshot({ path: `${out}/menu-over-order-panel.png` });
  await page.keyboard.press('Escape');

  // The Fibonacci levels table edits each level's value, colour and visibility.
  await page.evaluate(() => {
    const chart = window.candleframe,
      { latestCandle: last, feed } = chart.inspect();
    chart.execute({ type: 'drawing.clear' });
    chart.execute({
      type: 'drawing.add',
      drawing: {
        id: 'fib',
        type: 'fib-retracement',
        points: [
          { timeMs: last.timeMs - 60 * feed.intervalMs, price: last.close * 0.995 },
          { timeMs: last.timeMs - 20 * feed.intervalMs, price: last.close * 1.005 },
        ],
      },
    });
    chart.selectDrawing('fib');
  });
  const fib = async () => (await drawings()).find(d => d.id === 'fib');
  await host.locator('.drawing-settings-button').click();
  const table = settings.locator('.drawing-level-table');
  check(
    (await table.locator('.drawing-level-row').count()) === 7,
    'the levels table lists the retracement levels',
  );
  await settings.getByRole('checkbox', { name: 'Show level 4' }).uncheck();
  check(
    (await fib())?.levelStyles?.[3]?.visible === false,
    'unticking a level hides it',
    (await fib())?.levelStyles,
  );
  await settings
    .getByRole('textbox', { name: 'Level 2 colour' })
    .or(settings.locator('[aria-label="Level 2 colour"]'))
    .first()
    .evaluate(input => {
      input.value = '#123456';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  check(
    (await fib())?.levelStyles?.[1]?.color === '#123456',
    'a level colour sticks to its row',
    (await fib())?.levelStyles,
  );
  const value = settings.getByRole('spinbutton', { name: 'Level 7 value' });
  await value.fill('1.272');
  await value.press('Enter');
  check((await fib())?.levels?.[6] === 1.272, 'editing a value changes that level', (await fib())?.levels);
  await settings.locator('.drawing-level-add').click();
  check((await fib())?.levels?.length === 8, 'Add level appends a row', (await fib())?.levels);
  check((await table.locator('.drawing-level-row').count()) === 8, 'the table shows the new row');
  await settings.screenshot({ path: `${out}/fib-levels.png` });
  await settings.getByRole('button', { name: 'Reset levels' }).click();
  const restored = await fib();
  check(
    restored?.levels.length === 0 && !restored.levelStyles,
    'Reset levels restores the built-in levels',
    restored,
  );
  await page.keyboard.press('Escape');

  // Rename keeps the template's look under a new name.
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  await drawLine([0.55, 0.3], [0.8, 0.4]);
  await host.locator('.drawing-template-button').click();
  await menuItem('Save as').click();
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await host.locator('.drawing-template-button').click();
  await menu.getByRole('button', { name: 'Rename template Alpha' }).click();
  await page.keyboard.type('Beta');
  await menu.screenshot({ path: `${out}/template-rename.png` });
  await page.keyboard.press('Enter');
  check(
    (await menu.locator('.drawing-template-row .drawing-tool-item').allTextContents()).join() === 'Beta',
    'Rename replaces the name in the menu',
  );
  check(
    (await stored())?.templates?.trendline?.map(t => t.name).join() === 'Beta',
    'the renamed template is stored once the edits settle',
    await stored(),
  );

  // Light theme: the strip, template menu and settings form, for a visual check.
  await page.evaluate(() => window.candleframe.setTheme('paper'));
  await sleep(200);
  await page.screenshot({ path: `${out}/light-template-menu.png` });
  await page.keyboard.press('Escape');
  await host.locator('.drawing-settings-button').click();
  await page.screenshot({ path: `${out}/light-settings.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const chart = window.candleframe,
      { latestCandle: last, feed } = chart.inspect();
    chart.execute({
      type: 'drawing.add',
      drawing: {
        id: 'fib',
        type: 'fib-retracement',
        points: [
          { timeMs: last.timeMs - 60 * feed.intervalMs, price: last.close * 0.995 },
          { timeMs: last.timeMs - 20 * feed.intervalMs, price: last.close * 1.005 },
        ],
      },
    });
    chart.selectDrawing('fib');
  });
  await host.locator('.drawing-settings-button').click();
  await page.screenshot({ path: `${out}/light-fib-settings.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.candleframe.setTheme('evergreen'));
  await page.evaluate(key => localStorage.removeItem(key), templateKey);
} finally {
  await browser.close();
  server?.kill();
}
console.log(problems.length ? `${problems.length} problem(s)` : 'All checks passed');
process.exitCode = problems.length ? 1 : 0;
