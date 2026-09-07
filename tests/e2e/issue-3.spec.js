import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const pythonCommand = 'uv'
const pythonArguments = ['run', '--frozen', 'python', 'manage.py']
const commandEnvironment = {
  ...process.env,
  UV_CACHE_DIR: path.join(repositoryRoot, '.generated', 'uv-cache'),
}
const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUzw9jYGBgYgADAAsLAPB8OPvJAAAAAElFTkSuQmCC',
  'base64',
)
const validHeif = Buffer.from(
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAAgAAAAEAAAACAAAAAf///8IAAAAC////wgAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAOG1kYXQAAAAsKAGvEyFeY0D4EPdn//c6MK8C7HpzshHQwNIggJtASJNdUAsWEICHdqVW3Pg=',
  'base64',
)

async function addPhoto(source, relativePath, contents = validPng) {
  const target = path.join(source, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function sourceDigest(source) {
  const hash = createHash('sha256')

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      hash.update(path.relative(source, target))
      if (entry.isDirectory()) await visit(target)
      else hash.update(await readFile(target))
    }
  }

  await visit(source)
  return hash.digest('hex')
}

function run(command, source, extraArguments = []) {
  return spawnSync(
    pythonCommand,
    [...pythonArguments, command, '--source', source, ...extraArguments],
    { cwd: repositoryRoot, encoding: 'utf8', env: commandEnvironment },
  )
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
    pythonCommand,
    [
      ...pythonArguments,
      'dev',
      '--source',
      source,
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
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited early (${child.exitCode}): ${output}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}`)
      if (response.ok) return { child, output: () => output }
    } catch {
      // The preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill('SIGTERM')
  throw new Error(`timed out waiting for dev: ${output}`)
}

async function stopDev(child) {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

test('supported image suffixes and known operating-system files pass through the public check command', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-3-valid-'))
  try {
    for (const [index, suffix] of ['JpG', 'JPEG', 'PNG', 'WebP'].entries()) {
      await addPhoto(source, `测试餐饮地点/IMG_20260907_12000${index}.${suffix}`)
    }
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120004.HEIC', validHeif)
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120005.heif', validHeif)
    await addPhoto(source, '测试餐饮地点/测试档口/IMG_20260907_120006.png')
    await writeFile(path.join(source, '.DS_Store'), 'ignored')
    await writeFile(path.join(source, 'Thumbs.db'), 'ignored')
    const before = await sourceDigest(source)

    const result = run('check', source)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('检查通过：1 个餐饮地点，7 张图片。')
    expect(result.stderr).toBe('')
    expect(await sourceDigest(source)).toBe(before)
  } finally {
    await rm(source, { recursive: true, force: true })
  }
})

test('every maintenance command reports the same blocking diagnostics and stops before its next phase', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-3-errors-'))
  try {
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120000-菜品.jpg')
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120000-另一菜品.png')
    await addPhoto(source, '测试餐饮地点/档口/更深目录/IMG_20260907_120001.png')
    await addPhoto(source, '测试餐饮地点/坏图.jpg', Buffer.from('not an image'))
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120002--18.jpg')
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120003-菜品-.jpg')
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120004-菜品-¥18.jpg')
    await addPhoto(source, '测试餐饮地点/IMG_20260907_120005-菜单-18.jpg')
    await writeFile(path.join(source, '测试餐饮地点', '说明.txt'), 'unsupported')
    const before = await sourceDigest(source)

    const results = ['check', 'dev', 'publish'].map((command) => ({ command, result: run(command, source) }))

    for (const { command, result } of results) {
      const diagnostics = result.stderr
      expect(result.status, `${command}: ${result.stdout}\n${result.stderr}`).toBe(1)
      expect(diagnostics).toContain('错误：[测试餐饮地点/说明.txt] 不支持的文件类型')
      expect(diagnostics).toContain('错误：[测试餐饮地点/档口/更深目录] 非法目录深度')
      expect(diagnostics).toContain('错误：[测试餐饮地点/IMG_20260907_120000-菜品.jpg] 源前缀“IMG_20260907_120000”在同一归属内重名')
      expect(diagnostics).toContain('错误：[测试餐饮地点/坏图.jpg] 图片已损坏或无法解码')
      expect(diagnostics).toContain('错误：[测试餐饮地点/IMG_20260907_120002--18.jpg] 菜品名称不能为空')
      expect(diagnostics).toContain('错误：[测试餐饮地点/IMG_20260907_120003-菜品-.jpg] 结构化字段为空')
      expect(diagnostics).toContain('错误：[测试餐饮地点/IMG_20260907_120004-菜品-¥18.jpg] 菜品价格“¥18”非法')
      expect(diagnostics).toContain('错误：[测试餐饮地点/IMG_20260907_120005-菜单-18.jpg] 保留类型“菜单”不能包含价格或附言字段')
      expect(diagnostics).toContain('修正示例：')
      expect(diagnostics).toContain('检查失败：')
      expect(result.stdout).not.toContain('已生成一次性本地内容')
      expect(result.stdout).not.toContain('准备发布')
    }
    const diagnosticLines = ({ stderr }) => stderr
      .split('\n')
      .filter((line) => line.startsWith('错误：') || line.startsWith('警告：'))
    expect(diagnosticLines(results[1].result)).toEqual(diagnosticLines(results[0].result))
    expect(diagnosticLines(results[2].result)).toEqual(diagnosticLines(results[0].result))
    expect(await sourceDigest(source)).toBe(before)
  } finally {
    await rm(source, { recursive: true, force: true })
  }
})

test('warnings are actionable and do not block check, preview, or the publish gate', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'cuhksz-eats-issue-3-warnings-'))
  let dev
  try {
    await addPhoto(source, ' 测试餐饮地点 /opaque-菜品.jpg')
    await addPhoto(source, ' 测试餐饮地点 /IMG_20260907_120000_菜单.jpg')
    await addPhoto(source, ' 测试餐饮地点 /IMG_20260907_120001 菜品 18元.jpg')
    await addPhoto(source, ' 测试餐饮地点 /IMG_20260907_120002- 菜品 -18.jpg')
    const before = await sourceDigest(source)

    const check = run('check', source)
    expect(check.status, check.stderr).toBe(0)
    expect(check.stderr).toContain('警告：[ 测试餐饮地点 ] 名称包含首尾空格')
    expect(check.stderr).toContain('警告：[ 测试餐饮地点 /opaque-菜品.jpg] 无法从源前缀“opaque”解析拍摄时间')
    expect(check.stderr).toContain('警告：[ 测试餐饮地点 /IMG_20260907_120000_菜单.jpg] 疑似使用旧结构命名')
    expect(check.stderr).toContain('警告：[ 测试餐饮地点 /IMG_20260907_120001 菜品 18元.jpg] 疑似想表达结构化内容')
    expect(check.stderr).toContain('警告：[ 测试餐饮地点 /IMG_20260907_120002- 菜品 -18.jpg] 结构化名称字段包含首尾空格')
    expect(check.stderr).toContain('修正示例：')
    expect(check.stdout).toContain('检查通过：1 个餐饮地点，4 张图片，5 个警告。')

    dev = await startDev(source)
    expect(dev.output()).toContain('已生成一次性本地内容')
    await stopDev(dev.child)
    dev = undefined

    const publish = run('publish', source)
    expect(publish.status).toBe(1)
    expect(publish.stderr).toContain('警告：')
    expect(publish.stdout).toContain('已通过校验，准备发布')
    expect(publish.stderr).toContain('发布阶段将在 Issue #10 实现')
    expect(await sourceDigest(source)).toBe(before)
  } finally {
    if (dev) await stopDev(dev.child)
    await rm(source, { recursive: true, force: true })
  }
})
