import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets:
//   `npm run build`         -> dist/        static site, host anywhere (GitHub Pages, Netlify, ...)
//   `npm run build:single`  -> dist-single/ ONE self-contained .html file you can email or
//                              drag straight into a browser. Nothing else required.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './', // relative asset paths so file:// and subdirectory hosting both work
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2020',
      // Inline every asset when producing the single-file build.
      assetsInlineLimit: single ? 1024 * 1024 * 100 : 4096,
      chunkSizeWarningLimit: 6000,
      reportCompressedSize: false,
    },
    server: { host: true, port: 5173 },
  };
});
