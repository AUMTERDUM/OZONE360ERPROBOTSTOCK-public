import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3001';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? 'https://your-project.pages.dev/' : '/',
  plugins: [react()],
  build: {
    modulePreload: false,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      // Required for hot-reload inside Docker on Windows (volume mount file events)
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
}))
