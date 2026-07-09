import { defineConfig } from 'vite';

// Library build: one self-contained ESM bundle (`dist/dri-viewer.js`) with three.js
// bundled in — no runtime CDN, no peer-dependency on the host having three. The Basis
// transcoder is copied into `public/basis/` (see scripts/copy-basis.mjs) so it lands in
// `dist/basis/` as a sibling asset the widget resolves relative to its own module URL.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'dri-viewer.js',
    },
    rollupOptions: {
      // Nothing external: three (+ addons) is bundled so the widget is drop-in.
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    open: '/index.html',
  },
});
