# Widget fonts

This unmodified Latin WOFF2 file is distributed under the SIL Open Font License 1.1. The copyright and license notice is included alongside it.

- Inter, variable weight 100 to 900 with optical sizing, for UI text and headings. Source: [Google Fonts](https://fonts.google.com/specimen/Inter), [downloaded WOFF2](https://fonts.gstatic.com/s/inter/v20/UcCo3FwrK3iLTcviYwYZ8UA3.woff2). See `Inter-OFL.txt`.

Retrieved on 2026-10-10. `widget-fonts.ts` registers the file under the CSS family `CandleFrame UI` once per document to avoid colliding with the host's font declarations. It also registers `CandleFrame Editorial`, `OpenChart UI` and `OpenChart Editorial` so themes saved under earlier names keep working. The font file itself is unchanged. System fallbacks cover glyphs outside the Latin subset.

The production build copies this directory next to the plain JavaScript modules and copies the license notice into the demo output.
