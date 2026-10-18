import type { APIRoute } from 'astro';
import { docsInOrder, htmlUrl, toMarkdown } from '../lib/markdown';

/** Every doc page as Markdown in one file, in sidebar order. */
export const GET: APIRoute = async () => {
  const pages = (await docsInOrder()).map(({ doc }) => `<!-- ${htmlUrl(doc.id)} -->\n\n${toMarkdown(doc)}`);
  return new Response(pages.join('\n---\n\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
