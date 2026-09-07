import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const commandEnvironment = {
  ...process.env,
  UV_CACHE_DIR: path.join(repositoryRoot, '.generated', 'uv-cache'),
}

async function sourceDigest(source) {
  const hash = createHash('sha256')
  for (const name of await readdir(path.join(source, '响应式地点'))) {
    hash.update(name)
    hash.update(await readFile(path.join(source, '响应式地点', name)))
  }
  return hash.digest('hex')
}

function createSourceImages(source) {
  const script = String.raw`
from pathlib import Path
import sys
from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()
target = Path(sys.argv[1]) / "响应式地点"
target.mkdir(parents=True)

def metadata():
    exif = Image.Exif()
    exif[271] = "Secret Camera Company"
    exif[272] = "Secret Phone Model"
    gps = exif.get_ifd(34853)
    gps[1] = "N"
    gps[2] = (22.0, 36.0, 0.0)
    exif[34853] = gps
    return exif

formats = [
    ("IMG_20260907_120000-菜品-18.jpg", "JPEG"),
    ("IMG_20260907_120001.png", "PNG"),
    ("IMG_20260907_120002.webp", "WEBP"),
    ("IMG_20260907_120003.heic", "HEIF"),
    ("IMG_20260907_120004.heif", "HEIF"),
]
for index, (name, image_format) in enumerate(formats):
    image = Image.new("RGB", (1600, 1200), (40 + index * 20, 90, 120))
    options = {"format": image_format}
    if image_format in {"JPEG", "WEBP"}:
        options["exif"] = metadata()
    image.save(target / name, **options)

menu = Image.new("RGB", (2400, 1600), "white")
for y in range(100, 1500, 100):
    for x in range(100, 2300):
        menu.putpixel((x, y), (20, 20, 20))
menu.save(target / "IMG_20260907_120005-菜单.jpg", format="JPEG", exif=metadata())
`
  const result = spawnSync(
    'uv',
    ['run', '--frozen', 'python', '-c', script, source],
    { cwd: repositoryRoot, env: commandEnvironment, encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
}

function replaceDishSource(source) {
  const script = 'from PIL import Image; import sys; Image.new("RGB", (1600, 1200), "navy").save(sys.argv[1], format="JPEG")'
  const result = spawnSync(
    'uv',
    ['run', '--frozen', 'python', '-c', script, path.join(source, '响应式地点', 'IMG_20260907_120000-菜品-18.jpg')],
    { cwd: repositoryRoot, env: commandEnvironment, encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
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

async function startDev(source) {
  const port = await reservePort()
  const child = spawn(
    'uv',
    ['run', '--frozen', 'python', '-u', 'manage.py', 'dev', '--source', source, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repositoryRoot, env: commandEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const siteUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited early (${child.exitCode}): ${output}`)
    try {
      if ((await fetch(siteUrl)).ok) return { child, siteUrl, output: () => output }
    } catch {
      // The preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill('SIGTERM')
  throw new Error(`timed out waiting for dev: ${output}`)
}

async function stopDev(dev) {
  if (dev?.child.exitCode === null) {
    dev.child.kill('SIGTERM')
    await new Promise((resolve) => dev.child.once('exit', resolve))
  }
}

async function mediaModificationTimes() {
  const media = path.join(repositoryRoot, '.generated', 'dev', 'public', 'media')
  return Object.fromEntries(await Promise.all((await readdir(media)).map(async (name) => [name, (await stat(path.join(media, name))).mtimeMs])))
}

test('unchanged image derivatives are reused from the incremental cache', async () => {
  test.slow()
  const source = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-6-cache-'))
  let dev
  try {
    createSourceImages(source)
    dev = await startDev(source)
    const content = await (await fetch(`${dev.siteUrl}/content.json`)).json()
    const changedFiles = new Set(
      content.places[0].photos.find((photo) => photo.kind === 'dish').sources
        .map((sourceItem) => path.basename(sourceItem.src)),
    )
    const firstTimes = await mediaModificationTimes()
    await stopDev(dev)

    dev = await startDev(source)
    const secondTimes = await mediaModificationTimes()
    expect(secondTimes).toEqual(firstTimes)
    expect(dev.output()).toContain('复用')
    await stopDev(dev)

    replaceDishSource(source)
    dev = await startDev(source)
    const thirdTimes = await mediaModificationTimes()
    for (const [name, modifiedAt] of Object.entries(thirdTimes)) {
      if (changedFiles.has(name)) expect(modifiedAt).not.toBe(secondTimes[name])
      else expect(modifiedAt).toBe(secondTimes[name])
    }
  } finally {
    await stopDev(dev)
    await rm(source, { recursive: true, force: true })
  }
})

async function inspectDerivatives(mediaDirectory) {
  const script = String.raw`
import json
from pathlib import Path
import sys
from PIL import Image

result = []
for path in sorted(Path(sys.argv[1]).iterdir()):
    with Image.open(path) as image:
        exif = image.getexif()
        result.append({
            "name": path.name,
            "format": image.format,
            "size": image.size,
            "exif": {str(key): value for key, value in exif.items()},
            "gps": dict(exif.get_ifd(34853)),
            "xmp": image.info.get("xmp", b"").decode("utf-8"),
        })
print(json.dumps(result, ensure_ascii=False))
`
  const result = spawnSync(
    'uv',
    ['run', '--frozen', 'python', '-c', script, mediaDirectory],
    { cwd: repositoryRoot, env: commandEnvironment, encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

test('public image output is responsive, WebP-only, sanitized, credited, and menu-readable', async ({ page }) => {
  const source = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-6-'))
  let dev
  try {
    createSourceImages(source)
    const before = await sourceDigest(source)
    dev = await startDev(source)

    const content = await (await fetch(`${dev.siteUrl}/content.json`)).json()
    const photos = content.places[0].photos
    expect(photos).toHaveLength(6)
    for (const photo of photos) {
      expect(photo.src).toMatch(/^\/media\/photo-[a-f0-9]{16}-\d+w\.webp$/)
      expect(photo.sources.length).toBeGreaterThanOrEqual(2)
      expect(photo.sources.every((sourceItem) => sourceItem.src.endsWith('.webp'))).toBe(true)
      expect(photo.creditText).toBe('CUHKSZ Eats 提供')
      expect(photo.copyrightNotice).toBe('版权仍属于原摄影者。')
    }

    const menu = photos.find((photo) => photo.kind === 'menu')
    expect(Math.max(...menu.sources.map((sourceItem) => sourceItem.width))).toBe(2400)
    const derivatives = await inspectDerivatives(path.join(repositoryRoot, '.generated', 'dev', 'public', 'media'))
    expect(derivatives).toHaveLength(18)
    for (const derivative of derivatives) {
      expect(derivative.format).toBe('WEBP')
      expect(derivative.exif).toEqual({})
      expect(derivative.gps).toEqual({})
      expect(derivative.xmp).toContain('<photoshop:Credit>CUHKSZ Eats 提供</photoshop:Credit>')
      expect(derivative.xmp).toContain('<rdf:li>CUHKSZ Eats 提供</rdf:li>')
      expect(derivative.xmp).toContain('版权仍属于原摄影者。')
      expect(JSON.stringify(derivative)).not.toContain('Secret')
    }

    expect(await sourceDigest(source)).toBe(before)
    const publicUrls = photos.flatMap((photo) => [photo.src, ...photo.sources.map((sourceItem) => sourceItem.src)])
    expect(publicUrls.every((url) => /^\/media\/photo-[a-f0-9]{16}-\d+w\.webp$/.test(url))).toBe(true)
    expect(derivatives.every((derivative) => /^photo-[a-f0-9]{16}-\d+w\.webp$/.test(derivative.name))).toBe(true)

    await page.goto(`${dev.siteUrl}/places/%E5%93%8D%E5%BA%94%E5%BC%8F%E5%9C%B0%E7%82%B9`)
    const menuImage = page.getByRole('img', { name: '菜单照片' })
    await expect(menuImage).toHaveAttribute('srcset', /720w.*1440w.*2400w/)
    await expect(menuImage).toHaveCSS('object-fit', 'contain')
    const dishThumbnailBox = await page.locator('.dish-card img').evaluate((image) => image.getBoundingClientRect().toJSON())
    expect(dishThumbnailBox.width).toBeLessThanOrEqual(360)
    expect(dishThumbnailBox.height).toBeCloseTo(dishThumbnailBox.width * 0.75, 0)
    await page.getByRole('button', { name: '放大查看菜单照片' }).click()
    const viewer = page.getByRole('dialog', { name: '菜单照片查看器' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole('img', { name: '菜单照片' })).toHaveJSProperty('naturalWidth', 2400)
    await page.getByRole('button', { name: '关闭照片查看器' }).click()

    await page.getByRole('button', { name: '查看照片：IMG_20260907_120001.png' }).click()
    const photoViewer = page.getByRole('dialog', { name: '照片查看器' })
    await expect(photoViewer.getByRole('img', { name: 'IMG_20260907_120001.png' })).toBeVisible()
    await page.getByRole('button', { name: '关闭照片查看器' }).click()

    await page.goto(dev.siteUrl)
    const placeCover = page.getByRole('link', { name: /响应式地点/ }).getByRole('img')
    await expect(placeCover).toHaveCSS('object-fit', 'contain')
    const coverBox = await placeCover.evaluate((image) => image.getBoundingClientRect().toJSON())
    expect(coverBox.height).toBeCloseTo(coverBox.width * 0.75, 0)
    expect(coverBox.height).toBeLessThan(400)
    await expect(page.getByText('图片由 CUHKSZ Eats 提供；版权仍属于原摄影者。')).toBeVisible()
    await expect(page.locator('[itemtype="https://schema.org/ImageObject"] meta[itemprop="creditText"]').first())
      .toHaveAttribute('content', 'CUHKSZ Eats 提供')
  } finally {
    await stopDev(dev)
    await rm(source, { recursive: true, force: true })
  }
})
