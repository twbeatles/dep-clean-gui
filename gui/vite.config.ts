import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    react(),
    {
      name: 'electron-file-protocol-index-fix',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin(?=(\s|>))/g, '');
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/gui'),
    emptyOutDir: true,
  },
});
