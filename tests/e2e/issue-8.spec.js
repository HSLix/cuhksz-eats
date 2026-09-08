import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
const disclaimer = 'CUHKSZ Eats 是由个人独立维护的非官方网站，与香港中文大学（深圳）及站内所列商户无隶属、授权或认可关系。内容仅记录特定时间的个人用餐与实拍信息，不代表校方或商户的实时菜单、价格及承诺，请以现场和官方信息为准。'
const menuNotice = '菜单图片为档口公开展示区域拍摄的现场记录，仅用于帮助了解历史菜品与价格；菜单可能随时调整，请以档口现场信息为准。如相关权利人希望移除或更正，请通过页脚邮箱联系。'

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
  sourceDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-8-'))
  await addPhoto('测试餐饮地点/IMG_20260907_090000-菜单.png')
  await addPhoto('测试餐饮地点/IMG_20260907_100000-测试菜品-18-个人口味.png')

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

test('home shows the complete identity, freshness, rights, and single contact notices', async ({ page }) => {
  await page.goto(siteUrl)

  await expect(page.locator('.hero').getByText(disclaimer, { exact: true })).toBeVisible()
  await expect(page.locator('.site-footer').getByText(disclaimer, { exact: true })).toBeVisible()
  await expect(page.getByText('图片由 CUHKSZ Eats 提供；版权仍属于原摄影者。')).toBeVisible()
  await expect(page.getByText('MIT License 仅适用于程序代码；网站文字、原始照片及生成衍生图不在授权范围内。')).toBeVisible()

  const contact = page.getByRole('link', { name: 'l0123i456@163.com' })
  await expect(contact).toHaveCount(1)
  await expect(contact).toHaveAttribute('href', 'mailto:l0123i456@163.com')
  await expect(page.locator('form')).toHaveCount(0)
})

test('direct detail links retain the footer boundary, note label, and image rights data', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E6%B5%8B%E8%AF%95%E9%A4%90%E9%A5%AE%E5%9C%B0%E7%82%B9/dishes/%E6%B5%8B%E8%AF%95%E8%8F%9C%E5%93%81`)

  await expect(page.getByRole('heading', { name: '测试菜品' })).toBeVisible()
  await expect(page.getByText('记录者随记：个人口味')).toBeVisible()
  await expect(page.locator('.site-footer').getByText(disclaimer, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'l0123i456@163.com' })).toHaveAttribute('href', 'mailto:l0123i456@163.com')
  await expect(page.locator('[itemtype="https://schema.org/ImageObject"] meta[itemprop="creditText"]').first())
    .toHaveAttribute('content', 'CUHKSZ Eats 提供')
  await expect(page.locator('[itemtype="https://schema.org/ImageObject"] meta[itemprop="copyrightNotice"]').first())
    .toHaveAttribute('content', '版权仍属于原摄影者。')
})

test('every menu viewer puts the complete historical-record and footer-contact notice at the top', async ({ page }) => {
  await page.goto(`${siteUrl}/places/%E6%B5%8B%E8%AF%95%E9%A4%90%E9%A5%AE%E5%9C%B0%E7%82%B9`)
  await page.getByRole('button', { name: '放大查看菜单照片' }).click()

  const viewer = page.getByRole('dialog', { name: '菜单照片查看器' })
  await expect(viewer.getByText(menuNotice, { exact: true })).toBeVisible()
  await expect(viewer.locator('.viewer-notice')).toHaveText(menuNotice)
  await expect(viewer.getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'l0123i456@163.com' })).toHaveAttribute('href', 'mailto:l0123i456@163.com')
})

test('repository license grants MIT to code while excluding site content', async () => {
  const [license, readme] = await Promise.all([
    readFile(path.join(repositoryRoot, 'LICENSE.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'README.md'), 'utf8'),
  ])
  expect(license).toContain('MIT License')
  expect(license).toContain('applies only to the program source code')
  expect(license).toContain('website text, original photographs, or generated image')
  expect(readme).toContain('MIT 授权不适用于网站文字、`images/` 中的原始照片或构建生成的衍生图')
})
