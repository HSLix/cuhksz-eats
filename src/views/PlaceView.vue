<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PhotoSection from '../components/PhotoSection.vue'
import { loadContent } from '../content.js'

const route = useRoute()
const place = ref(null)
const ready = ref(false)

const photosByKind = computed(() => ({
  storefront: place.value?.photos.filter((photo) => photo.kind === 'storefront') ?? [],
  menu: place.value?.photos.filter((photo) => photo.kind === 'menu') ?? [],
  photo: place.value?.photos.filter((photo) => photo.kind === 'photo') ?? [],
}))

function formatDate(value) {
  if (!value) return '记录时间未知'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return `${year}年${month}月${day}日`
}

onMounted(async () => {
  const content = await loadContent()
  place.value = content.places.find((candidate) => candidate.slug === route.params.slug)
  ready.value = true
})
</script>

<template>
  <main class="content-page">
    <RouterLink class="back-link" to="/">← 返回餐饮地点</RouterLink>

    <p v-if="!ready" class="state-message">正在载入地点…</p>
    <template v-else-if="place">
      <header class="page-header">
        <p class="eyebrow">餐饮地点</p>
        <h1>{{ place.name }}</h1>
        <p>这里收录了 {{ place.photoCount }} 张实拍内容。</p>
      </header>
      <PhotoSection
        title="门面照片"
        :photos="photosByKind.storefront"
        :cover-src="place.cover"
        :cover-alt="place.name"
        contain-images
      />
      <PhotoSection title="菜单照片" :photos="photosByKind.menu" :cover-src="place.cover" :cover-alt="place.name" />
      <section v-if="place.stalls.length" class="content-section">
        <div class="section-heading"><h2>档口</h2><span class="count">{{ place.stalls.length }} 个</span></div>
        <div class="stall-grid">
          <RouterLink
            v-for="stall in place.stalls"
            :key="stall.slug"
            class="stall-card"
            :to="{ name: 'stall', params: { placeSlug: place.slug, stallSlug: stall.slug } }"
          >
            <img
              v-if="stall.cover"
              :src="stall.cover"
              :alt="stall.name"
              :title="stall.coverTitle"
              loading="lazy"
            />
            <div v-else class="stall-cover-placeholder" role="img" :aria-label="`${stall.name}暂无封面`">食</div>
            <div class="stall-card-body">
              <strong>{{ stall.name }}</strong>
              <span>{{ stall.photoCount }} 张 →</span>
            </div>
          </RouterLink>
        </div>
      </section>
      <section v-if="place.dishes.length" class="content-section dish-section">
        <div v-if="place.stalls.length" class="section-heading">
          <h2>未归档</h2>
          <span class="count">{{ place.dishes.length }} 道</span>
        </div>
        <div class="dish-grid">
          <RouterLink
            v-for="dish in place.dishes"
            :key="dish.slug"
            class="dish-card"
            :to="{ name: 'place-dish', params: { placeSlug: place.slug, dishSlug: dish.slug } }"
          >
            <img
              :src="dish.cover"
              :alt="dish.name"
              :title="`最新记录：${formatDate(dish.coverCapturedAt)}`"
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
      <PhotoSection title="普通相册" :photos="photosByKind.photo" :cover-src="place.cover" :cover-alt="place.name" />
    </template>
    <section v-else class="not-found">
      <p class="eyebrow">未找到</p>
      <h1>这个餐饮地点不存在</h1>
      <RouterLink to="/">返回首页</RouterLink>
    </section>
  </main>
</template>
