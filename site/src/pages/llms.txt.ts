import type { APIRoute } from 'astro';
import { docsInOrder, markdownUrl, siteRoot } from '../lib/markdown';

/** The llms.txt index (https://llmstxt.org): every page as a Markdown link, by sidebar group. */
export const GET: APIRoute = async () => {
  const groups = new Map<string, string[]>();
  for (const { doc, group } of await docsInOrder()) {
    const { title, description } = doc.data;
    const line = `- [${title}](${markdownUrl(doc.id)})${description ? `: ${description}` : ''}`;
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  const text = [
    '# CandleFrame',
    '',
    '> A framework-free WebGL2 financial charting library for the browser and for agents: a full widget, a bare chart engine, and a headless runtime with a typed command API. MIT licensed, no runtime dependencies.',
    '',
    `Install from GitHub with \`npm install github:adarshzpatel/candleframe\` (Node 24). Entry points: \`candleframe/core\` (headless, no DOM), \`candleframe/chart\`, \`candleframe/widget\`, \`candleframe/trading\`, \`candleframe/binance\`. Every page below is plain Markdown. All pages in one file: ${new URL('llms-full.txt', siteRoot).href}`,
    '',
    ...[...groups].flatMap(([group, lines]) => [`## ${group}`, '', ...lines, '']),
    '## Optional',
    '',
    '- [Source on GitHub](https://github.com/adarshzpatel/candleframe): the repository, with AGENTS.md for agents changing CandleFrame itself',
    '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
