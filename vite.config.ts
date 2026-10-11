import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // 'hidden': maps are written for local debugging, but the bundle carries no sourceMappingURL comment
    // (the deployed site 404s on .map files).
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, strictPort: false },
});
