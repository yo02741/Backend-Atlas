// vite.config.js：開發時 /api 原樣轉給 clinic-api（契約的路徑本來就在 /api 底下，不改寫）
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const API = process.env.CLINIC_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [vue()],
  base: process.env.BASE_PATH ?? '/',          // compose 的 nginx 版用 BASE_PATH=/clinic/ 建置（第 7 階段）
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': API } },
  preview: { proxy: { '/api': API } },
})
