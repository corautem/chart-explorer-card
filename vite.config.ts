import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const { version, license } = pkg;

// HACS copies only the .js files, so the licence notice travels inside them.
const banner = (editor: boolean) =>
  [
    `/*! Chart Explorer Card ${version} | Copyright (C) 2026 corautem | ${license}`,
    editor
      ? ' * Includes Lit (BSD-3-Clause) and Material Design Icons paths (Apache-2.0).'
      : ' * Includes Apache ECharts (Apache-2.0), with code from d3 (BSD-3-Clause); ZRender (BSD-3-Clause);\n' +
        ' * Lit (BSD-3-Clause); tslib (0BSD); Material Design Icons paths (Apache-2.0).\n' +
        ' * Apache ECharts: Copyright 2017-2026 The Apache Software Foundation. This product includes\n' +
        ' * software developed at The Apache Software Foundation (https://www.apache.org/).',
    ' * Licence texts: LICENSE and THIRD-PARTY-NOTICES.md in the source repository.',
    ' */',
  ].join('\n');

// `npm run dev` serves the test page in dev/. `npm run build` bundles the card,
// then (with --mode editor) the visual editor as its own self-contained file.
export default defineConfig(({ command, mode }) => {
  const editor = mode === 'editor';
  if (command === 'serve') {
    return {
      root: 'dev',
      server: { host: '127.0.0.1', port: 5173, strictPort: true },
    };
  }
  return {
    // Chunks load relative to the main file, wherever Home Assistant serves it from.
    base: './',
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: !editor,
      target: 'es2021',
      modulePreload: false,
      sourcemap: false,
      reportCompressedSize: false,
      // ECharts' smallest useful build is about 457 KB, so the default 500 KB warning would always fire.
      chunkSizeWarningLimit: 650,
      rolldownOptions: {
        input: editor ? 'src/editor/editor.ts' : 'src/chart-explorer-card.ts',
        output: {
          format: 'es',
          postBanner: banner(editor),
          entryFileNames: editor ? 'chart-explorer-card-editor.js' : 'chart-explorer-card.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  };
});
