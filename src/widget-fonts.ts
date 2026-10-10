/** Registered once per document under private names, served from the same package. */
const loaded = new WeakSet<Document>();
export function loadWidgetFonts(doc: Document): void {
  const Font = doc.defaultView?.FontFace;
  if (!Font || !doc.fonts || loaded.has(doc)) return;
  loaded.add(doc);
  for (const [family, url, weight] of [
    ['OpenChart UI', new URL('./fonts/hanken-grotesk-latin.woff2', import.meta.url).href, '400 600'],
    ['OpenChart Editorial', new URL('./fonts/newsreader-latin.woff2', import.meta.url).href, '400'],
  ]) {
    const face = new Font(family, `url("${url}") format("woff2")`, {
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
