import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-5-'))
  await addPhoto('历史地点/IMG_20260901_120000-招牌饭-18-第一次尝试.png')
  await addPhoto('历史地点/IMG_20260902_120000-招牌饭-22.png')
  await addPhoto('历史地点/IMG_20260903_120000-招牌饭--当天售罄.png')
  await addPhoto('历史地点/mmexport1788523200000-招牌饭--导入记录.png')
  await addPhoto('历史地点/opaque-招牌饭-30-时间不明.png')

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

test('dish list merges same-name records and summarizes the latest photo and latest known price', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E5%8E%86%E5%8F%B2%E5%9C%B0%E7%82%B9`)

  const dish = page.getByRole('link', { name: /招牌饭.*22 元.*2026年9月2日/ })
  await expect(dish).toHaveCount(1)
  await expect(dish.getByRole('img', { name: '招牌饭' }))
    .toHaveAttribute('title', '最新记录：2026年9月4日')
})

test('dish detail shows every record field and sorts unknown times after dated records', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E5%8E%86%E5%8F%B2%E5%9C%B0%E7%82%B9`)
  await page.getByRole('link', { name: /招牌饭.*22 元.*2026年9月2日/ }).click()

  await expect(page.getByRole('heading', { name: '招牌饭' })).toBeVisible()
  const records = page.locator('.dish-record')
  await expect(records).toHaveCount(5)
  await expect(records.nth(0)).toContainText('2026年9月4日')
  await expect(records.nth(0)).toContainText('价格未记录')
  await expect(records.nth(0)).toContainText('记录者随记：导入记录')
  await expect(records.nth(1)).toContainText('2026年9月3日')
  await expect(records.nth(1)).toContainText('记录者随记：当天售罄')
  await expect(records.nth(2)).toContainText('22 元')
  await expect(records.nth(3)).toContainText('18 元')
  await expect(records.nth(3)).toContainText('记录者随记：第一次尝试')
  await expect(records.nth(4)).toContainText('记录时间未知')
  await expect(records.nth(4)).toContainText('30 元')
  await expect(records.nth(4)).toContainText('记录者随记：时间不明')
})
