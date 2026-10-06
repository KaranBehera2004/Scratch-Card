import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // If another local Vite preview is already using 5174, use the next
    // available port instead of stopping the API process.
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5051',
        changeOrigin: true,
      },
    },
  },
})
