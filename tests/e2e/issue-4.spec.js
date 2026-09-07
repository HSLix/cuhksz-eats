import { expect, test } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const commandEnvironment = {
  ...process.env,
  UV_CACHE_DIR: path.join(repositoryRoot, '.generated', 'uv-cache'),
}
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUzw9jYGBgYgADAAsLAPB8OPvJAAAAAElFTkSuQmCC',
  'base64',
)

let sourceDirectory
let devServer
let siteUrl

async function addPhoto(relativePath) {
  const target = path.join(sourceDirectory, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, fixturePng)
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForSite(url, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited early (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${url}`)
}

test.beforeAll(async () => {
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-4-'))
  await addPhoto('IMG_20260907_080000.png')
  await addPhoto('_校园补充/图书馆/IMG_20260907_080100.png')
  await addPhoto('测试餐饮地点/IMG_20260907_090000-门面.png')
  await addPhoto('测试餐饮地点/IMG_20260907_090100-菜单.png')
  await addPhoto('测试餐饮地点/IMG_20260907_090200-未归档菜品-18.png')
  await addPhoto('测试餐饮地点/IMG_20260907_090300.png')
  await addPhoto('测试餐饮地点/IMG_20260907_090400-菜单推荐.png')
  await addPhoto('测试餐饮地点/测试档口/IMG_20260907_100000-门面.png')
  await addPhoto('测试餐饮地点/测试档口/IMG_20260907_100100-菜单.png')
  await addPhoto('测试餐饮地点/测试档口/IMG_20260907_100200-档口菜品-12.png')
  await addPhoto('测试餐饮地点/测试档口/IMG_20260907_100300.png')
  await addPhoto('测试餐饮地点/菜单档口/IMG_20260907_101000-菜单.png')
  await addPhoto('测试餐饮地点/菜单档口/IMG_20260907_101100-菜品-10.png')
  await addPhoto('测试餐饮地点/最新图片档口/IMG_20260907_102000.png')
  await addPhoto('测试餐饮地点/最新图片档口/IMG_20260907_102100-最新菜品-15.png')
  await addPhoto('菜品封面地点/IMG_20260907_110000-菜单.png')
  await addPhoto('菜品封面地点/IMG_20260907_110100-较早菜品-10.png')
  await addPhoto('菜品封面地点/IMG_20260907_110200-最新菜品-12.png')
  await addPhoto('菜品封面地点/IMG_20260907_110300.png')
  await addPhoto('普通封面地点/IMG_20260907_120000-菜单.png')
  await addPhoto('普通封面地点/IMG_20260907_120100.png')
  await addPhoto('普通封面地点/IMG_20260907_120200.png')
  await addPhoto('占位封面地点/IMG_20260907_130000-菜单.png')
  await addPhoto('_不是校园补充/IMG_20260907_140000.png')
  await addPhoto('仅档口地点/唯一档口/IMG_20260907_150000-菜品-16.png')

  const port = await reservePort()
  siteUrl = `http://127.0.0.1:${port}`
  devServer = spawn(
    'uv',
    ['run', '--frozen', 'python', '-u', 'manage.py', 'dev', '--source', sourceDirectory, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repositoryRoot, env: commandEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await waitForSite(siteUrl, devServer)
})

test.afterAll(async () => {
  if (devServer?.exitCode === null) {
    devServer.kill('SIGTERM')
    await new Promise((resolve) => devServer.once('exit', resolve))
  }
  if (sourceDirectory) await rm(sourceDirectory, { recursive: true, force: true })
})

test('visitors browse dining-place and stall content without ownership guesses or fuzzy reserved types', async ({ page }) => {
  await page.goto(siteUrl)
  await page.getByRole('link', { name: /测试餐饮地点/ }).click()

  await expect(page.getByRole('heading', { name: '门面照片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '菜单照片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '未归档', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '普通相册' })).toBeVisible()
  await expect(page.getByText('未归档菜品', { exact: true })).toBeVisible()
  await expect(page.getByText('菜单推荐', { exact: true })).toBeVisible()
  await expect(page.getByText('档口菜品', { exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: /测试档口/ }).click()
  await expect(page).toHaveURL(/\/places\/.+\/stalls\/.+/)
  await expect(page.getByRole('heading', { name: '测试档口' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '门面照片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '菜单照片' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '其余照片' })).toBeVisible()
  await expect(page.getByText('档口菜品', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '未归档', exact: true })).toHaveCount(0)
})

test('loose dish records always remain visible while the unarchived heading requires a stall', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E8%8F%9C%E5%93%81%E5%B0%81%E9%9D%A2%E5%9C%B0%E7%82%B9`)
  await expect(page.getByRole('heading', { name: '未归档', exact: true })).toHaveCount(0)
  await expect(page.getByText('较早菜品', { exact: true })).toBeVisible()
  await expect(page.getByText('最新菜品', { exact: true })).toBeVisible()

  await page.goto(`${siteUrl}/places/%E4%BB%85%E6%A1%A3%E5%8F%A3%E5%9C%B0%E7%82%B9`)
  await expect(page.getByRole('heading', { name: '档口', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '未归档', exact: true })).toHaveCount(0)
})

test('campus supplementary photos and albums stay secondary and outside the dining-place directory', async ({ page }) => {
  await page.goto(siteUrl)

  const directory = page.getByRole('region', { name: '餐饮地点' })
  await expect(directory.getByText('测试餐饮地点', { exact: true })).toBeVisible()
  await expect(directory.getByText('_不是校园补充', { exact: true })).toBeVisible()
  await expect(directory.getByText('图书馆', { exact: true })).toHaveCount(0)
  await expect(directory.getByRole('img', { name: 'IMG_20260907_080000.png' })).toHaveCount(0)

  const supplementary = page.getByRole('region', { name: '校园补充' })
  await expect(supplementary).toBeVisible()
  await expect(supplementary.getByRole('img', { name: 'IMG_20260907_080000.png' })).toBeVisible()
  await expect(supplementary.getByRole('heading', { name: '图书馆' })).toBeVisible()
  await expect(supplementary.getByRole('img', { name: 'IMG_20260907_080100.png' })).toBeVisible()
})

test('dining-place cards choose covers by the specified category and recency priority', async ({ page }) => {
  await page.goto(siteUrl)

  await expect(page.getByRole('link', { name: /测试餐饮地点/ }).getByRole('img'))
    .toHaveAttribute('title', '门面照片')
  await expect(page.getByRole('link', { name: /菜品封面地点/ }).getByRole('img'))
    .toHaveAttribute('title', '最新菜品')
  await expect(page.getByRole('link', { name: /普通封面地点/ }).getByRole('img'))
    .toHaveAttribute('title', '普通照片')
  await expect(page.getByRole('link', { name: /占位封面地点/ }).getByRole('img', { name: '占位封面地点暂无封面' }))
    .toBeVisible()
})

test('stall cards show smaller covers using storefront, menu, then latest-photo priority', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E6%B5%8B%E8%AF%95%E9%A4%90%E9%A5%AE%E5%9C%B0%E7%82%B9`)

  const storefrontStall = page.getByRole('link', { name: /测试档口/ })
  await expect(storefrontStall.getByRole('img', { name: '测试档口' }))
    .toHaveAttribute('title', '门面照片')

  const menuStall = page.getByRole('link', { name: /菜单档口/ })
  await expect(menuStall.getByRole('img', { name: '菜单档口' }))
    .toHaveAttribute('title', '菜单照片')

  const latestStall = page.getByRole('link', { name: /最新图片档口/ })
  await expect(latestStall.getByRole('img', { name: '最新图片档口' }))
    .toHaveAttribute('title', '最新菜品')
})

test('mobile visitors can browse the complete hierarchy without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(siteUrl)

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('link', { name: /测试餐饮地点/ }).click()
  await expect(page.getByRole('heading', { name: '普通相册' })).toBeVisible()
  await expect(page.getByRole('link', { name: /测试档口/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.getByRole('link', { name: /测试档口/ }).click()
  await expect(page.getByRole('heading', { name: '其余照片' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
