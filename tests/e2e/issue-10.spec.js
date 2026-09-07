import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUzw9jYGBgYgADAAsLAPB8OPvJAAAAAElFTkSuQmCC',
  'base64',
)

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', ...options })
  expect(result.status, `${command} ${arguments_.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result
}

async function prepareRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-10-'))
  const checkout = path.join(root, 'checkout')
  const remote = path.join(root, 'remote.git')
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

test('one public command publishes only a complete sanitized static site to gh-pages', async () => {
  test.slow()
  const fixture = await prepareRepository()
  try {
    const result = run('uv', ['run', '--frozen', 'python', 'manage.py', 'publish'], {
      cwd: fixture.checkout,
      env: {
        ...process.env,
        UV_CACHE_DIR: path.join(repositoryRoot, '.generated', 'uv-cache'),
      },
    })
    expect(result.stdout).toContain('发布完成')

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
    expect((await lstat(path.join(fixture.checkout, 'images'))).isDirectory()).toBe(true)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
