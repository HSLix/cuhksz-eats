<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import campusMap from '../assets/campus-map.jpg'
import ResponsiveImage from '../components/ResponsiveImage.vue'
import SiteSearch from '../components/SiteSearch.vue'
import { loadContent } from '../content.js'

const content = ref(null)
const error = ref('')
// Developer-maintained head and tail positions (percent of image width/height).
const mapLocations = [
  { name: '海月廷 上园 思廷书院', x: 41, y: 19, tailX: 33, tailY: 18 },
  { name: '麦当劳（m记） 上园 学勤书院', x: 46, y: 24, tailX: 37, tailY: 35 },
  { name: '太清凉茶 上园 学勤书院', x: 50, y: 25, tailX: 57, tailY: 37 },
  { name: '东西南北风 上园 永平书院', x: 49, y: 13, tailX: 64, tailY: 16 },
  { name: '天猫超市 上园', x: 49, y: 13, tailX: 62, tailY: 24 },
  { name: '悠然居 学生中心1楼', x: 54, y: 68, tailX: 63, tailY: 60 },
  { name: '尚荷轩 学生中心2楼', x: 54, y: 63, tailX: 52, tailY: 55 },
  { name: '望湖楼 会议楼', x: 91, y: 71, tailX: 80, tailY: 62 },
  { name: '逸夫食堂 逸夫书院', x: 46, y: 63, tailX: 33, tailY: 55 },
  { name: '音乐学院食堂', x: 20, y: 40, tailX: 14, tailY: 65 },
]
const mappedPlaces = computed(() => mapLocations.flatMap((location) => {
  const place = content.value?.places.find((candidate) => candidate.name === location.name)
  return place ? [{ ...location, place, storefrontPhoto: place.photos.find((photo) => photo.kind === 'storefront') }] : []
}))

function formatDate(value) {
  if (!value) return '时间未知'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return `${year}年${month}月${day}日`
}

onMounted(async () => {
  try {
    content.value = await loadContent()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载本地内容'
  }
})
</script>

<template>
  <main>
    <section class="hero">
      <a
        class="hero-project-link"
        href="https://github.com/HSLix/cuhksz-eats"
        target="_blank"
        rel="noopener noreferrer"
      >开源项目 · GitHub <span aria-hidden="true">↗</span></a>
      <p class="eyebrow">非官方网站</p>
      <h1>CUHKSZ Eats</h1>
      <p class="hero-copy">用真实照片，认识校园里可以吃饭的地方。</p>
      <p class="hero-disclaimer">CUHKSZ Eats 是由个人独立维护的非官方网站，与香港中文大学（深圳）及站内所列商户无隶属、授权或认可关系。内容仅记录特定时间的个人用餐与实拍信息，不代表校方或商户的实时菜单、价格及承诺，请以现场和官方信息为准。</p>
      <SiteSearch v-if="content" :entries="content.searchIndex" />
    </section>

    <section v-if="mappedPlaces.length" class="campus-map-section" aria-labelledby="campus-map-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">按位置寻找</p>
          <h2 id="campus-map-heading">校园餐饮地图</h2>
        </div>
      </div>
      <p class="map-hint">将鼠标移到标记上查看收录内容，点击前往餐饮地点。小屏幕可左右滑动地图。</p>
      <div class="campus-map-scroll">
        <div class="campus-map">
          <img :src="campusMap" alt="香港中文大学（深圳）校园导览图，餐饮地点已用标记指出" width="2560" height="1549" />
          <svg class="map-pin-stems" viewBox="0 0 100 60.5078" preserveAspectRatio="none" aria-hidden="true">
            <g v-for="location in mappedPlaces" :key="location.name">
              <line :x1="location.tailX" :y1="location.tailY * 0.605078" :x2="location.x" :y2="location.y * 0.605078" />
            </g>
          </svg>
          <span
            v-for="location in mappedPlaces"
            :key="location.name"
            class="map-pin-head"
            :style="{ left: `${location.x}%`, top: `${location.y}%` }"
            aria-hidden="true"
          ></span>
          <RouterLink
            v-for="location in mappedPlaces"
            :key="location.name"
            class="map-pin"
            :class="{ 'map-pin--lower': location.tailY > 50, 'map-pin--right': location.tailX > 75, 'map-pin--photo': location.storefrontPhoto, 'map-pin--near-top': location.y < 20 }"
            :style="{ left: `${location.tailX}%`, top: `${location.tailY}%` }"
            :to="{ name: 'place', params: { slug: location.place.slug } }"
            :aria-label="`查看${location.place.name}，已收录${location.place.photoCount}张照片`"
          >
            <span class="map-pin-label">
              <ResponsiveImage v-if="location.storefrontPhoto" :photo="location.storefrontPhoto" :alt="`${location.place.name}门面照片`" sizes="120px" loading="lazy" />
              <strong>{{ location.place.name }}</strong>
            </span>
            <span class="map-pin-preview" aria-hidden="true">
              <span class="map-pin-summary">
                <span><strong>{{ location.place.name }}</strong><small>已收录 {{ location.place.photoCount }} 张照片</small></span>
              </span>
              <span v-if="location.place.stalls.length" class="map-pin-stalls">
                <span v-for="stall in location.place.stalls.slice(0, 3)" :key="stall.slug" class="map-pin-stall">
                  <ResponsiveImage v-if="stall.coverImage" :photo="stall.coverImage" :alt="stall.name" sizes="56px" loading="lazy" />
                  <span>{{ stall.name }}</span>
                </span>
                <small v-if="location.place.stalls.length > 3">另有 {{ location.place.stalls.length - 3 }} 个档口</small>
              </span>
              <span class="map-pin-action">查看地点 →</span>
            </span>
          </RouterLink>
        </div>
      </div>
      <p class="map-source">校园导览图图片来源：<a href="https://www.cuhk.edu.cn/zh-hans/page/4908" target="_blank" rel="noopener noreferrer">香港中文大学（深圳）官网</a>。标记位置仅供参考。</p>
    </section>

    <section class="directory" aria-labelledby="places-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">地点目录</p>
          <h2 id="places-heading">餐饮地点</h2>
        </div>
        <p v-if="content" class="count">{{ content.places.length }} 个地点</p>
      </div>

      <p v-if="error" class="state-message" role="alert">{{ error }}</p>
      <p v-else-if="!content" class="state-message">正在载入餐饮地点…</p>

      <div v-else class="place-grid">
        <RouterLink
          v-for="place in content.places"
          :key="place.slug"
          class="place-card"
          :to="{ name: 'place', params: { slug: place.slug } }"
        >
          <ResponsiveImage
            v-if="place.coverImage"
            :photo="place.coverImage"
            :alt="place.name"
            :title="place.coverTitle"
            sizes="(max-width: 720px) calc(100vw - 2.5rem), 33vw"
          />
          <div v-else class="cover-placeholder" role="img" :aria-label="`${place.name}暂无封面`">食</div>
          <div class="card-body">
            <div class="card-summary">
              <h3>{{ place.name }}</h3>
              <time v-if="place.latestCapturedAt" :datetime="place.latestCapturedAt">
                上次更新：{{ formatDate(place.latestCapturedAt) }}
              </time>
              <span v-else>上次更新：时间未知</span>
            </div>
            <span class="card-action">查看地点 <span aria-hidden="true">→</span></span>
          </div>
        </RouterLink>
      </div>
    </section>

    <section
      v-if="content && (content.campusSupplementary.photos.length || content.campusSupplementary.albums.length)"
      class="supplementary"
      aria-labelledby="supplementary-heading"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">顺带看看校园</p>
          <h2 id="supplementary-heading">校园补充</h2>
        </div>
      </div>
      <div v-if="content.campusSupplementary.photos.length" class="supplementary-loose photo-grid">
        <figure v-for="photo in content.campusSupplementary.photos" :key="photo.src" class="photo-card">
          <ResponsiveImage :photo="photo" :alt="photo.title" sizes="(max-width: 720px) calc(100vw - 2.5rem), 33vw" loading="lazy" />
        </figure>
      </div>
      <article v-for="album in content.campusSupplementary.albums" :key="album.name" class="album">
        <h3>{{ album.name }}</h3>
        <div class="photo-grid">
          <figure v-for="photo in album.photos" :key="photo.src" class="photo-card">
            <ResponsiveImage :photo="photo" :alt="photo.title" sizes="(max-width: 720px) calc(100vw - 2.5rem), 33vw" loading="lazy" />
          </figure>
        </div>
      </article>
    </section>
  </main>
</template>
