#!/usr/bin/env node
// Checks the demo widget's chart grid: presets, the active chart, each sync option,
// named layouts across reloads, shared drawings and the narrow single-chart view.
//
//   node scripts/multi-chart.mjs                          # starts Vite on 5197
//   node scripts/multi-chart.mjs --url http://127.0.0.1:5173 --out artifacts/multi-chart
//
// Screenshots go to --out (default artifacts/multi-chart).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/multi-chart';
let url = arg('url'),
  server;
if (!url) {
  const port = 5197;
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
  const shadow = 'document.querySelector("#app > *").shadowRoot';
  const ready = () =>
    page.waitForFunction(
      () => window.candleframe?.charts().every(chart => chart.inspect().candleCount > 100),
      null,
      { timeout: 15000 },
    );
  const charts = () =>
    page.evaluate(() =>
      window.candleframe.charts().map(chart => {
        const state = chart.inspect();
        return { symbol: state.symbol, interval: state.document.interval, viewport: state.document.viewport };
      }),
    );
  const inRoot = (fn, value) =>
    page.evaluate(new Function('value', `const root = ${shadow}; return (${fn})(root, value);`), value);
  const cellBox = index =>
    inRoot((root, i) => {
      const r = root.querySelectorAll('.chart-cell')[i].getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, index);

  await page.goto(new URL('?offline', url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await ready();

  // Presets through the API.
  await page.evaluate(() => window.candleframe.setLayout({ preset: '2x2' }));
  await ready();
  check((await charts()).length === 4, '2x2 shows four charts');
  check(
    (await inRoot(root => root.querySelectorAll('.chart-cell canvas').length)) === 12,
    'each chart has its own canvases',
  );
  const boxes = await Promise.all([0, 1, 2, 3].map(cellBox));
  check(
    boxes[0].y === boxes[1].y && boxes[0].x === boxes[2].x && boxes[2].y > boxes[0].y,
    'cells form a two by two grid',
    boxes,
  );

  // Clicking a chart makes it the active one.
  const b1 = await cellBox(1);
  await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
  check(
    (await page.evaluate(() => window.candleframe.getActiveChart())) === 1,
    'a click activates that chart',
  );
  check(
    await inRoot(root => root.querySelectorAll('.chart-cell')[1].classList.contains('active')),
    'the active chart is outlined',
  );
  await page.keyboard.press('Alt+Digit3');
  check(
    (await page.evaluate(() => window.candleframe.getActiveChart())) === 2,
    'Alt + 3 activates the third chart',
  );

  // Interval change stays in the active chart while interval sync is off.
  await inRoot(root => {
    const select = root.querySelector('#interval');
    select.value = '5m';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await ready();
  let state = await charts();
  check(
    state[2].interval === '5m' && state[0].interval === '1m',
    'an interval change applies to the active chart only',
    state.map(c => c.interval),
  );

  // Time sync (on by default): panning one chart aligns the others' right edge.
  await page.evaluate(() => {
    const chart = window.candleframe.charts()[0];
    const { viewport } = chart.inspect().document;
    const span = viewport.toMs - viewport.fromMs;
    chart.execute({ type: 'viewport.set', fromMs: viewport.fromMs - span, toMs: viewport.toMs - span });
  });
  state = await charts();
  check(
    state.every(c => c.viewport.toMs === state[0].viewport.toMs && !c.viewport.following),
    'time sync aligns every chart to the panned one',
    state.map(c => c.viewport),
  );
  check(
    Math.abs(
      state[2].viewport.toMs - state[2].viewport.fromMs - (state[0].viewport.toMs - state[0].viewport.fromMs),
    ) > 1,
    'each chart keeps its own zoom under time sync',
  );
  check(
    !(await page.evaluate(() => window.candleframe.charts()[1].inspect().history.canUndo)),
    'synced navigation adds no undo step',
  );

  // Crosshair sync: hovering chart 1 shows the time in chart 2's summary.
  const b0 = await cellBox(0);
  await page.mouse.move(b0.x + b0.width * 0.5, b0.y + b0.height * 0.45);
  await sleep(150);
  const hover = await inRoot(root =>
    [...root.querySelectorAll('.chart-cell .hover-time')].map(e => e.textContent),
  );
  check(
    hover[1] !== 'Latest candle' && hover[1] === hover[0],
    'crosshair sync shows the hovered bar in other charts',
    hover,
  );
  await page.screenshot({ path: `${out}/grid-2x2-crosshair.png` });

  // Layout menu: sync checkboxes and presets.
  await inRoot(root => root.querySelector('#layout').click());
  check(await inRoot(root => !root.querySelector('.widget-dialog').hidden), 'the layout menu opens');
  const labels = await inRoot(root =>
    [...root.querySelectorAll('.layout-sync label')].map(l => l.textContent),
  );
  check(
    JSON.stringify(labels) === JSON.stringify(['Symbol', 'Interval', 'Crosshair', 'Time', 'Date range']),
    'sync options are the five checkboxes',
    labels,
  );
  const defaults = await inRoot(root => [...root.querySelectorAll('.layout-sync input')].map(i => i.checked));
  check(
    JSON.stringify(defaults) === JSON.stringify([false, false, true, true, false]),
    'crosshair and time sync are on by default',
    defaults,
  );
  await page.screenshot({ path: `${out}/layout-menu.png` });
  await inRoot(root => root.querySelector('[data-sync=symbol]').click());
  await inRoot(root => root.querySelector('.layout-dialog .icon-button[aria-label="Close dialog"]').click());
  await inRoot(root => {
    const select = root.querySelector('#symbol');
    select.value = 'ETH/USD';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await ready();
  state = await charts();
  check(
    state.every(c => c.symbol === 'ETH/USD'),
    'symbol sync changes every chart',
    state.map(c => c.symbol),
  );
  check(
    state[2].interval === '5m' && state[0].interval === '1m',
    'symbol sync keeps each interval',
    state.map(c => c.interval),
  );

  // Date range sync clamps to each interval's bar limits and aligns the right edge.
  await page.evaluate(() => window.candleframe.setLayout({ sync: { dateRange: true } }));
  await page.evaluate(() => {
    const chart = window.candleframe.charts()[0];
    const { viewport } = chart.inspect().document;
    chart.execute({ type: 'viewport.set', fromMs: viewport.toMs - 200 * 60000, toMs: viewport.toMs });
  });
  state = await charts();
  check(
    state.every(c => c.viewport.toMs === state[0].viewport.toMs) &&
      state[1].viewport.toMs - state[1].viewport.fromMs === 200 * 60000 &&
      state[2].viewport.toMs - state[2].viewport.fromMs === 200 * 60000,
    'date range sync gives same-length charts the same range',
    state.map(c => [c.interval, (c.viewport.toMs - c.viewport.fromMs) / 60000]),
  );

  // Charts on one market share drawings.
  await page.evaluate(() => window.candleframe.setActiveChart(0));
  await page.evaluate(() => {
    const chart = window.candleframe;
    const { timeMs, close } = chart.inspect().latestCandle;
    chart.execute({
      type: 'drawing.add',
      drawing: { id: 'shared', type: 'horizontal-line', points: [{ timeMs, price: close }] },
    });
  });
  await sleep(700);
  const shared = await page.evaluate(() =>
    window.candleframe.charts().map(chart => chart.inspect().document.drawings.some(d => d.id === 'shared')),
  );
  check(
    shared[0] && shared[1] && shared[3] && !shared[2],
    'a drawing reaches charts on the same market and interval',
    shared,
  );

  // Named layouts survive a reload, and switching changes the grid.
  await inRoot(root => root.querySelector('#layout').click());
  await page.evaluate(() => window.candleframe.setActiveChart(3));
  await inRoot(root => {
    root.querySelector('.layout-save-as input').value = 'Four ETH';
    root.querySelector('.layout-save-as button').click();
  });
  await sleep(300);
  // Changes save into the open layout, so start the second one before changing the grid.
  await inRoot(root => {
    root.querySelector('.layout-save-as input').value = 'Three';
    root.querySelector('.layout-save-as button').click();
  });
  await sleep(300);
  await inRoot(root => root.querySelector('[data-preset="1+2"]').click());
  await sleep(700);
  await page.screenshot({ path: `${out}/grid-1-plus-2.png` });
  const names = await inRoot(root =>
    [...root.querySelectorAll('.layout-open')].map(b => [b.textContent, b.getAttribute('aria-current')]),
  );
  check(
    names.length === 3 && names[2][0] === 'Three' && names[2][1] === 'true',
    'saved layouts are listed with the current one marked',
    names,
  );
  await page.reload();
  await ready();
  let layout = await page.evaluate(() => window.candleframe.getLayout());
  check(
    layout.preset === '1+2' && layout.sync.symbol && layout.sync.dateRange,
    'the current layout returns after a reload',
    layout,
  );
  await inRoot(root => root.querySelector('#layout').click());
  await inRoot(root =>
    [...root.querySelectorAll('.layout-open')].find(b => b.textContent === 'Four ETH').click(),
  );
  await sleep(300);
  await ready();
  layout = await page.evaluate(() => window.candleframe.getLayout());
  state = await charts();
  check(
    layout.preset === '2x2' && state.length === 4,
    'opening a saved layout restores its grid',
    layout.preset,
  );
  check(
    state[1].symbol === 'ETH/USD' && state[2].interval === '5m',
    'opening a saved layout restores each market',
    state,
  );
  check(
    (await page.evaluate(() => window.candleframe.getActiveChart())) === 3,
    'opening a saved layout restores the active chart',
  );

  // Rename and delete.
  await inRoot(root => root.querySelector('.layout-list li:nth-child(3) [aria-label^="Rename"]').click());
  await inRoot(root => {
    const form = root.querySelector('.layout-rename');
    form.querySelector('input').value = 'Three charts';
    form.querySelector('button').click();
  });
  await inRoot(root => root.querySelector('.layout-list li:nth-child(1) [aria-label^="Delete"]').click());
  await sleep(300);
  const after = await inRoot(root => [...root.querySelectorAll('.layout-open')].map(b => b.textContent));
  check(
    JSON.stringify(after) === JSON.stringify(['Four ETH', 'Three charts']),
    'rename and delete update the list',
    after,
  );

  // Narrow screens show the active chart with tabs for the rest.
  await page.setViewportSize({ width: 390, height: 780 });
  await inRoot(root => root.querySelector('.layout-dialog .icon-button[aria-label="Close dialog"]').click());
  await sleep(300);
  const narrow = await inRoot(root => ({
    tabs: getComputedStyle(root.querySelector('.cell-tabs')).display,
    visible: [...root.querySelectorAll('.chart-cell')].filter(c => getComputedStyle(c).display !== 'none')
      .length,
  }));
  check(narrow.tabs === 'flex' && narrow.visible === 1, 'narrow widths show one chart and tabs', narrow);
  await inRoot(root => root.querySelectorAll('.cell-tabs button')[1].click());
  check((await page.evaluate(() => window.candleframe.getActiveChart())) === 1, 'a tab activates its chart');
  await page.screenshot({ path: `${out}/narrow.png` });

  // Appearance applies to every chart; a chosen drawing tool follows the click.
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(200);
  await page.evaluate(() => window.candleframe.setTheme('graphite'));
  const themes = await page.evaluate(() => window.candleframe.charts().map(chart => chart.getTheme().id));
  check(
    themes.every(id => id === 'graphite'),
    'a theme change reaches every chart',
    themes,
  );
  await page.evaluate(() => {
    window.candleframe.setActiveChart(0);
    window.candleframe.setTool('trendline');
  });
  const b2 = await cellBox(2);
  await page.mouse.click(b2.x + b2.width * 0.4, b2.y + b2.height * 0.4);
  const tools = await page.evaluate(() =>
    window.candleframe.charts().map(chart => chart.drawingState().tool),
  );
  check(
    tools[0] === 'cursor' && tools[2] === 'trendline',
    'the drawing tool moves to the clicked chart',
    tools,
  );
  await page.evaluate(() => window.candleframe.setTool('cursor'));
  await page.screenshot({ path: `${out}/grid-graphite.png` });

  // Back to one chart.
  await page.evaluate(() => window.candleframe.setLayout({ preset: '1' }));
  check((await charts()).length === 1, 'the single preset disposes the extra charts');
  check(
    (await inRoot(root => root.querySelectorAll('.cell-tabs button').length)) <= 1,
    'tabs shrink with the grid',
  );
} catch (error) {
  problems.push(`step failed: ${error.message}`);
  console.log(`FAIL ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems.filter(p => p.startsWith('pageerror'))) console.log(`FAIL ${problem}`);
console.log(`Screenshots in ${out}/`);
process.exit(problems.length ? 1 : 0);
