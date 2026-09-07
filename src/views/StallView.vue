<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PhotoSection from '../components/PhotoSection.vue'
import { loadContent } from '../content.js'

const route = useRoute()
const place = ref(null)
const stall = ref(null)
const ready = ref(false)
const photosByKind = computed(() => ({
  storefront: stall.value?.photos.filter((photo) => photo.kind === 'storefront') ?? [],
  menu: stall.value?.photos.filter((photo) => photo.kind === 'menu') ?? [],
  rest: stall.value?.photos.filter((photo) => !['storefront', 'menu'].includes(photo.kind)) ?? [],
}))
onMounted(async () => {
  const content = await loadContent()
  place.value = content.places.find((candidate) => candidate.slug === route.params.placeSlug)
  stall.value = place.value?.stalls.find((candidate) => candidate.slug === route.params.stallSlug)
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
      <PhotoSection title="其余照片" :photos="photosByKind.rest" />
    </template>
    <section v-else class="not-found"><h1>这个档口不存在</h1></section>
  </main>
</template>
