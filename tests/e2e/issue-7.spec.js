import { expect, test } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
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
  const server = createNetServer()
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
      if ((await fetch(url)).ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${url}`)
}

test.beforeAll(async () => {
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-7-'))
  await addPhoto('IMG_20260907_070000-校园隐藏词.png')
  await addPhoto('_校园补充/补充隐藏相册/IMG_20260907_070100.png')
  await addPhoto('甲餐饮地点/IMG_20260907_080000-地点招牌菜-18-随记隐藏词.png')
  await addPhoto('甲餐饮地点/普通照片隐藏词.png')
  await addPhoto('甲餐饮地点/共享档口/IMG_20260907_090000-共享菜品-20.png')
  await addPhoto('乙餐饮地点/共享档口/IMG_20260907_100000-共享菜品-22.png')

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

test('generated search index contains only names with stable ownership-scoped identifiers', async () => {
  const content = await (await fetch(`${siteUrl}/content.json`)).json()
  expect(content.searchIndex.map((entry) => entry.name).sort()).toEqual([
    '乙餐饮地点', '共享档口', '共享档口', '共享菜品', '共享菜品', '地点招牌菜', '甲餐饮地点',
  ])
  expect(JSON.stringify(content.searchIndex)).not.toContain('随记隐藏词')
  expect(JSON.stringify(content.searchIndex)).not.toContain('普通照片隐藏词')
  expect(JSON.stringify(content.searchIndex)).not.toContain('校园隐藏词')
  expect(JSON.stringify(content.searchIndex)).not.toContain('补充隐藏相册')

  const places = content.searchIndex.filter((entry) => entry.type === 'place')
  const stalls = content.searchIndex.filter((entry) => entry.type === 'stall')
  const sharedDishes = content.searchIndex.filter((entry) => entry.name === '共享菜品')
  expect(places.map((entry) => entry.path).sort()).toEqual([
    '/places/乙餐饮地点', '/places/甲餐饮地点',
  ])
  expect(stalls.every((entry) => entry.path.endsWith('/stalls/共享档口'))).toBe(true)
  expect(sharedDishes.every((entry) => entry.path.endsWith('/dishes/共享菜品'))).toBe(true)
  expect(new Set(stalls.map((entry) => entry.path)).size).toBe(2)
  expect(new Set(sharedDishes.map((entry) => entry.path)).size).toBe(2)
})

test('visitors search places, stalls, and dishes and navigate directly to each detail', async ({ page }) => {
  await page.goto(siteUrl)
  const search = page.getByRole('searchbox', { name: '搜索餐饮地点、档口或菜品' })

  await search.fill('甲餐饮地点')
  const placeResult = page.locator('.search-results').getByRole('link', { name: /餐饮地点.*甲餐饮地点/ })
  await expect(placeResult).toContainText('餐饮地点')
  await placeResult.click()
  await expect(page.getByRole('heading', { name: '甲餐饮地点' })).toBeVisible()

  await page.goto(siteUrl)
  await search.fill('共享档口')
  const stallResults = page.locator('.search-results').getByRole('link', { name: /档口.*共享档口/ })
  await expect(stallResults).toHaveCount(2)
  await expect(stallResults.filter({ hasText: '甲餐饮地点' })).toHaveCount(1)
  await expect(stallResults.filter({ hasText: '乙餐饮地点' })).toHaveCount(1)
  await stallResults.filter({ hasText: '乙餐饮地点' }).click()
  await expect(page.getByRole('heading', { name: '共享档口' })).toBeVisible()
  await expect(page.getByRole('link', { name: '← 返回乙餐饮地点' })).toBeVisible()

  await page.goto(siteUrl)
  await search.fill('共享菜品')
  const dishResults = page.locator('.search-results').getByRole('link', { name: /菜品.*共享菜品/ })
  await expect(dishResults).toHaveCount(2)
  await expect(dishResults.filter({ hasText: '甲餐饮地点 · 共享档口' })).toHaveCount(1)
  await expect(dishResults.filter({ hasText: '乙餐饮地点 · 共享档口' })).toHaveCount(1)
  await dishResults.filter({ hasText: '甲餐饮地点 · 共享档口' }).click()
  await expect(page.getByRole('heading', { name: '共享菜品' })).toBeVisible()
})

test('search excludes notes, ordinary photos, and campus supplementary content', async ({ page }) => {
  await page.goto(siteUrl)
  const search = page.getByRole('searchbox', { name: '搜索餐饮地点、档口或菜品' })
  for (const excludedTerm of ['随记隐藏词', '普通照片隐藏词', '校园隐藏词', '补充隐藏相册']) {
    await search.fill(excludedTerm)
    await expect(page.getByText('没有找到相关餐饮信息')).toBeVisible()
  }
})

test('search and navigation remain readable and tappable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(siteUrl)
  const search = page.getByRole('searchbox', { name: '搜索餐饮地点、档口或菜品' })
  await search.fill('共享')
  const firstResult = page.locator('.search-results a').first()
  expect((await search.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect((await firstResult.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('every generated detail URL opens directly and survives refresh from static output', async ({ page }) => {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: repositoryRoot,
    env: commandEnvironment,
    encoding: 'utf8',
  })
  expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

  const outputDirectory = path.join(repositoryRoot, 'dist')
  const content = JSON.parse(await readFile(path.join(outputDirectory, 'content.json'), 'utf8'))
  const server = createHttpServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let target = path.join(outputDirectory, pathname)
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html')
      const body = await readFile(target)
      const contentType = target.endsWith('.html')
        ? 'text/html'
        : target.endsWith('.json')
          ? 'application/json'
          : target.endsWith('.css')
            ? 'text/css'
            : 'text/javascript'
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/html' })
      response.end(await readFile(path.join(outputDirectory, '404.html')))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const staticUrl = `http://127.0.0.1:${server.address().port}`

  try {
    for (const entry of content.searchIndex) {
      await page.goto(`${staticUrl}${entry.path}`)
      await expect(page.getByRole('heading', { name: entry.name })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: entry.name })).toBeVisible()
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
