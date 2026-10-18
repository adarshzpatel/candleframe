#!/usr/bin/env node
// Screenshots the built docs site and checks the landing page's live chart renders, in dark
// and light mode and at phone width. Also opens the hosted demo and a few guides.
// Run after `npm run site:build`.
//
//   node scripts/site-screens.mjs                                  # serves site/dist on 4329
//   node scripts/site-screens.mjs --url http://127.0.0.1:4321/candleframe/ --out artifacts/site
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const out = arg('out') ?? 'artifacts/site';
await mkdir(out, { recursive: true });
let url = arg('url'),
  server;
if (!url) {
  const port = 4329;
  server = spawn('npx', ['astro', 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: fileURLToPath(new URL('../site', import.meta.url)),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  url = `http://127.0.0.1:${port}/candleframe/`;
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
  for (const [name, viewport, colorScheme] of [
    ['landing-dark', { width: 1440, height: 1000 }, 'dark'],
    ['landing-light', { width: 1440, height: 1000 }, 'light'],
    ['landing-phone', { width: 390, height: 844 }, 'dark'],
  ]) {
    const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const chart = page.locator('[data-live-chart]');
    await chart.scrollIntoViewIfNeeded();
    // The widget mounts into a shadow root and draws on canvases there.
    await page.waitForFunction(
      () => {
        const host = document.querySelector('[data-live-chart] > *');
        const canvas = host?.shadowRoot?.querySelector('canvas');
        return !!canvas && canvas.width > 0 && canvas.height > 0;
      },
      null,
      { timeout: 15000 },
    );
    await sleep(800);
    const box = await chart.boundingBox();
    check(box && box.width > 300 && box.height > 300, `${name}: the live chart has room`, box);
    check(!errors.length, `${name}: no page errors`, errors);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `${name}: no horizontal scroll`);
    // A full-page shot from a scrolled position draws the sticky header over the hero.
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  // The header's Auto / Light / Dark switch, and the landing page's questions.
  await page.goto(url);
  await page.locator('.header starlight-theme-select button[data-value="light"]').click();
  const theme = await page.evaluate(() => [
    document.documentElement.dataset.theme,
    localStorage.getItem('starlight-theme'),
  ]);
  check(
    theme[0] === 'light' && theme[1] === 'light',
    'the theme switch turns the page light and remembers it',
    theme,
  );
  await page.reload();
  check(
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light',
    'light mode survives a reload',
  );
  await page.locator('.header starlight-theme-select button[data-value="auto"]').click();
  const question = page.locator('.cf-faq details').first();
  await question.locator('summary').click();
  check(await question.evaluate(d => d.open), 'a question opens');
  await question.screenshot({ path: `${out}/faq-open.png` });
  for (const path of ['feeds/overview/', 'indicators/build-an-indicator/', 'agents/drive-the-chart/']) {
    const response = await page.goto(new URL(path, url).href);
    check(response?.ok(), `${path} loads`);
    await page.screenshot({ path: `${out}/${path.replaceAll('/', '-').replace(/-$/, '')}.png` });
  }
  // A guide with callouts and tables, full length in light mode, and a guide at phone width.
  for (const [name, path, viewport, colorScheme] of [
    ['guide-light', 'agents/mcp-server/', { width: 1440, height: 1000 }, 'light'],
    ['guide-phone', 'feeds/overview/', { width: 390, height: 844 }, 'dark'],
  ]) {
    const guide = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: 2 });
    await guide.goto(new URL(path, url).href);
    const overflow = await guide.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `${name}: no horizontal scroll`);
    await guide.screenshot({ path: `${out}/${name}.png`, fullPage: name === 'guide-light' });
    await guide.close();
  }
  // "On this page" as a tree, with a nested heading current.
  for (const colorScheme of ['dark', 'light']) {
    const toc = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme,
      deviceScaleFactor: 2,
    });
    await toc.goto(new URL('feeds/static-data/#instrument-metadata', url).href);
    await toc.waitForFunction(() => !!document.querySelector('starlight-toc a[aria-current="true"]'));
    const tree = await toc.evaluate(() => ({
      thread: getComputedStyle(document.querySelector('starlight-toc ul ul')).borderInlineStartWidth,
      current: document.querySelector('starlight-toc a[aria-current="true"]')?.textContent?.trim(),
    }));
    check(
      tree.thread === '1px' && tree.current === 'Instrument metadata',
      `${colorScheme}: the page outline is a tree`,
      tree,
    );
    await toc.locator('starlight-toc').screenshot({ path: `${out}/toc-${colorScheme}.png` });
    await toc.close();
  }
  // Code up close: a terminal block, a TypeScript block and inline code, in both modes.
  for (const colorScheme of ['dark', 'light']) {
    const code = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme,
      deviceScaleFactor: 2,
    });
    await code.goto(new URL('agents/mcp-server/', url).href);
    const terminal = code.locator('.expressive-code:has(pre[data-language="sh"])').first();
    const label = await terminal.locator('.header').evaluate(h => {
      const s = getComputedStyle(h);
      return { justify: s.justifyContent, chip: getComputedStyle(h, '::before').content };
    });
    check(
      label.justify === 'flex-start' && label.chip === '"SH"',
      `${colorScheme}: code headers are left-aligned with a chip`,
      label,
    );
    await terminal.screenshot({ path: `${out}/code-terminal-${colorScheme}.png` });
    await code
      .locator('.expressive-code:has(pre[data-language="ts"])')
      .first()
      .screenshot({ path: `${out}/code-ts-${colorScheme}.png` });
    await code
      .locator('.sl-markdown-content p:has(> code)')
      .first()
      .screenshot({ path: `${out}/code-inline-${colorScheme}.png` });
    await code.close();
  }
  for (const path of ['llms.txt', 'llms-full.txt', 'feeds/overview.md']) {
    const response = await page.goto(new URL(path, url).href);
    check(response?.ok() && (await response.text()).length > 200, `${path} serves text`);
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('demo/?offline', url).href);
  await page.waitForFunction(() => window.candleframe?.inspect().candleCount > 100, null, { timeout: 15000 });
  check(!errors.length, 'the hosted demo loads candles without errors', errors);
  await page.screenshot({ path: `${out}/demo.png` });
} catch (error) {
  problems.push(`step failed: ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`Screenshots in ${out}/`);
process.exit(problems.length ? 1 : 0);
