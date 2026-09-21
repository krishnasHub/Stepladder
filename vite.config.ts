import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Make the single-file build a CLASSIC script.
 *
 * Browsers refuse to execute `<script type="module">` from a `file://` URL —
 * it counts as a cross-origin fetch and is blocked — so a module build shows a
 * blank page to anyone who just double-clicks the file, which is the whole
 * point of shipping one. Rollup is already told to emit an IIFE; Vite writes
 * the tag from the original entry regardless, so the attributes are stripped
 * here, after the file is on disk.
 */
function classicScriptForFileUrls(outDir: string): Plugin {
  return {
    name: 'stepladder:classic-script',
    enforce: 'post',
    writeBundle() {
      const file = resolve(outDir, 'index.html');
      const html = readFileSync(file, 'utf8').replace(/<script\b([^>]*)>/g, (_m, attrs: string) => {
        const cleaned = attrs
          .replace(/\s+type="module"/g, '')
          .replace(/\s+crossorigin(="[^"]*")?/g, '');
        return `<script${cleaned}>`;
      });
      writeFileSync(file, html);
    },
  };
}

// Two build targets:
//   `npm run build`         -> dist/        static site, host anywhere (GitHub Pages, Netlify, ...)
//   `npm run build:single`  -> dist-single/ ONE self-contained .html file you can email or
//                              drag straight into a browser. Nothing else required.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const outDir = single ? 'dist-single' : 'dist';
  return {
    base: './', // relative asset paths so file:// and subdirectory hosting both work
    plugins: single ? [viteSingleFile(), classicScriptForFileUrls(outDir)] : [],
    build: {
      outDir,
      target: 'es2020',
      // Inline every asset when producing the single-file build.
      assetsInlineLimit: single ? 1024 * 1024 * 100 : 4096,
      chunkSizeWarningLimit: 6000,
      reportCompressedSize: false,
      // An IIFE, not an ES module — see classicScriptForFileUrls above.
      rollupOptions: single
        ? { output: { format: 'iife', inlineDynamicImports: true } }
        : undefined,
    },
    server: { host: true, port: 5173 },
  };
});
