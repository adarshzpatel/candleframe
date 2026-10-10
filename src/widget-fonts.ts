/**
 * Where the widget finds its WOFF2 files. `bundled` resolves them next to this module,
 * which Vite, webpack 5, Rollup, esbuild and plain ES modules all support. A string is a
 * base URL for self-hosted copies of `dist/lib/fonts/`. `false` skips them and uses the
 * system-font fallbacks.
 */
export type WidgetFontSource = 'bundled' | string | false;

const FILE = 'inter-latin.woff2';

/** Registered once per document under private names. */
const loaded = new WeakSet<Document>();
export function loadWidgetFonts(doc: Document, source: WidgetFontSource = 'bundled'): void {
  const Font = doc.defaultView?.FontFace;
  if (source === false || !Font || !doc.fonts || loaded.has(doc)) return;
  loaded.add(doc);
  const href =
    source === 'bundled'
      ? new URL('./fonts/inter-latin.woff2', import.meta.url).href
      : new URL(FILE, source.endsWith('/') ? source : `${source}/`).href;
  // Inter covers UI text and headings. The other names keep themes saved before the
  // switch, or before the rename from OpenChart, on the same font.
  for (const family of ['CandleFrame UI', 'CandleFrame Editorial', 'OpenChart UI', 'OpenChart Editorial']) {
    const face = new Font(family, `url("${href}") format("woff2")`, {
      weight: '100 900',
      style: 'normal',
      display: 'swap',
    });
    doc.fonts.add(face);
    void face.load().catch(() => {
      doc.fonts.delete(face);
    });
  }
}
