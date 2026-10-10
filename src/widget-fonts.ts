/**
 * Where the widget finds its WOFF2 files. `bundled` resolves them next to this module,
 * which Vite, webpack 5, Rollup, esbuild and plain ES modules all support. A string is a
 * base URL for self-hosted copies of `dist/lib/fonts/`. `false` skips them and uses the
 * system-font fallbacks.
 */
export type WidgetFontSource = 'bundled' | string | false;

const FILES = {
  ui: 'hanken-grotesk-latin.woff2',
  editorial: 'newsreader-latin.woff2',
} as const;

/** Registered once per document under private names. */
const loaded = new WeakSet<Document>();
export function loadWidgetFonts(doc: Document, source: WidgetFontSource = 'bundled'): void {
  const Font = doc.defaultView?.FontFace;
  if (source === false || !Font || !doc.fonts || loaded.has(doc)) return;
  loaded.add(doc);
  const url = (file: string) =>
    source === 'bundled'
      ? file === FILES.ui
        ? new URL('./fonts/hanken-grotesk-latin.woff2', import.meta.url).href
        : new URL('./fonts/newsreader-latin.woff2', import.meta.url).href
      : new URL(file, source.endsWith('/') ? source : `${source}/`).href;
  for (const [family, href, weight] of [
    ['CandleFrame UI', url(FILES.ui), '400 600'],
    ['CandleFrame Editorial', url(FILES.editorial), '400'],
    // Former names, so custom themes saved before the rename keep their fonts.
    ['OpenChart UI', url(FILES.ui), '400 600'],
    ['OpenChart Editorial', url(FILES.editorial), '400'],
  ]) {
    const face = new Font(family, `url("${href}") format("woff2")`, {
      weight,
      style: 'normal',
      display: 'swap',
    });
    doc.fonts.add(face);
    void face.load().catch(() => {
      doc.fonts.delete(face);
    });
  }
}
