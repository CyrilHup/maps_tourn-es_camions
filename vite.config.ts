import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    // Disable sourcemaps in production to prevent exposing source code
    sourcemap: mode === 'development',
  },
  define: {
    // Enable runtime checks in development
    __DEV__: JSON.stringify(mode === 'development'),
  },
}))
