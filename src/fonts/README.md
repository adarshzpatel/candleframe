# Widget fonts

These unmodified WOFF2 files are distributed under the SIL Open Font License 1.1. Each copyright and license notice is included alongside its file.

- Inter, Latin subset, variable weight 100 to 900 with optical sizing, for UI text and headings. Source: [Google Fonts](https://fonts.google.com/specimen/Inter), [downloaded WOFF2](https://fonts.gstatic.com/s/inter/v20/UcCo3FwrK3iLTcviYwYZ8UA3.woff2). Retrieved on 2026-10-10. See `Inter-OFL.txt`.
- Paper Mono, variable weight 100 to 800, for prices, axes and annotations. Source: [paper-design/paper-mono](https://github.com/paper-design/paper-mono) at commit `e6eaeceaef02e77e3db997711e07a16378de2bd7`, file `fonts/webfonts/PaperMono[wght].woff2`. Retrieved on 2026-10-10. See `Paper-Mono-OFL.txt`.

`widget-fonts.ts` registers them once per document under private CSS families, so they never collide with the host's font declarations: Inter as `CandleFrame UI`, Paper Mono as `CandleFrame Mono`. System fallbacks cover glyphs outside each subset.

The production build copies this directory next to the plain JavaScript modules and copies the license notices into the demo output.
