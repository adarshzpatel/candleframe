#!/usr/bin/env node
// Screenshot the widget as it ships: examples/default.html mounts it with a feed and no options.
// Captures idle, hover, each header popover and a volume profile at three host sizes,
// plus the desktop size with a light system color scheme.
//
//   node scripts/default-screens.mjs                                   # starts Vite
//   node scripts/default-screens.mjs --url http://127.0.0.1:5173/ --out artifacts/default
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
const out = args.out ?? 'artifacts/default';
await mkdir(out, { recursive: true });

let server;
let base = args.url;
if (!base) {
  const port = 5199;
  server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await sleep(200);
  }
}
const url = new URL('examples/default.html', base).href;

// Header buttons that open a popover or dialog, by id inside the widget's shadow root.
const popovers = ['chart-type', 'indicator-menu', 'layout', 'theme', 'export', 'help', 'inspect', 'save'];

const browser = await chromium.launch();
try {
  for (const [name, viewport, colorScheme] of [
    ['desktop', { width: 1440, height: 900 }, 'dark'],
    ['light', { width: 1440, height: 900 }, 'light'],
    ['embed', { width: 900, height: 560 }, 'dark'],
    ['phone', { width: 390, height: 844 }, 'dark'],
  ]) {
    const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: 2 });
    page.on('console', m => m.type() === 'error' && console.log(`${name} console: ${m.text()}`));
    page.on('pageerror', e => console.log(`${name} pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page
      .waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 })
      .catch(() => console.log(`${name}: chart did not load 100 candles`));
    await sleep(800);
    await page.screenshot({ path: `${out}/${name}-idle.png` });

    const plot = await page.locator('.chart-host').first().boundingBox();
    if (plot) {
      await page.mouse.move(plot.x + plot.width * 0.6, plot.y + plot.height * 0.4);
      await sleep(300);
      await page.screenshot({ path: `${out}/${name}-hover.png` });
      await page.mouse.move(0, 0);
    }
    for (const id of popovers) {
      const button = page.locator(`#${id}`).first();
      if (!(await button.isVisible().catch(() => false))) {
        console.log(`${name}: #${id} not visible`);
        continue;
      }
      await button.click();
      await sleep(350);
      await page.screenshot({ path: `${out}/${name}-${id}.png` });
      await page.keyboard.press('Escape');
      await sleep(200);
    }
    // Narrow widgets fold the drawing rail behind a header toggle.
    const draw = page.locator('#draw-toggle').first();
    if (await draw.isVisible().catch(() => false)) {
      await draw.click();
      await sleep(300);
      await page.screenshot({ path: `${out}/${name}-rail.png` });
      await draw.click();
    }
    await page.evaluate(() =>
      window.candleframe.execute({ type: 'indicator.add', indicator: { kind: 'vp' } }),
    );
    await sleep(600);
    await page.screenshot({ path: `${out}/${name}-volume-profile.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(`Screenshots in ${out}/`);
