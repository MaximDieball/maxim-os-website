import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
    // Im Docker-Container unter macOS kommen keine Dateisystem-Events vom Host an (#51).
    watch: process.env.VITE_WATCH_POLLING ? { usePolling: true, interval: 300 } : undefined,
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
