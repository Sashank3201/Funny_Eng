import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built bundle works from any static host or subdirectory.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
  },
});
