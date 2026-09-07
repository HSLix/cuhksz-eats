import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const pythonCommand = 'uv'
const pythonArguments = ['run', '--frozen', 'python']
const commandEnvironment = {
  ...process.env,
  UV_CACHE_DIR: path.join(repositoryRoot, '.generated', 'uv-cache'),
}
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUzw9jYGBgYgADAAsLAPB8OPvJAAAAAElFTkSuQmCC',
  'base64',
)

let sourceDirectory
let sourcePhoto
let sourcePhotoDigest
let devServer
let siteUrl

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex')
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
    if (child.exitCode !== null) {
      throw new Error(`dev command exited early with status ${child.exitCode}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${url}`)
}

test.beforeAll(async () => {
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-2-'))
  const placeDirectory = path.join(sourceDirectory, '测试餐饮地点')
  await mkdir(placeDirectory)
  sourcePhoto = path.join(placeDirectory, '普通照片.png')
  await writeFile(sourcePhoto, fixturePng)
  sourcePhotoDigest = digest(await readFile(sourcePhoto))

  const check = spawnSync(
    pythonCommand,
    [...pythonArguments, 'manage.py', 'check', '--source', sourceDirectory],
    { cwd: repositoryRoot, encoding: 'utf8', env: commandEnvironment },
  )
  expect(check.status, check.stderr).toBe(0)
  expect(check.stdout).toContain('检查通过')
  expect(digest(await readFile(sourcePhoto))).toBe(sourcePhotoDigest)

  const port = await reservePort()
  siteUrl = `http://127.0.0.1:${port}`
  devServer = spawn(
    pythonCommand,
    [
      ...pythonArguments,
      '-u',
      'manage.py',
      'dev',
      '--source',
      sourceDirectory,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: repositoryRoot,
      env: commandEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
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

test('maintainer can preview one dining place and visitors can open its stable detail URL', async ({ page }) => {
  await page.goto(siteUrl)

  await expect(page.getByRole('heading', { name: 'CUHKSZ Eats' })).toBeVisible()
  const placeCard = page.getByRole('link', { name: /测试餐饮地点/ })
  await expect(placeCard).toBeVisible()
  await expect(placeCard.getByRole('img', { name: '测试餐饮地点' })).toBeVisible()

  await placeCard.click()
  await expect(page).toHaveURL(`${siteUrl}/places/%E6%B5%8B%E8%AF%95%E9%A4%90%E9%A5%AE%E5%9C%B0%E7%82%B9`)
  await expect(page.getByRole('heading', { name: '测试餐饮地点' })).toBeVisible()

  await page.goto(`${siteUrl}/places/%E6%B5%8B%E8%AF%95%E9%A4%90%E9%A5%AE%E5%9C%B0%E7%82%B9`)
  await expect(page.getByRole('heading', { name: '测试餐饮地点' })).toBeVisible()
  await expect(page.getByRole('img', { name: '测试餐饮地点' })).toBeVisible()
  expect(digest(await readFile(sourcePhoto))).toBe(sourcePhotoDigest)
})
