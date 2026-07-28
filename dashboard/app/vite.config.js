import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built assets go to ../dist (served by the node runtime server). Relative base so
// the app works when served from the filesystem root. In dev, /api is proxied to
// the node server so `npm run dev` gives live reload against the real API.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 4318,
    proxy: {
      '/api': 'http://localhost:4317',
    },
  },
});
