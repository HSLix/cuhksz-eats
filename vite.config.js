import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

const publicDirectory = process.env.CUHKSZ_EATS_PUBLIC_DIR ?? '.generated/dev/public'
const basePath = process.env.CUHKSZ_EATS_BASE_PATH ?? '/'
const configuredUmamiWebsiteId = process.env.CUHKSZ_EATS_UMAMI_WEBSITE_ID?.trim()
const umamiWebsiteId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(configuredUmamiWebsiteId ?? '')
  ? configuredUmamiWebsiteId
  : undefined

function umamiCloudPlugin() {
  return {
    name: 'umami-cloud',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://cloud.umami.is/script.js',
            'data-website-id': umamiWebsiteId,
          },
          injectTo: 'head',
        }]
      },
    },
  }
}

export default defineConfig(({ command }) => ({
  base: basePath,
  plugins: [
    vue(),
    ...(command === 'build' && umamiWebsiteId ? [umamiCloudPlugin()] : []),
  ],
  publicDir: path.resolve(publicDirectory),
}))
