import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUzw9jYGBgYgADAAsLAPB8OPvJAAAAAElFTkSuQmCC',
  'base64',
)

function run(command, arguments_, options = {}) {
  const result = execute(command, arguments_, options)
  expect(result.status, `${command} ${arguments_.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result
}

function execute(command, arguments_, options = {}) {
  return spawnSync(command, arguments_, { encoding: 'utf8', ...options })
}

async function prepareRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-10-'))
  const checkout = path.join(root, 'checkout')
  const remote = path.join(root, 'cuhksz-eats.git')
  await mkdir(checkout)
  for (const relativePath of [
    'index.html', 'manage.py', 'package.json', 'package-lock.json', 'pyproject.toml', 'uv.lock',
    'vite.config.js', 'README.md', 'LICENSE.md', '.gitignore', 'src', 'scripts',
  ]) {
    await cp(path.join(repositoryRoot, relativePath), path.join(checkout, relativePath), { recursive: true })
  }
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(checkout, 'node_modules'))
  await mkdir(path.join(checkout, 'images', '测试餐饮地点', '测试档口'), { recursive: true })
  await writeFile(
    path.join(checkout, 'images', '测试餐饮地点', 'IMG_20260907_120000-地点菜品-18.png'),
    fixturePng,
  )
  await writeFile(
    path.join(checkout, 'images', '测试餐饮地点', '测试档口', 'IMG_20260907_120001-档口菜品-20.png'),
    fixturePng,
  )
  await writeFile(path.join(checkout, 'images', '测试餐饮地点', 'opaque.png'), fixturePng)

  run('git', ['init', '--bare', remote])
  run('git', ['init', '-b', 'main'], { cwd: checkout })
  run('git', ['config', 'user.name', 'Issue 10 Test'], { cwd: checkout })
  run('git', ['config', 'user.email', 'issue-10@example.test'], { cwd: checkout })
  run('git', ['remote', 'add', 'origin', remote], { cwd: checkout })
  run('git', ['add', '.'], { cwd: checkout })
  run('git', ['commit', '-m', 'test main'], { cwd: checkout })
  run('git', ['push', '-u', 'origin', 'main'], { cwd: checkout })
  return { root, checkout, remote }
}

async function publishedFiles(remote, root) {
  const published = path.join(root, `published-${Date.now()}`)
  run('git', ['clone', '--branch', 'gh-pages', '--single-branch', remote, published])

  async function visit(directory) {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await visit(target))
      else files.push(path.relative(published, target))
    }
    return files
  }

  return { directory: published, files: (await visit(published)).sort() }
}

function zipEntries(archive) {
  const script = 'import json, sys, zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))'
  return JSON.parse(run(
    path.join(repositoryRoot, '.venv', 'bin', 'python'), ['-c', script, archive],
  ).stdout)
}

async function servePublished(directory) {
  const server = createHttpServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (!pathname.startsWith('/cuhksz-eats/')) {
      response.writeHead(404).end()
      return
    }
    let target = path.join(directory, pathname.slice('/cuhksz-eats/'.length))
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html')
      const body = await readFile(target)
      response.writeHead(200, {
        'content-type': target.endsWith('.html')
          ? 'text/html'
          : target.endsWith('.json')
            ? 'application/json'
            : target.endsWith('.css')
              ? 'text/css'
              : target.endsWith('.webp')
                ? 'image/webp'
                : 'text/javascript',
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, rootUrl: `http://127.0.0.1:${server.address().port}/cuhksz-eats/` }
}

test('one public command publishes only a complete sanitized static site to gh-pages', async ({ page }) => {
  test.slow()
  const fixture = await prepareRepository()
  try {
    const result = run(path.join(repositoryRoot, '.venv', 'bin', 'python'), [
      'manage.py', 'publish', '--base-path', '/cuhksz-eats/',
    ], {
      cwd: fixture.checkout,
      env: process.env,
    })
    expect(result.stdout).toContain('发布完成')
    expect(result.stderr).toContain('警告：[测试餐饮地点/opaque.png]')

    const archive = path.join(fixture.checkout, 'images.zip')
    expect(result.stdout).toContain('已创建本地原图归档：images.zip')
    expect(zipEntries(archive).sort()).toEqual([
      'images/测试餐饮地点/IMG_20260907_120000-地点菜品-18.png',
      'images/测试餐饮地点/opaque.png',
      'images/测试餐饮地点/测试档口/IMG_20260907_120001-档口菜品-20.png',
    ].sort())
    expect(run('git', ['check-ignore', 'images.zip'], { cwd: fixture.checkout }).stdout.trim())
      .toBe('images.zip')
    const archiveBefore = await stat(archive)
    const unchanged = run(path.join(repositoryRoot, '.venv', 'bin', 'python'), ['manage.py', 'publish'], {
      cwd: fixture.checkout,
      env: process.env,
    })
    expect(unchanged.stdout).toContain('原图内容未变化，保留本地归档：images.zip')
    expect((await stat(archive)).mtimeMs).toBe(archiveBefore.mtimeMs)

    const published = await publishedFiles(fixture.remote, fixture.root)
    expect(published.files).toContain('index.html')
    expect(published.files).toContain('404.html')
    expect(published.files).toContain('content.json')
    expect(published.files).toContain('places/测试餐饮地点/index.html')
    expect(published.files).toContain('places/测试餐饮地点/stalls/测试档口/index.html')
    expect(published.files).toContain('places/测试餐饮地点/dishes/地点菜品/index.html')
    expect(published.files).toContain('places/测试餐饮地点/stalls/测试档口/dishes/档口菜品/index.html')
    expect(published.files.some((file) => /^media\/photo-[a-f0-9]{16}-\d+w\.webp$/.test(file))).toBe(true)
    expect(published.files.some((file) => file.startsWith('src/'))).toBe(false)
    expect(published.files).not.toContain('manage.py')
    expect(published.files.some((file) => /\.(png|jpe?g|heic|heif)$/i.test(file))).toBe(false)
    expect(JSON.parse(await readFile(path.join(published.directory, 'content.json'), 'utf8')).searchIndex)
      .toHaveLength(4)
    expect(await readFile(path.join(published.directory, 'index.html'), 'utf8'))
      .toMatch(/["']\/cuhksz-eats\/assets\//)
    expect((await lstat(path.join(fixture.checkout, 'images'))).isDirectory()).toBe(true)

    const site = await servePublished(published.directory)
    try {
      for (const [route, heading] of [
        ['', 'CUHKSZ Eats'],
        ['places/测试餐饮地点/', '测试餐饮地点'],
        ['places/测试餐饮地点/stalls/测试档口/', '测试档口'],
        ['places/测试餐饮地点/dishes/地点菜品/', '地点菜品'],
      ]) {
        await page.goto(`${site.rootUrl}${route}`)
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      }
      await expect(page.getByRole('img').first()).toHaveAttribute('src', /\/cuhksz-eats\/media\//)
    } finally {
      await new Promise((resolve) => site.server.close(resolve))
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a blocking validation error leaves the existing deployment unchanged', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const archive = path.join(fixture.checkout, 'images.zip')
    const archiveBefore = await readFile(archive)
    const deployedBefore = run(
      'git', ['--git-dir', fixture.remote, 'rev-parse', 'refs/heads/gh-pages'],
    ).stdout.trim()
    await writeFile(path.join(fixture.checkout, 'images', '测试餐饮地点', '不支持.txt'), 'private')

    const failed = execute(python, ['manage.py', 'publish'], {
      cwd: fixture.checkout,
      env: process.env,
    })

    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('错误：[测试餐饮地点/不支持.txt] 不支持的文件类型')
    expect(failed.stdout).not.toContain('正在生成去敏公开内容')
    expect(await readFile(archive)).toEqual(archiveBefore)
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'refs/heads/gh-pages']).stdout.trim())
      .toBe(deployedBefore)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a later publish replaces removed content and keeps generated history bounded', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const archive = path.join(fixture.checkout, 'images.zip')
    const firstArchive = await readFile(archive)
    const first = await publishedFiles(fixture.remote, fixture.root)
    const firstMedia = first.files.filter((file) => file.startsWith('media/'))
    const mainBefore = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'refs/heads/main']).stdout.trim()

    await rm(path.join(fixture.checkout, 'images'), { recursive: true, force: true })
    await mkdir(path.join(fixture.checkout, 'images', '全新餐饮地点'), { recursive: true })
    await writeFile(
      path.join(fixture.checkout, 'images', '全新餐饮地点', 'IMG_20260907_130000-全新菜品-22.png'),
      fixturePng,
    )
    const replacement = run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    expect(replacement.stdout).toContain('已更新本地原图归档：images.zip')
    expect(await readFile(archive)).not.toEqual(firstArchive)
    expect(zipEntries(archive)).toEqual([
      'images/全新餐饮地点/IMG_20260907_130000-全新菜品-22.png',
    ])

    const second = await publishedFiles(fixture.remote, fixture.root)
    const secondMedia = second.files.filter((file) => file.startsWith('media/'))
    expect(second.files).toContain('places/全新餐饮地点/index.html')
    expect(second.files).toContain('places/全新餐饮地点/dishes/全新菜品/index.html')
    expect(second.files.some((file) => file.includes('测试餐饮地点'))).toBe(false)
    expect(firstMedia.every((file) => !secondMedia.includes(file))).toBe(true)
    expect(run('git', ['--git-dir', fixture.remote, 'rev-list', '--count', 'gh-pages']).stdout.trim()).toBe('1')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'refs/heads/main']).stdout.trim())
      .toBe(mainBefore)
    expect(run('git', ['--git-dir', fixture.remote, 'ls-tree', '-r', '--name-only', 'main']).stdout)
      .not.toContain('images/')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
