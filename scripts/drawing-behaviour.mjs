#!/usr/bin/env node
// Drives drawing interactions through real pointer and keyboard input on the offline demo:
// rail families, Alt hotkeys, Shift angle snapping, Alt-drag cloning, double-click settings,
// remembered tool defaults and templates across reloads, favourites, interval visibility,
// multi-selection and groups. Prints ok/FAIL per check and saves screenshots of the menus.
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

  {
    // Forecasting: a bars pattern copy moves without changing the bars it copied.
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
    await page.evaluate(() => window.candleframe.setTool('bars-pattern'));
    await click(at(0.6, 0.5));
    await click(at(0.72, 0.3));
    const pattern = (await drawings()).at(-1);
    check(
      pattern?.type === 'bars-pattern' && typeof pattern.options?.sourceFrom === 'number',
      'a bars pattern remembers the bars it copied',
      pattern,
    );
    const cursorAt = async p => {
      await page.mouse.move(p.x, p.y);
      return host
        .locator('.chart-host')
        .first()
        .evaluate(el => [el, ...el.querySelectorAll('*')].map(e => e.style.cursor).find(c => c) ?? '');
    };
    // The copy sits over the bars it copied; scan down the middle for a stroke to grab.
    let grab;
    for (let fy = 0.05; fy < 0.95 && !grab; fy += 0.005)
      if ((await cursorAt(at(0.66, fy))) === 'move') grab = at(0.66, fy);
    check(!!grab, 'the bars pattern copy can be grabbed');
    if (grab) {
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x + 60, grab.y - 80, { steps: 6 });
      await page.mouse.up();
      const moved = (await drawings()).at(-1);
      check(
        moved.points[0].timeMs > pattern.points[0].timeMs &&
          JSON.stringify(moved.options) === JSON.stringify(pattern.options),
        'dragging the copy moves it and keeps its source bars',
        moved,
      );
      // The end handle sits level with the start, 60px right and 80px up after the drag.
      const end = { x: at(0.72, 0).x + 60, y: at(0, 0.5).y - 80 };
      await page.mouse.move(end.x, end.y);
      await page.mouse.down();
      await page.mouse.move(end.x + 40, end.y + 50, { steps: 4 });
      await page.mouse.up();
      const stretched = (await drawings()).at(-1);
      check(
        stretched.points[1].timeMs > moved.points[1].timeMs &&
          stretched.points[1].price === moved.points[1].price &&
          stretched.points[0].timeMs === moved.points[0].timeMs,
        'the end handle stretches the copy in time only',
        stretched,
      );
      await page.screenshot({ path: `${out}/bars-pattern-moved.png` });
    }
    await page.evaluate(() => window.candleframe.setTool('anchored-vwap'));
    const vwapClick = at(0.62, 0.15);
    await click(vwapClick);
    const vwap = (await drawings()).at(-1),
      clicked = await page.evaluate(p => window.candleframe.priceAt(p.x, p.y), vwapClick),
      interval = await page.evaluate(() => window.candleframe.inspect().feed.intervalMs);
    check(
      vwap?.type === 'anchored-vwap' &&
        vwap.points[0].timeMs % interval === 0 &&
        Math.abs(vwap.points[0].price - clicked.price) > 1,
      'anchored VWAP snaps its anchor onto the bar under the click',
      { vwap, clicked },
    );
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
    await page.evaluate(key => localStorage.removeItem(key), templateKey);
  }
  // The fixed Gann square keeps its price-per-time ratio when a corner is dragged.
  await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  await page.evaluate(() => window.candleframe.setTool('gann-square-fixed'));
  await click(at(0.5, 0.7));
  await click(at(0.62, 0.45));
  const square = (await drawings()).find(d => d.type === 'gann-square-fixed');
  const ratio = d =>
    Math.abs(d.points[1].price - d.points[0].price) / Math.abs(d.points[1].timeMs - d.points[0].timeMs);
  await page.evaluate(id => window.candleframe.selectDrawing(id), square?.id);
  await page.mouse.move(at(0.62, 0.45).x, at(0.62, 0.45).y);
  await page.mouse.down();
  await page.mouse.move(at(0.72, 0.3).x, at(0.72, 0.3).y, { steps: 8 });
  await page.mouse.up();
  const resized = (await drawings()).find(d => d.type === 'gann-square-fixed');
  check(
    !!square &&
      !!resized &&
      resized.points[1].timeMs > square.points[1].timeMs &&
      Math.abs(ratio(resized) / ratio(square) - 1) < 0.01,
    'dragging a fixed Gann square corner keeps its ratio',
    { square: square?.points, resized: resized?.points },
  );
  await page.screenshot({ path: `${out}/gann-square-fixed.png` });
  {
    // Channel and cycle handles: place with real clicks, then drag the tool's own handles.
    const chartHost = host.locator('.chart-host').first();
    const cursorAt = async p => {
      await page.mouse.move(p.x, p.y);
      return chartHost.evaluate(el =>
        [el, ...el.querySelectorAll('*')].map(e => e.style.cursor).find(Boolean),
      );
    };
    const place = async (type, clicks) => {
      await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
      await page.evaluate(t => window.candleframe.setTool(t), type);
      for (const p of clicks) await click(p);
      return (await drawings()).at(-1);
    };
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
      return (await drawings()).at(-1);
    };
    const same = (a, b) => a.timeMs === b.timeMs && a.price === b.price;

    const end = at(0.8, 0.4);
    const regression = await place('regression-trend', [at(0.55, 0.4), end]);
    check(regression?.points.length === 2, 'two clicks place a regression trend', regression);
    // The handle sits on the fitted base line at the last bar in range, so find it by its cursor.
    let grip;
    for (let y = plot.y + 4; y < plot.y + plot.height * 0.75 && !grip; y += 3)
      if ((await cursorAt({ x: end.x - 3, y })) === 'ew-resize') grip = { x: end.x - 3, y };
    check(!!grip, 'the regression handle sits on its base line');
    if (grip) {
      const moved = await drag(grip, { x: grip.x - 60, y: grip.y + 40 });
      check(
        moved.points[1].timeMs < regression.points[1].timeMs &&
          moved.points[1].price === regression.points[1].price &&
          same(moved.points[0], regression.points[0]),
        'dragging a regression handle moves its anchor in time only',
        moved.points,
      );
    }

    const [f1, f2, f3] = [at(0.55, 0.6), at(0.8, 0.45), at(0.7, 0.3)];
    const flat = await place('flat-top-bottom', [f1, f2, f3]);
    check(flat?.points.length === 3, 'three clicks place a flat top/bottom', flat);
    const flatEnd = { x: f2.x, y: f3.y };
    check((await cursorAt(flatEnd)) === 'ns-resize', 'the flat line has a vertical handle at each end');
    const lowered = await drag(flatEnd, { x: flatEnd.x + 30, y: flatEnd.y + 40 });
    check(
      lowered.points[2].price < flat.points[2].price &&
        lowered.points[2].timeMs === flat.points[2].timeMs &&
        same(lowered.points[0], flat.points[0]) &&
        same(lowered.points[1], flat.points[1]),
      'dragging the flat line moves only its price',
      lowered.points,
    );

    const disjoint = await place('disjoint-channel', [f1, f2, at(0.55, 0.3)]);
    const mirrorStart = { x: f1.x, y: at(0.55, 0.3).y };
    check((await cursorAt(mirrorStart)) === 'ns-resize', 'the mirrored line has a handle at its start');
    const shifted = await drag(mirrorStart, { x: mirrorStart.x + 20, y: mirrorStart.y - 30 });
    check(
      shifted.points[2].price > disjoint.points[2].price &&
        shifted.points[2].timeMs === disjoint.points[0].timeMs,
      'dragging the mirrored line shifts it and pins it to the first anchor time',
      shifted.points,
    );

    const [c1, c2] = [at(0.55, 0.7), at(0.62, 0.5)];
    const cycles = await place('time-cycles', [c1, c2]);
    const cycleEnd = { x: c2.x, y: c1.y };
    check((await cursorAt(cycleEnd)) === 'ew-resize', 'the time cycle end handle sits on the baseline');
    const widened = await drag(cycleEnd, { x: cycleEnd.x + 30, y: cycleEnd.y - 50 });
    check(
      widened.points[1].timeMs > cycles.points[1].timeMs && same(widened.points[0], cycles.points[0]),
      'dragging the time cycle end widens the cycle',
      widened.points,
    );
    await page.screenshot({ path: `${out}/time-cycles.png` });
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
  }
  {
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
    check(
      (await hiddenHint.textContent()) === 'Hidden on 5m',
      'Objects lists the hidden drawing with a hint',
    );
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
  }
  {
    // Multi-selection and groups.
    await page.evaluate(key => localStorage.removeItem(key), templateKey);
    await load();
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    const revision = () => page.evaluate(() => window.candleframe.inspect().documentRevision);
    const selectedIds = async () => (await state()).selection.map(d => d.id);
    const lines = [];
    for (const fy of [0.3, 0.45, 0.6]) lines.push(await drawLine([0.3, fy], [0.6, fy]));
    const mid = fy => at(0.45, fy);
    await click(mid(0.3));
    await page.keyboard.down(mod);
    await click(mid(0.45));
    await page.keyboard.up(mod);
    check(
      JSON.stringify(await selectedIds()) === JSON.stringify([lines[0].id, lines[1].id]),
      `${mod}+click adds a drawing to the selection`,
      await selectedIds(),
    );
    await page.keyboard.down('Shift');
    await click(mid(0.6));
    await click(mid(0.3));
    await page.keyboard.up('Shift');
    check(
      (await selectedIds()).join() === [lines[1].id, lines[2].id].join(),
      'Shift+click adds and removes drawings',
      await selectedIds(),
    );
    check(
      (await host.locator('.drawing-active-tool').textContent()) === '2 drawings',
      'the drawing strip names the selection size',
    );
    let edits = await revision();
    await page.mouse.move(mid(0.45).x, mid(0.45).y);
    await page.mouse.down();
    await page.mouse.move(mid(0.45).x + 30, mid(0.45).y + 20, { steps: 4 });
    await page.mouse.move(mid(0.45).x + 60, mid(0.45).y + 40, { steps: 4 });
    await page.mouse.up();
    let now = await drawings();
    check(
      (await revision()) === edits + 1 &&
        now[0].points[0].timeMs === lines[0].points[0].timeMs &&
        now[1].points[0].timeMs !== lines[1].points[0].timeMs &&
        now[2].points[0].timeMs !== lines[2].points[0].timeMs,
      'dragging one selected drawing moves the whole selection in one edit',
    );
    await page.screenshot({ path: `${out}/multi-selection.png` });
    await page.evaluate(() => window.candleframe.execute({ type: 'history.undo' }));
    check(
      (await drawings()).every((d, i) => d.points[0].timeMs === lines[i].points[0].timeMs),
      'one undo moves the selection back',
    );
    edits = await revision();
    await host.locator('.drawing-strip input[type=color]').evaluate(input => {
      input.value = '#33cc99';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    now = await drawings();
    check(
      (await revision()) === edits + 1 &&
        now[0].style.color !== '#33cc99' &&
        now[1].style.color === '#33cc99' &&
        now[2].style.color === '#33cc99',
      'the strip colour applies to every selected drawing in one edit',
    );
    await page.keyboard.press(`${mod}+c`);
    await page.keyboard.press(`${mod}+v`);
    check((await drawings()).length === 5 && (await selectedIds()).length === 2, 'paste adds the copied set');
    edits = await revision();
    await page.keyboard.press('Delete');
    check(
      (await drawings()).length === 3 && (await revision()) === edits + 1,
      'Delete removes the whole selection in one edit',
    );
    await page.keyboard.press('Escape');
    check((await selectedIds()).length === 0, 'Escape clears the selection');
    // A modifier drag on empty plot draws a selection box.
    const from = at(0.25, 0.4),
      to = at(0.35, 0.65);
    await page.keyboard.down(mod);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.screenshot({ path: `${out}/selection-box.png` });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up(mod);
    check(
      (await selectedIds()).join() === [lines[1].id, lines[2].id].join(),
      'a modifier drag on empty plot selects the drawings in the box',
      await selectedIds(),
    );

    await host.locator('.drawing-objects-button').click();
    const objects = host.locator('.drawing-object-panel');
    await objects.locator('#drawing-group').click();
    const groupRow = objects.locator('.drawing-group-row');
    check((await groupRow.count()) === 1, 'Group selection adds a group row');
    check((await objects.locator('.drawing-object-row.member').count()) === 2, 'the group lists its members');
    await groupRow.locator('.drawing-object-name').dblclick();
    await objects.locator('.drawing-group-rename').fill('Support zone');
    await page.keyboard.press('Enter');
    const groups = () => page.evaluate(() => window.candleframe.exportDocument().drawingGroups ?? []);
    check((await groups())[0]?.name === 'Support zone', 'double-clicking a group renames it', await groups());
    await objects.screenshot({ path: `${out}/objects-group.png` });
    await page.keyboard.press('Escape');
    await click(mid(0.3));
    await click(mid(0.6));
    check((await selectedIds()).length === 2, 'clicking a grouped drawing selects its group');
    await groupRow.getByRole('button', { name: /^Hide group/ }).click();
    check((await drawings()).filter(d => !d.visible).length === 2, 'hiding a group hides its members');
    await groupRow.getByRole('button', { name: /^Show group/ }).click();
    await groupRow.locator('.drawing-group-fold').click();
    check(
      (await objects.locator('.drawing-object-row.member').count()) === 0,
      'collapsing a group hides its member rows',
    );
    await objects.screenshot({ path: `${out}/objects-group-collapsed.png` });
    await groupRow.locator('.drawing-group-fold').click();
    // Drag the ungrouped line onto a member row to put it in the group.
    const loose = objects.locator(`.drawing-object-row[data-id="${lines[0].id}"]`);
    const target = objects.locator(`.drawing-object-row[data-id="${lines[1].id}"]`);
    await loose.dragTo(target, { targetPosition: { x: 40, y: 4 } });
    check(
      (await groups())[0]?.drawings.length === 3,
      'dragging a row beside a member moves it into the group',
      await groups(),
    );
    await page.evaluate(() => window.candleframe.execute({ type: 'history.undo' }));
    await groupRow.getByRole('button', { name: /^Ungroup/ }).click();
    check((await groups()).length === 0 && (await drawings()).length === 3, 'Ungroup keeps the drawings');
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
    await page.evaluate(key => localStorage.removeItem(key), templateKey);
  }
  {
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
  }
  {
    // Anchored text keeps its place on screen while the chart pans underneath it. Earlier blocks
    // leave drawings behind, and the pan drag must start on empty plot.
    await page.evaluate(() => window.candleframe.execute({ type: 'drawing.clear' }));
    await page.evaluate(() => window.candleframe.setTool('anchored-text'));
    const pinnedAt = at(0.3, 0.3);
    await click(pinnedAt);
    await sleep(150);
    await page.keyboard.press('Escape');
    const pinned = (await drawings()).at(-1);
    check(
      pinned?.type === 'anchored-text' && typeof pinned.options?.plotX === 'number',
      'anchored text stores its plot position on placement',
      pinned,
    );
    const panFrom = await page.evaluate(() => window.candleframe.exportDocument().viewport.fromMs);
    await page.mouse.move(at(0.55, 0.72).x, at(0.55, 0.72).y);
    await page.mouse.down();
    await page.mouse.move(at(0.35, 0.72).x, at(0.35, 0.72).y, { steps: 8 });
    await page.mouse.up();
    await sleep(300);
    const panTo = await page.evaluate(() => window.candleframe.exportDocument().viewport.fromMs);
    check(panTo !== panFrom, 'dragging the plot pans the chart', { panFrom, panTo });
    await page.evaluate(() => window.candleframe.selectDrawing(null));
    await click({ x: pinnedAt.x + 12, y: pinnedAt.y - 4 });
    check(
      (await state()).selected?.id === pinned?.id,
      'after a pan, anchored text is still where it was placed',
      (await state()).selected?.type,
    );
    await page.keyboard.press('Escape');

    // A path finishes on double-click and keeps its arrow end.
    await page.evaluate(() => window.candleframe.setTool('path'));
    for (const [fx, fy] of [
      [0.25, 0.5],
      [0.32, 0.4],
    ])
      await click(at(fx, fy));
    await page.mouse.dblclick(at(0.4, 0.55).x, at(0.4, 0.55).y);
    await sleep(150);
    const drawnPath = (await drawings()).at(-1);
    check(
      drawnPath?.type === 'path' && drawnPath.points.length === 3 && (await state()).tool === 'cursor',
      'a double-click finishes a path',
      drawnPath?.points.length,
    );
    // Finishing a path opens its settings, like a double-click on any drawing.
    await page.keyboard.press('Escape');

    // A note's text shows only while the pointer rests on its marker.
    await page.evaluate(() => window.candleframe.setTool('note'));
    const noteAt = at(0.5, 0.45);
    await click(noteAt);
    await sleep(150);
    await page.keyboard.press('Escape');
    check((await drawings()).at(-1)?.type === 'note', 'a click places a note');
    await page.evaluate(() => window.candleframe.selectDrawing(null));
    // Both shots keep the crosshair's vertical line at the same x, so only the tooltip differs.
    await page.mouse.move(noteAt.x, noteAt.y + 40);
    await sleep(150);
    const bubble = { x: noteAt.x - 60, y: noteAt.y - 70, width: 120, height: 45 };
    const idle = await page.screenshot({ clip: bubble });
    await page.mouse.move(noteAt.x, noteAt.y - 14);
    await sleep(200);
    const hovered = await page.screenshot({ clip: bubble });
    await page.screenshot({ path: `${out}/note-hover.png` });
    check(!idle.equals(hovered), 'hovering a note shows its text');
    await page.evaluate(key => localStorage.removeItem(key), templateKey);
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(problems.length ? `${problems.length} problem(s)` : 'All checks passed');
process.exitCode = problems.length ? 1 : 0;
