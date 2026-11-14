import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // Relative imports work on both hosts; the Worker gives HTML assets explicit
  // application paths so shared-project documents resolve the same bundles.
  base: process.env.VITE_ACCOUNT_WORKSPACE === 'true' ? './' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4177',
        changeOrigin: true,
        // The API only accepts mutations whose Origin matches its own address.
        // The dev server proxies across ports, so restate the Origin it expects.
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', 'http://127.0.0.1:4177');
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
    css: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
