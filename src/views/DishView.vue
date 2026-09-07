<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { loadContent } from '../content.js'

const route = useRoute()
const place = ref(null)
const dish = ref(null)
const ready = ref(false)

const records = computed(() => [...(dish.value?.records ?? [])].sort((left, right) => {
  if (left.capturedAt && right.capturedAt) return right.capturedAt.localeCompare(left.capturedAt)
  if (left.capturedAt) return -1
  if (right.capturedAt) return 1
  return left.src.localeCompare(right.src)
}))

function formatDate(value) {
  if (!value) return '记录时间未知'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return `${year}年${month}月${day}日`
}

onMounted(async () => {
  const content = await loadContent()
  place.value = content.places.find((candidate) => candidate.slug === route.params.placeSlug)
  dish.value = place.value?.dishes.find((candidate) => candidate.slug === route.params.dishSlug)
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
    <p v-if="!ready" class="state-message">正在载入菜品…</p>
    <template v-else-if="dish">
      <header class="page-header">
        <p class="eyebrow">菜品</p>
        <h1>{{ dish.name }}</h1>
        <p>{{ dish.recordCount }} 条菜品记录</p>
      </header>
      <section class="content-section" aria-labelledby="history-heading">
        <div class="section-heading">
          <h2 id="history-heading">历史记录</h2>
          <span class="count">{{ dish.recordCount }} 条</span>
        </div>
        <div class="dish-history">
          <article v-for="record in records" :key="record.src" class="dish-record">
            <img :src="record.src" :alt="`${dish.name}，${formatDate(record.capturedAt)}`" loading="lazy" />
            <div class="dish-record-body">
              <time v-if="record.capturedAt" :datetime="record.capturedAt">{{ formatDate(record.capturedAt) }}</time>
              <span v-else>记录时间未知</span>
              <strong>{{ record.price ? `${record.price} 元` : '价格未记录' }}</strong>
              <p v-if="record.note">记录者随记：{{ record.note }}</p>
            </div>
          </article>
        </div>
      </section>
    </template>
    <section v-else class="not-found"><h1>这个菜品不存在</h1></section>
  </main>
</template>
