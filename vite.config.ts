import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 4000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
