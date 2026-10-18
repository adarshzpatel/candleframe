import { getCollection, type CollectionEntry } from 'astro:content';
import { sidebar } from '../../sidebar.mjs';

type Doc = CollectionEntry<'docs'>;

/** The public site root, with a trailing slash: https://…/candleframe/ */
export const siteRoot = new URL(import.meta.env.BASE_URL.replace(/\/?$/, '/'), import.meta.env.SITE).href;

/** Every doc in sidebar order, with its sidebar group. The landing page comes first. */
export async function docsInOrder(): Promise<{ doc: Doc; group: string }[]> {
  const docs = new Map((await getCollection('docs')).map(doc => [doc.id, doc]));
  const ordered: { doc: Doc; group: string }[] = [];
  const home = docs.get('index');
  if (home) ordered.push({ doc: home, group: 'Home' });
  for (const { label, items } of sidebar)
    for (const id of items) {
      const doc = docs.get(id);
      if (doc) ordered.push({ doc, group: label });
    }
  return ordered;
}

export const htmlUrl = (id: string) => new URL(id === 'index' ? '' : `${id}/`, siteRoot).href;
export const markdownUrl = (id: string) => new URL(`${id}.md`, siteRoot).href;

/**
 * A page as plain Markdown for agents: title and description first, MDX imports and
 * components turned into Markdown, and relative links made absolute. Links to other doc
 * pages point at their Markdown copies.
 */
export function toMarkdown(doc: Doc): string {
  let body = doc.body ?? '';
  body = body
    .replace(/^import .*$\n?/gm, '')
    .replace(/^<LiveChart \/>\n?/gm, '')
    .replace(/^\s*<\/?CardGrid>\n?/gm, '')
    .replace(/^\s*<Card title="([^"]+)"[^>]*>\n?/gm, '\n### $1\n\n')
    .replace(/^\s*<\/Card>\n?/gm, '\n')
    .replace(
      /^\s*<LinkCard\s+title="([^"]+)"\s+href="([^"]+)"\s+description="([^"]+)"\s*\/>\n?/gm,
      '- [$1]($2): $3\n',
    );
  // Component children are indented in MDX; outside code fences that indent would read as code.
  body = body
    .split(/(^```[\s\S]*?^```$)/m)
    .map((part, i) => (i % 2 ? part : part.replace(/^[ \t]+(?=\S)/gm, '').replace(/\n{3,}/g, '\n\n')))
    .join('');
  const base = htmlUrl(doc.id);
  body = body.replace(/\]\(([^)\s]+)\)/g, (all, href: string) => {
    if (/^[a-z]+:|^#/.test(href)) return all;
    const url = new URL(href, base);
    if (url.href.startsWith(siteRoot) && url.pathname.endsWith('/')) {
      const id = url.pathname.slice(new URL(siteRoot).pathname.length).replace(/\/$/, '');
      if (id && !id.includes('.')) return `](${markdownUrl(id)}${url.hash})`;
    }
    return `](${url.href})`;
  });
  const { title, description } = doc.data;
  return `# ${title}\n\n${description ? `> ${description}\n\n` : ''}${body.trim()}\n`;
}
