import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { appendFile, cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
  run('git', ['add', '.', ':!node_modules'], { cwd: checkout })
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
    const deployedBefore = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
    const unchanged = run(path.join(repositoryRoot, '.venv', 'bin', 'python'), ['manage.py', 'publish'], {
      cwd: fixture.checkout,
      env: process.env,
    })
    expect(unchanged.stdout).toContain('原图内容未变化，保留本地归档：images.zip')
    expect((await stat(archive)).mtimeMs).toBe(archiveBefore.mtimeMs)
    expect(unchanged.stdout).toContain('发布内容未变化，跳过提交和推送。')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim())
      .toBe(deployedBefore)

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
    expect(published.files.filter((file) => /\.(png|jpe?g|heic|heif)$/i.test(file)))
      .toEqual([expect.stringMatching(/^assets\/campus-map-[\w-]+\.jpg$/)])
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

test('a later publish removes old content and inherits the previous deployment', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const archive = path.join(fixture.checkout, 'images.zip')
    const firstArchive = await readFile(archive)
    const first = await publishedFiles(fixture.remote, fixture.root)
    const firstCommit = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
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
    expect(run('git', ['--git-dir', fixture.remote, 'rev-list', '--count', 'gh-pages']).stdout.trim()).toBe('2')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages^']).stdout.trim()).toBe(firstCommit)
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'refs/heads/main']).stdout.trim())
      .toBe(mainBefore)
    expect(run('git', ['--git-dir', fixture.remote, 'ls-tree', '-r', '--name-only', 'main']).stdout)
      .not.toContain('images/')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a fresh checkout fetches the previous deployment from the push URL and reuses image objects', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['-c',
      'from PIL import Image; import random, sys; Image.frombytes("RGB", (512, 512), random.Random(0).randbytes(512 * 512 * 3)).save(sys.argv[1])',
      path.join(fixture.checkout, 'images', '测试餐饮地点', 'large.png'),
    ])
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const firstCommit = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
    const firstFiles = run('git', ['--git-dir', fixture.remote, 'ls-tree', '-r', 'gh-pages', 'media/']).stdout

    const fresh = path.join(fixture.root, 'fresh')
    run('git', ['clone', '--single-branch', '--branch', 'main', fixture.remote, fresh])
    run('git', ['config', 'user.name', 'Issue 10 Test'], { cwd: fresh })
    run('git', ['config', 'user.email', 'issue-10@example.test'], { cwd: fresh })
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(fresh, 'node_modules'))
    await cp(path.join(fixture.checkout, 'images'), path.join(fresh, 'images'), { recursive: true })
    run('git', ['remote', 'set-url', '--push', 'origin', fixture.remote], { cwd: fresh })
    run('git', ['remote', 'set-url', 'origin', path.join(fixture.root, 'missing-fetch.git')], { cwd: fresh })
    await writeFile(path.join(fresh, 'index.html'), `${await readFile(path.join(fresh, 'index.html'), 'utf8')}\n<!-- updated -->\n`)
    run(python, ['manage.py', 'publish'], { cwd: fresh, env: process.env })

    const secondCommit = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages^']).stdout.trim()).toBe(firstCommit)
    expect(run('git', ['--git-dir', fixture.remote, 'ls-tree', '-r', 'gh-pages', 'media/']).stdout).toBe(firstFiles)
    const incrementalPack = spawnSync('git', ['pack-objects', '--revs', '--stdout'], {
      cwd: fresh, input: `${secondCommit}\n^${firstCommit}\n`,
    })
    const fullPack = spawnSync('git', ['pack-objects', '--revs', '--stdout'], {
      cwd: fresh, input: `${secondCommit}\n`, maxBuffer: 8 * 1024 * 1024,
    })
    expect(incrementalPack.status).toBe(0)
    expect(fullPack.status).toBe(0)
    expect(incrementalPack.stdout.length).toBeLessThan(fullPack.stdout.length / 10)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('lookup and fetch failures stop publication without changing the deployment', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const before = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
    const fetchFailed = execute(python, ['-c', `
import subprocess
from unittest.mock import patch
from src.cuhksz_eats import cli
original_run = subprocess.run
def fail_fetch(command, **kwargs):
    if command[1] == "fetch":
        raise subprocess.CalledProcessError(128, command, stderr="simulated fetch failure")
    return original_run(command, **kwargs)
with patch.object(subprocess, "run", side_effect=fail_fetch):
    raise SystemExit(cli.run_publish(cli.DEFAULT_SOURCE))
`], { cwd: fixture.checkout, env: process.env })
    expect(fetchFailed.status).toBe(1)
    expect(fetchFailed.stderr).toContain('simulated fetch failure')
    expect(fetchFailed.stdout).not.toContain('发布完成')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()).toBe(before)
    run('git', ['remote', 'set-url', '--push', 'origin', path.join(fixture.root, 'missing.git')], {
      cwd: fixture.checkout,
    })
    const failed = execute(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('发布失败')
    expect(failed.stdout).not.toContain('发布完成')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()).toBe(before)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a concurrent deployment is preserved when the push is rejected', async () => {
  test.slow()
  const fixture = await prepareRepository()
  const python = path.join(repositoryRoot, '.venv', 'bin', 'python')
  try {
    run(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    const before = run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages']).stdout.trim()
    await writeFile(path.join(fixture.checkout, 'index.html'), `${await readFile(path.join(fixture.checkout, 'index.html'), 'utf8')}\n<!-- local update -->\n`)
    // Advance the remote during the build, after publish has selected its parent.
    await appendFile(path.join(fixture.checkout, 'scripts', 'generate-static-routes.mjs'), `
import { execFileSync } from 'node:child_process'
const remoteGit = ['--git-dir', ${JSON.stringify(fixture.remote)}]
const remoteTree = execFileSync('git', [...remoteGit, 'rev-parse', 'gh-pages^{tree}'], { encoding: 'utf8' }).trim()
const concurrent = execFileSync('git', [...remoteGit, '-c', 'user.name=Concurrent', '-c', 'user.email=concurrent@example.test', 'commit-tree', remoteTree, '-p', ${JSON.stringify(before)}, '-m', 'Concurrent deployment'], { encoding: 'utf8' }).trim()
execFileSync('git', [...remoteGit, 'update-ref', 'refs/heads/gh-pages', concurrent])
`)
    const failed = execute(python, ['manage.py', 'publish'], { cwd: fixture.checkout, env: process.env })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('不要强制推送')
    expect(failed.stdout).not.toContain('发布完成')
    expect(run('git', ['--git-dir', fixture.remote, 'log', '-1', '--format=%s', 'gh-pages']).stdout.trim())
      .toBe('Concurrent deployment')
    expect(run('git', ['--git-dir', fixture.remote, 'rev-parse', 'gh-pages^']).stdout.trim()).toBe(before)
    expect(run('git', ['--git-dir', fixture.remote, 'rev-list', '--count', 'gh-pages']).stdout.trim()).toBe('2')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
