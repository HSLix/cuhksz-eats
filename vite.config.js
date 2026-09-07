import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

const publicDirectory = process.env.CUHKSZ_EATS_PUBLIC_DIR ?? '.generated/dev/public'

export default defineConfig({
  plugins: [vue()],
  publicDir: path.resolve(publicDirectory),
})
