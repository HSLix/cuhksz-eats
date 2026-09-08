import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

const publicDirectory = process.env.CUHKSZ_EATS_PUBLIC_DIR ?? '.generated/dev/public'
const basePath = process.env.CUHKSZ_EATS_BASE_PATH ?? '/'
const configuredUmamiWebsiteId = process.env.CUHKSZ_EATS_UMAMI_WEBSITE_ID?.trim()
const umamiWebsiteId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(configuredUmamiWebsiteId ?? '')
  ? configuredUmamiWebsiteId
  : undefined

export default defineConfig(({ command }) => {
  const analyticsConfig = {
    websiteId: command === 'build' ? (umamiWebsiteId ?? '') : '',
    dataRegion: process.env.CUHKSZ_EATS_UMAMI_DATA_REGION?.trim() || '尚未公开注明',
    retention: process.env.CUHKSZ_EATS_UMAMI_RETENTION?.trim() || '尚未公开注明',
  }

  return {
    base: basePath,
    plugins: [vue()],
    publicDir: path.resolve(publicDirectory),
    define: {
      __UMAMI_CONFIG__: JSON.stringify(analyticsConfig),
    },
  }
})
