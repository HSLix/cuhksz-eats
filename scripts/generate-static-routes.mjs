import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputDirectory = path.resolve('dist')
const [indexHtml, content] = await Promise.all([
  readFile(path.join(outputDirectory, 'index.html'), 'utf8'),
  readFile(path.join(outputDirectory, 'content.json'), 'utf8').then(JSON.parse),
])

function contentPaths() {
  if (content.searchIndex) return content.searchIndex.map((entry) => entry.path)

  return content.places.flatMap((place) => {
    const placePath = `/places/${place.slug}`
    return [
      placePath,
      ...place.dishes.map((dish) => `${placePath}/dishes/${dish.slug}`),
      ...place.stalls.flatMap((stall) => {
        const stallPath = `${placePath}/stalls/${stall.slug}`
        return [
          stallPath,
          ...stall.dishes.map((dish) => `${stallPath}/dishes/${dish.slug}`),
        ]
      }),
    ]
  })
}

const paths = new Set(contentPaths())
for (const routePath of paths) {
  const routeDirectory = path.join(outputDirectory, ...routePath.split('/').filter(Boolean))
  await mkdir(routeDirectory, { recursive: true })
  await writeFile(path.join(routeDirectory, 'index.html'), indexHtml, 'utf8')
}

await writeFile(path.join(outputDirectory, '404.html'), indexHtml, 'utf8')
console.log(`已生成 ${paths.size} 个静态详情入口及 404 回退。`)
