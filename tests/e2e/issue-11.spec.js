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
let devOutput = ''

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
    if (child.exitCode !== null) throw new Error(`dev exited early (${child.exitCode})\n${devOutput}`)
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
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-11-'))

  await addPhoto('嵌套最新地点/IMG_20260901_080000.png')
  await addPhoto('嵌套最新地点/较早档口/IMG_20260902_080000-旧菜-10.png')
  await addPhoto('嵌套最新地点/最新档口/IMG_20260909_080000-新菜-20.png')
  await addPhoto('直属最新地点/IMG_20260908_080000-门面.png')
  await addPhoto('A同刻地点/IMG_20260907_080000.png')
  await addPhoto('B同刻地点/IMG_20260907_080000.png')
  await addPhoto('A未知地点/opaque.png')
  await addPhoto('B未知地点/unknown.png')

  await addPhoto('排序样例地点/IMG_20260901_090000-门面.png')
  await addPhoto('排序样例地点/IMG_20260903_090000-门面.png')
  await addPhoto('排序样例地点/opaquefront-门面.png')
  await addPhoto('排序样例地点/IMG_20260902_090000-菜单.png')
  await addPhoto('排序样例地点/IMG_20260904_090000.png')
  await addPhoto('排序样例地点/IMG_20260905_090000-较新菜-20.png')
  await addPhoto('排序样例地点/IMG_20260902_100000-较新菜-18.png')
  await addPhoto('排序样例地点/IMG_20260904_100000-较旧菜-12.png')
  await addPhoto('排序样例地点/opaquedish-未知菜-9.png')
  await addPhoto('排序样例地点/A同刻档口/IMG_20260906_080000.png')
  await addPhoto('排序样例地点/B同刻档口/IMG_20260906_080000-菜品-10.png')
  await addPhoto('排序样例地点/最新档口/IMG_20260907_080000-菜单.png')
  await addPhoto('排序样例地点/未知档口/opaque.png')

  const port = await reservePort()
  siteUrl = `http://127.0.0.1:${port}`
  devServer = spawn(
    'uv',
    ['run', '--frozen', 'python', '-u', 'manage.py', 'dev', '--source', sourceDirectory, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repositoryRoot, env: commandEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  devServer.stdout.on('data', (chunk) => { devOutput += chunk })
  devServer.stderr.on('data', (chunk) => { devOutput += chunk })
  await waitForSite(siteUrl, devServer)
})

test.afterAll(async () => {
  if (devServer?.exitCode === null) {
    devServer.kill('SIGTERM')
    await new Promise((resolve) => devServer.once('exit', resolve))
  }
  if (sourceDirectory) await rm(sourceDirectory, { recursive: true, force: true })
})

test('home orders dining places by the newest direct or nested record with stable unknown ties', async ({ page }) => {
  await page.goto(siteUrl)

  await expect(page.locator('.place-card h3')).toHaveText([
    '嵌套最新地点',
    '直属最新地点',
    'A同刻地点',
    'B同刻地点',
    '排序样例地点',
    'A未知地点',
    'B未知地点',
  ])
  await expect(page.getByRole('link', { name: /嵌套最新地点/ }))
    .toContainText('上次更新：2026年9月9日')
  await expect(page.getByRole('link', { name: /A未知地点/ }))
    .toContainText('上次更新：时间未知')
})

test('place orders stalls, dishes, and each photo type newest first', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E6%8E%92%E5%BA%8F%E6%A0%B7%E4%BE%8B%E5%9C%B0%E7%82%B9`)

  await expect(page.locator('.stall-card strong')).toHaveText([
    '最新档口',
    'A同刻档口',
    'B同刻档口',
    '未知档口',
  ])
  await expect(page.getByRole('link', { name: /最新档口/ }))
    .toContainText('上次更新：2026年9月7日')
  await expect(page.getByRole('link', { name: /未知档口/ }))
    .toContainText('上次更新：时间未知')
  await expect(page.locator('.dish-card strong')).toHaveText(['较新菜', '较旧菜', '未知菜'])

  const storefronts = page.locator('section.content-section').filter({
    has: page.getByRole('heading', { name: '门面照片' }),
  })
  expect(await storefronts.locator('img').evaluateAll(
    (images) => images.map((image) => image.getAttribute('alt')),
  )).toEqual([
    '排序样例地点',
    'IMG_20260901_090000-门面.png',
    'opaquefront-门面.png',
  ])
})

test('serialized same-type content is consistently newest first without filesystem times', async ({ page }) => {
  await page.goto(siteUrl)
  const content = await page.evaluate(async () => (await fetch('/content.json')).json())
  const place = content.places.find((candidate) => candidate.name === '排序样例地点')

  for (const kind of ['storefront', 'menu', 'photo']) {
    const times = place.photos.filter((photo) => photo.kind === kind).map((photo) => photo.capturedAt)
    expect(times).toEqual([...times].sort((left, right) => {
      if (left && right) return right.localeCompare(left)
      if (left) return -1
      if (right) return 1
      return 0
    }))
  }
  expect(place.dishes.map((dish) => dish.name)).toEqual(['较新菜', '较旧菜', '未知菜'])
})
