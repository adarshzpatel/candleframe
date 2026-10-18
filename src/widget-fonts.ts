/**
 * Where the widget finds its WOFF2 files. `bundled` resolves them next to this module,
 * which Vite, webpack 5, Rollup, esbuild and plain ES modules all support. A string is a
 * base URL for self-hosted copies of `dist/lib/fonts/`. `false` skips them and uses the
 * system-font fallbacks.
 */
export type WidgetFontSource = 'bundled' | string | false;

const FACES = [
  // Inter covers UI text and headings. `CandleFrame Editorial` keeps themes saved before
  // the switch to one UI face on the same font.
  {
    file: 'inter-latin.woff2',
    url: () => new URL('./fonts/inter-latin.woff2', import.meta.url).href,
    families: ['CandleFrame UI', 'CandleFrame Editorial'],
    weight: '100 900',
  },
  // Paper Mono sets prices, axes and annotations the same way on every system.
  {
    file: 'paper-mono.woff2',
    url: () => new URL('./fonts/paper-mono.woff2', import.meta.url).href,
    families: ['CandleFrame Mono'],
    weight: '100 800',
  },
];

/** Registered once per document under private names. */
const loaded = new WeakSet<Document>();
export function loadWidgetFonts(doc: Document, source: WidgetFontSource = 'bundled'): void {
  const Font = doc.defaultView?.FontFace;
  if (source === false || !Font || !doc.fonts || loaded.has(doc)) return;
  loaded.add(doc);
  for (const { file, url, families, weight } of FACES) {
    const href =
      source === 'bundled' ? url() : new URL(file, source.endsWith('/') ? source : `${source}/`).href;
    for (const family of families) {
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
}
