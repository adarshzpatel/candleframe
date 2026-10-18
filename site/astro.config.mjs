import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { sidebar } from './sidebar.mjs';

const repo = 'https://github.com/adarshzpatel/candleframe';

export default defineConfig({
  site: 'https://adarshzpatel.github.io',
  base: '/candleframe',
  integrations: [
    starlight({
      title: 'CandleFrame',
      description:
        'A framework-free WebGL2 trading chart for the browser and for agents: 13 chart types, 85 drawing tools, indicators and a typed command API.',
      logo: { src: './src/assets/mark.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      // The look follows Caret (caretui.rashmitaparmanik.com): Schibsted Grotesk, Paper Mono and
      // its Neutral palette. Tokens are in custom.css, code colors in ec.config.mjs.
      customCss: ['@fontsource-variable/schibsted-grotesk', './src/styles/custom.css'],
      components: {
        Hero: './src/components/Hero.astro',
        PageTitle: './src/components/PageTitle.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      sidebar: [
        { label: 'Overview', link: '/' },
        // Each group shows how many pages it holds, like a file tree.
        ...sidebar.map(group => ({
          ...group,
          badge: { text: String(group.items.length), class: 'cf-count' },
        })),
      ],
    }),
  ],
  vite: {
    // The landing page runs the live widget straight from the library source.
    resolve: { alias: { '@candleframe': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { fs: { allow: ['..'] } },
  },
});
