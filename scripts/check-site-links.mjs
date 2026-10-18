#!/usr/bin/env node
// Checks every internal link in the built docs site: HTML hrefs and srcs, and the links in
// the Markdown copies and llms.txt files. Run after `npm run site:build`.
//
//   node scripts/check-site-links.mjs                 # site/dist, base /candleframe/
//   node scripts/check-site-links.mjs --dist site/dist --base /candleframe/
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, arg('dist') ?? 'site/dist');
const base = arg('base') ?? '/candleframe/';
const origin = 'https://adarshzpatel.github.io';

const files = [];
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(html|md|txt)$/.test(entry.name)) files.push(path);
  }
};
walk(dist);

/** The file a site path serves, or null. */
const target = pathname => {
  if (!pathname.startsWith(base)) return null;
  const rel = decodeURIComponent(pathname.slice(base.length));
  const path = join(dist, rel);
  if (existsSync(path) && statSync(path).isFile()) return path;
  const index = join(path, 'index.html');
  return existsSync(index) ? index : null;
};

const broken = [];
let checked = 0;
for (const file of files) {
  // Canonical tags name the page's own URL, which the 404 page does not have.
  const text = readFileSync(file, 'utf8').replace(/<link[^>]*rel="canonical"[^>]*>/g, '');
  const page = '/' + relative(dist, file).replace(/index\.html$/, '');
  const pageUrl = new URL(base.replace(/\/$/, '') + page, origin);
  const links = file.endsWith('.html')
    ? [...text.matchAll(/\s(?:href|src)="([^"]+)"/g)].map(m => m[1])
    : [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]);
  for (const link of links) {
    if (/^(mailto:|data:|javascript:|#)/.test(link)) continue;
    const url = new URL(link.replaceAll('&amp;', '&'), pageUrl);
    if (url.origin !== origin) continue;
    checked++;
    if (!target(url.pathname)) broken.push(`${relative(root, file)} -> ${link}`);
  }
}
for (const line of broken) console.log(`FAIL ${line}`);
console.log(
  `${broken.length ? 'FAIL' : 'ok  '} ${checked} internal links in ${files.length} files, ${broken.length} broken`,
);
process.exit(broken.length ? 1 : 0);
