import type { APIRoute, GetStaticPaths } from 'astro';
import { docsInOrder, toMarkdown } from '../lib/markdown';

/** Every doc page as plain Markdown, at its path plus `.md`. */
export const getStaticPaths = (async () =>
  (await docsInOrder()).map(({ doc }) => ({
    params: { slug: doc.id },
    props: { doc },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(toMarkdown(props.doc), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
