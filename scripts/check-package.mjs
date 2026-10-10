#!/usr/bin/env node
// Checks the built package as a consumer sees it. Run after `npm run build`.
//
//   node scripts/check-package.mjs
//
// - every `exports` entry resolves to emitted JavaScript and declarations
// - every entry imports in plain Node without a DOM (no top-level browser access)
// - `candleframe/core` runs a headless chart end to end
// - the tarball contains the fonts and their licenses next to the modules
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (typeof target === 'string') continue;
  const js = `${root}${target.import.slice(2)}`,
    types = `${root}${target.types.slice(2)}`;
  check(existsSync(js) && existsSync(types), `${subpath} has ${target.import} and ${target.types}`);
  try {
    const module = await import(pathToFileURL(js).href);
    check(Object.keys(module).length > 0, `${subpath} imports in Node without a DOM`);
  } catch (error) {
    check(false, `${subpath} imports in Node without a DOM (${error.message})`);
  }
}

const core = await import(pathToFileURL(`${root}dist/lib/core.js`).href);
const feed = core.createStaticFeed({
  candles: Array.from({ length: 50 }, (_, i) => ({
    timeMs: i * 60_000,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1,
  })),
  interval: '1m',
  instrument: 'PKG',
});
const runtime = new core.ChartRuntime(feed, [core.sma(5)]);
runtime.start();
const result = runtime.execute([{ type: 'indicator.add', indicator: { kind: 'rsi' } }]);
check(
  result.created[0] === 'rsi' && runtime.inspect().candleCount === 50,
  'candleframe/core runs a headless chart',
);
runtime.dispose();

const [packed] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }),
);
const files = new Set(packed.files.map(file => file.path));
for (const file of [
  'dist/lib/fonts/hanken-grotesk-latin.woff2',
  'dist/lib/fonts/newsreader-latin.woff2',
  'dist/lib/fonts/Hanken-Grotesk-OFL.txt',
  'dist/lib/fonts/Newsreader-OFL.txt',
  'LICENSE',
])
  check(files.has(file), `tarball contains ${file}`);
check(
  ![...files].some(file => file.startsWith('src/') || file.startsWith('tests/')),
  'tarball excludes sources and tests',
);
const widgetFonts = readFileSync(`${root}dist/lib/widget-fonts.js`, 'utf8');
check(
  widgetFonts.includes("new URL('./fonts/hanken-grotesk-latin.woff2', import.meta.url)"),
  'font URLs stay static so bundlers can rewrite them',
);
console.log(`\n${packed.files.length} files, ${(packed.unpackedSize / 1024).toFixed(0)} KiB unpacked`);
process.exit(failures.length ? 1 : 0);
