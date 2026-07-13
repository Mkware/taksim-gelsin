import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

const root = path.dirname(fileURLToPath(import.meta.url));

/** cPanel deploy öncesi üretim alan adınızı buraya yazın. */
const site = process.env.PUBLIC_SITE_URL || 'https://taksimgelsin.com';

export default defineConfig({
  site,
  output: 'static',
  integrations: [tailwind(), sitemap()],
  compressHTML: true,
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
      },
    },
  },
});
