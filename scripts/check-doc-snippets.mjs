#!/usr/bin/env node
// Typechecks every TypeScript code block in the docs site against the library source,
// so guides cannot drift from the API. Blocks import from `candleframe`, `candleframe/core`,
// `candleframe/chart`, `candleframe/widget`, `candleframe/trading`, `candleframe/binance` or
// `candleframe/hyperliquid`.
//
//   node scripts/check-doc-snippets.mjs                 # all of site/src/content/docs
//   node scripts/check-doc-snippets.mjs feeds/overview  # pages whose path contains this
//
// Mark a block that is not meant to compile with `nocheck` after the language:
// ```ts nocheck. Each block is its own module. These names are declared for every
// block, so short examples can use them without setting them up (a block's own
// declaration shadows them):
//   host: HTMLElement, feed: FeedAdapter, chart: ChartWidgetApi, runtime: ChartRuntime
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'site/src/content/docs');
const out = join(root, 'node_modules/.cache/doc-snippets');
const filter = process.argv[2];

const pages = [];
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.mdx?$/.test(entry.name) && (!filter || path.includes(filter))) pages.push(path);
  }
};
walk(docs);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sources = new Map();
let count = 0;
for (const page of pages) {
  const text = readFileSync(page, 'utf8');
  const fence = /^([ \t]*)(`{3,}|~{3,})(ts|typescript|tsx)\b([^\n]*)\n([\s\S]*?)^\1\2[ \t]*$/gm;
  for (const match of text.matchAll(fence)) {
    if (/\bnocheck\b/.test(match[4])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    const indent = match[1];
    const body = match[5]
      .split('\n')
      .map(l => (l.startsWith(indent) ? l.slice(indent.length) : l))
      .join('\n');
    const file = `snippet-${++count}.${match[3] === 'tsx' ? 'tsx' : 'ts'}`;
    writeFileSync(join(out, file), `${body}\nexport {};\n`);
    sources.set(file, `${relative(root, page)}:${line}`);
  }
}

const src = rel => join(root, 'src', rel);
writeFileSync(
  join(out, 'globals.d.ts'),
  `import type { FeedAdapter, ChartRuntime } from 'candleframe/core';
import type { ChartWidgetApi } from 'candleframe/widget';
declare global {
  const host: HTMLElement;
  const feed: FeedAdapter;
  const chart: ChartWidgetApi;
  const runtime: ChartRuntime;
}
export {};
`,
);
writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        strict: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        noEmit: true,
        types: ['node'],
        typeRoots: [join(root, 'node_modules/@types')],
        paths: {
          candleframe: [src('index.ts')],
          'candleframe/core': [src('core.ts')],
          'candleframe/chart': [src('chart-entry.ts')],
          'candleframe/widget': [src('widget-entry.ts')],
          'candleframe/trading': [src('trading-entry.ts')],
          'candleframe/binance': [src('binance.ts')],
          'candleframe/hyperliquid': [src('hyperliquid.ts')],
        },
      },
      include: ['*.ts', '*.tsx'],
    },
    null,
    2,
  ),
);

if (!count) {
  console.log(`No TypeScript blocks in ${pages.length} page(s).`);
  process.exit(0);
}
try {
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(out, 'tsconfig.json')], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  console.log(`ok   ${count} TypeScript blocks in ${pages.length} page(s) compile`);
} catch (error) {
  // Point each error at the page and line the block came from.
  const report = String(error.stdout).replace(
    /(?:[^\s(]*\/)?(snippet-\d+\.tsx?)\((\d+),(\d+)\)/g,
    (all, file, line, column) => {
      const [page, start] = sources.get(file).split(':');
      return `${page}:${Number(start) + Number(line)}:${column}`;
    },
  );
  console.log(report.trim());
  console.log(`FAIL TypeScript blocks do not compile (blocks are in ${relative(root, out)})`);
  process.exit(1);
}
