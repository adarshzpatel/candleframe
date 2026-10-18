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
      customCss: ['./src/styles/custom.css'],
      sidebar,
    }),
  ],
  vite: {
    // The landing page runs the live widget straight from the library source.
    resolve: { alias: { '@candleframe': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { fs: { allow: ['..'] } },
  },
});
