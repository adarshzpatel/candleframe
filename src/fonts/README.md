# Widget fonts

These unmodified Latin WOFF2 files are distributed under the SIL Open Font License 1.1. Copyright and license notices are included alongside each font.

- Hanken Grotesk, variable normal weight for UI text. Source: [Google Fonts](https://fonts.google.com/specimen/Hanken+Grotesk), [downloaded WOFF2](https://fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59A.woff2). See `Hanken-Grotesk-OFL.txt`.
- Newsreader, regular weight with optical size 32 for headings. Source: [Google Fonts](https://fonts.google.com/specimen/Newsreader), [downloaded WOFF2](https://fonts.gstatic.com/s/newsreader/v26/cY9VfjOCX1hbuyalUrK49dLafXjalZCsZBsgBgbNJYQ.woff2). See `Newsreader-OFL.txt`.

Retrieved on 2026-10-03. `widget-fonts.ts` registers the CSS families `CandleFrame UI` and `CandleFrame Editorial` once per document to avoid colliding with the host's font declarations. The font files themselves are unchanged. System fallbacks cover glyphs outside the Latin subsets.

The production build copies this directory next to the plain JavaScript modules and copies the license notices into the demo output.
