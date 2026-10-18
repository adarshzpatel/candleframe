#!/usr/bin/env node
// Drives drawing interactions through real pointer and keyboard input on the offline demo:
// rail families, Alt hotkeys, Shift angle snapping, Alt-drag cloning, double-click settings,
// remembered tool defaults and templates across reloads, favourites and interval visibility. Prints ok/FAIL per check and saves
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
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), templateKey);
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
  await page.evaluate(key => localStorage.removeItem(key), templateKey);

  // Favourites: stars in the family menus, the floating toolbar, dragging, the rail toggle
  // and persistence across reloads.
  const favouriteKey = JSON.stringify(['demo', 'drawing-favourites']);
  const favouritesStored = () =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), favouriteKey);
  await page.evaluate(key => localStorage.removeItem(key), favouriteKey);
  await load();
  const favouriteBar = host.locator('.drawing-favourites');
  const favouriteToggle = host.locator('.drawing-favourites-toggle');
  check(
    (await favouriteBar.isHidden()) && (await favouriteToggle.isDisabled()),
    'without favourites the toolbar is hidden and its toggle disabled',
  );
  await host.locator('.drawing-group-more').first().click();
  const trendRow = host.locator('.drawing-tool-row', { hasText: 'Trend line' }).first();
  await trendRow.hover();
  await trendRow.locator('.drawing-tool-star').click();
  check(
    (await trendRow.locator('.drawing-tool-star').getAttribute('aria-checked')) === 'true',
    'the star marks a tool as a favourite',
  );
  check(await host.locator('.drawing-flyout').isVisible(), 'starring keeps the menu open');
  await host.locator('.drawing-flyout').screenshot({ path: `${out}/favourite-stars.png` });
  // Keyboard: ArrowRight moves from a tool to its star; Enter toggles it.
  await host.locator('.drawing-tool-item', { hasText: 'Horizontal line' }).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  check(
    JSON.stringify((await favouritesStored())?.tools) === '["trendline","horizontal-line"]',
    'favourites are stored under the widget storage key',
    await favouritesStored(),
  );
  check(
    (await favouriteBar.locator('.drawing-favourite').count()) === 2,
    'the toolbar lists both favourites',
  );
  await favouriteBar.getByRole('button', { name: 'Horizontal line' }).click();
  check((await state()).tool === 'horizontal-line', 'clicking a favourite picks its tool');
  check(
    (await favouriteBar.getByRole('button', { name: 'Horizontal line' }).getAttribute('aria-pressed')) ===
      'true',
    'the active tool is highlighted in the toolbar',
  );
  await page.evaluate(() => window.candleframe.setTool('cursor'));
  await page.screenshot({ path: `${out}/favourites-toolbar.png` });
  const grip = favouriteBar.locator('.drawing-favourites-grip');
  const barBefore = await favouriteBar.boundingBox();
  const gripBox = await grip.boundingBox();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x - 200, gripBox.y + 160, { steps: 6 });
  await page.mouse.up();
  const barAfter = await favouriteBar.boundingBox();
  check(
    Math.abs(barAfter.x - (barBefore.x - 200 - gripBox.width / 2)) <= 2 &&
      Math.abs(barAfter.y - (barBefore.y + 160 - gripBox.height / 2)) <= 2,
    'dragging the grip moves the toolbar',
    { barBefore, barAfter },
  );
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  check(
    Math.round((await favouriteBar.boundingBox()).x - barAfter.x) === 10,
    'arrow keys on the grip move the toolbar',
  );
  const barPosition = (await favouritesStored())?.position;
  await favouriteToggle.click();
  check(
    (await favouriteBar.isHidden()) && (await favouriteToggle.getAttribute('aria-pressed')) === 'false',
    'the rail toggle hides the toolbar',
  );
  await load();
  check(await favouriteBar.isHidden(), 'the hidden toolbar stays hidden after a reload');
  await favouriteToggle.click();
  const reloaded = await favouriteBar.boundingBox();
  check(
    (await favouriteBar.locator('.drawing-favourite').count()) === 2 &&
      Math.abs(reloaded.x - barAfter.x - 10) <= 1 &&
      barPosition?.x !== undefined,
    'favourites and the toolbar position survive a reload',
    { reloaded, barAfter, barPosition },
  );
  await page.evaluate(key => localStorage.removeItem(key), favouriteKey);
  await load();

  // Visibility: a drawing limited to one-minute charts stays listed with a hint on 5m, and
  // the settings panel's Visibility section brings it back.
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  const feedInfo = await page.evaluate(() => window.candleframe.inspect().feed);
  check(feedInfo.interval === '1m', 'the demo starts on one-minute candles', feedInfo.interval);
  const limited = await drawLine([0.55, 0.45], [0.75, 0.55]);
  await page.evaluate(
    id =>
      window.candleframe.execute({
        type: 'drawing.update',
        id,
        patch: { visibility: { minutes: { enabled: true, from: 1, to: 1 } } },
      }),
    limited.id,
  );
  // An interval with its own saved document would replace the carried-over drawings.
  await page.evaluate(
    key => localStorage.removeItem(key),
    JSON.stringify(['demo', feedInfo.id, feedInfo.instrument.symbol, '5m']),
  );
  await host.locator('#interval').evaluate(picker => {
    picker.value = '5m';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.candleframe.inspect().feed.interval === '5m');
  await page.waitForFunction(() => window.candleframe.inspect().candleCount > 50);
  await sleep(300);
  const carried = (await drawings()).find(d => d.id === limited.id);
  check(!!carried, 'the limited drawing carries over to 5m', await drawings());
  await host.locator('.drawing-objects-button').click();
  const hiddenHint = host.locator('.drawing-object-row.off-interval .drawing-object-hint');
  check((await hiddenHint.textContent()) === 'Hidden on 5m', 'Objects lists the hidden drawing with a hint');
  await host.locator('.drawing-object-panel').screenshot({ path: `${out}/objects-hidden-hint.png` });
  const p0 = at(0.65, 0.5);
  await click(p0);
  check((await state()).selected === null, 'a drawing hidden on the interval cannot be clicked');
  await host.locator('.drawing-object-row.off-interval .drawing-object-name').click();
  await host.locator('.drawing-settings-button').click();
  const visibilitySection = host.locator('.drawing-visibility');
  check(await visibilitySection.isVisible(), 'the settings panel has a Visibility section');
  check(
    (await visibilitySection.locator('.drawing-visibility-note').textContent()) === 'Hidden on 5m',
    'the Visibility section says the drawing is hidden here',
  );
  await host.locator('.drawing-settings').screenshot({ path: `${out}/visibility-settings.png` });
  const minutesTo = visibilitySection.getByLabel('Minutes to');
  await minutesTo.fill('15');
  await minutesTo.press('Enter');
  await sleep(150);
  check(
    JSON.stringify((await drawings()).find(d => d.id === limited.id)?.visibility) ===
      '{"minutes":{"enabled":true,"from":1,"to":15}}',
    'editing the range updates the drawing',
    (await drawings()).find(d => d.id === limited.id),
  );
  check((await hiddenHint.count()) === 0, 'the drawing is shown again on 5m');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
} finally {
  await browser.close();
  server?.kill();
}
console.log(problems.length ? `${problems.length} problem(s)` : 'All checks passed');
process.exitCode = problems.length ? 1 : 0;
