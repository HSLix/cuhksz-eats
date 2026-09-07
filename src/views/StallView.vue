<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PhotoSection from '../components/PhotoSection.vue'
import ResponsiveImage from '../components/ResponsiveImage.vue'
import { loadContent } from '../content.js'

const route = useRoute()
const place = ref(null)
const stall = ref(null)
const ready = ref(false)
const photosByKind = computed(() => ({
  storefront: stall.value?.photos.filter((photo) => photo.kind === 'storefront') ?? [],
  menu: stall.value?.photos.filter((photo) => photo.kind === 'menu') ?? [],
  rest: stall.value?.photos.filter((photo) => photo.kind === 'photo') ?? [],
}))

function formatDate(value) {
  if (!value) return '记录时间未知'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return `${year}年${month}月${day}日`
}
onMounted(async () => {
  const content = await loadContent()
  place.value = content.places.find(
    (candidate) => candidate.slug === route.params.placeSlug || candidate.name === route.params.placeSlug,
  )
  stall.value = place.value?.stalls.find(
    (candidate) => candidate.slug === route.params.stallSlug || candidate.name === route.params.stallSlug,
  )
  ready.value = true
})
</script>

<template>
  <main class="content-page">
    <RouterLink
      v-if="place"
      class="back-link"
      :to="{ name: 'place', params: { slug: place.slug } }"
    >← 返回{{ place.name }}</RouterLink>
    <p v-if="!ready" class="state-message">正在载入档口…</p>
    <template v-else-if="stall">
      <header class="page-header">
        <p class="eyebrow">档口</p>
        <h1>{{ stall.name }}</h1>
        <p>{{ stall.photoCount }} 张实拍内容</p>
      </header>
      <PhotoSection title="门面照片" :photos="photosByKind.storefront" />
      <PhotoSection title="菜单照片" :photos="photosByKind.menu" />
      <section v-if="stall.dishes.length" class="content-section dish-section">
        <div class="section-heading">
          <h2>菜品</h2>
          <span class="count">{{ stall.dishes.length }} 道</span>
        </div>
        <div class="dish-grid">
          <RouterLink
            v-for="dish in stall.dishes"
            :key="dish.slug"
            class="dish-card"
            :to="{
              name: 'stall-dish',
              params: { placeSlug: place.slug, stallSlug: stall.slug, dishSlug: dish.slug },
            }"
          >
            <ResponsiveImage
              :photo="dish.coverImage"
              :alt="dish.name"
              :title="`最新记录：${formatDate(dish.coverCapturedAt)}`"
              sizes="(max-width: 720px) calc(100vw - 2.5rem), 33vw"
              loading="lazy"
            />
            <div class="dish-card-body">
              <strong>{{ dish.name }}</strong>
              <span v-if="dish.latestPrice">
                {{ dish.latestPrice }} 元 · {{ formatDate(dish.latestPriceCapturedAt) }}
              </span>
              <span v-else>暂无价格记录</span>
              <span class="dish-card-action">
                {{ dish.recordCount > 1 ? `共 ${dish.recordCount} 条记录 · 查看详情 →` : '查看详情 →' }}
              </span>
            </div>
          </RouterLink>
        </div>
      </section>
      <PhotoSection title="其余照片" :photos="photosByKind.rest" />
    </template>
    <section v-else class="not-found"><h1>这个档口不存在</h1></section>
  </main>
</template>
