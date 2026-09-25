import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend Atlas：純靜態站，base 用相對路徑，放在任何子路徑（GitHub Pages /Backend-Atlas/）都能跑。
export default defineConfig({
  plugins: [react()],
  base: './',
  // PGlite 自帶 wasm/data 資產，不能讓 dev 的依賴預打包處理它
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
