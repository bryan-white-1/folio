import { defineConfig } from 'vite';
// Let Rollup retain Mermaid's dynamic diagram imports instead of merging all dependencies.
export default defineConfig({ build: {
  chunkSizeWarningLimit: 1100,
  // Windows PRI treats dots inside asset basenames as resource qualifiers.
  rollupOptions: { output: { chunkFileNames: chunk => `assets/${chunk.name.replaceAll('.', '-')}-[hash].js` } },
} });
