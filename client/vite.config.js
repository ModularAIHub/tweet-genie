import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174
  },
  build: {
    outDir: 'dist',
    sourcemap: mode === 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['react-hot-toast']
        }
      }
    }
  },
  define: {
    __DEV__: mode === 'development'
  }
}))
