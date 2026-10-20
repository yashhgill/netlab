import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the same build works on a web host, in a subfolder, and inside the desktop app
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
