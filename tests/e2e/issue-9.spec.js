import { expect, test } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const websiteId = '123e4567-e89b-12d3-a456-426614174000'

let publicDirectory

async function build(environment = {}) {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CUHKSZ_EATS_PUBLIC_DIR: publicDirectory,
      CUHKSZ_EATS_UMAMI_WEBSITE_ID: '',
      ...environment,
    },
    encoding: 'utf8',
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

async function serveOutput() {
  const outputDirectory = path.join(repositoryRoot, 'dist')
  const server = createHttpServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let target = path.join(outputDirectory, pathname)
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html')
      const body = await readFile(target)
      response.writeHead(200, {
        'content-type': target.endsWith('.html')
          ? 'text/html'
          : target.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
      })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  }
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
  publicDirectory = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-9-'))
  await mkdir(publicDirectory, { recursive: true })
  await writeFile(
    path.join(publicDirectory, 'content.json'),
    JSON.stringify({ places: [], searchIndex: [], campusSupplementary: { photos: [], albums: [] } }),
  )
})

test.afterAll(async () => {
  if (publicDirectory) await rm(publicDirectory, { recursive: true, force: true })
})

test('configured production output sends anonymous aggregate visits and discloses their purpose', async ({ page }) => {
  await build({ CUHKSZ_EATS_UMAMI_WEBSITE_ID: websiteId })
  const { server, url } = await serveOutput()
  let analyticsRequests = 0
  await page.route('https://cloud.umami.is/script.js', async (route) => {
    analyticsRequests += 1
    await route.fulfill({ contentType: 'text/javascript', body: '' })
  })

  try {
    await page.goto(url)
    await expect(page.locator(`script[data-website-id="${websiteId}"]`))
      .toHaveAttribute('src', 'https://cloud.umami.is/script.js')
    await expect(page.getByText('本站使用 Umami Cloud 统计匿名汇总访问量，用于了解整体使用情况和改进网站；不用于广告统计、跨站追踪或 Cookie 型用户画像。'))
      .toBeVisible()
    expect(analyticsRequests).toBe(1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('invalid production configuration is ignored without blocking the site', async ({ page }) => {
  await build({ CUHKSZ_EATS_UMAMI_WEBSITE_ID: 'not-a-website-id' })
  const { server, url } = await serveOutput()

  try {
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'CUHKSZ Eats' })).toBeVisible()
    await expect(page.locator('script[src="https://cloud.umami.is/script.js"]')).toHaveCount(0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('production output without configuration remains browsable and does not load analytics', async ({ page }) => {
  await build()
  const { server, url } = await serveOutput()

  try {
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'CUHKSZ Eats' })).toBeVisible()
    await expect(page.locator('script[src="https://cloud.umami.is/script.js"]')).toHaveCount(0)
    await expect(page.getByText('本站使用 Umami Cloud 统计匿名汇总访问量，用于了解整体使用情况和改进网站；不用于广告统计、跨站追踪或 Cookie 型用户画像。'))
      .toBeVisible()
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('local development does not load analytics even when production configuration exists', async ({ page }) => {
  const port = await reservePort()
  const url = `http://127.0.0.1:${port}`
  const devServer = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CUHKSZ_EATS_PUBLIC_DIR: publicDirectory,
        CUHKSZ_EATS_UMAMI_WEBSITE_ID: websiteId,
      },
      stdio: 'ignore',
    },
  )

  try {
    await waitForSite(url, devServer)
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'CUHKSZ Eats' })).toBeVisible()
    await expect(page.locator('script[src="https://cloud.umami.is/script.js"]')).toHaveCount(0)
  } finally {
    if (devServer.exitCode === null) {
      devServer.kill('SIGTERM')
      await new Promise((resolve) => devServer.once('exit', resolve))
    }
  }
})
