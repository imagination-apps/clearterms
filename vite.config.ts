import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ローカル開発時は `API_PROXY=https://xxx.vercel.app npm run dev` で /api を転送できる
// (Vercel上で動かす場合は `vercel dev` を使えば不要)
const apiProxy = process.env.API_PROXY

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: apiProxy ? { proxy: { '/api': { target: apiProxy, changeOrigin: true } } } : undefined,
  preview: apiProxy ? { proxy: { '/api': { target: apiProxy, changeOrigin: true } } } : undefined,
})
