<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { loadContent } from '../content.js'

const content = ref(null)
const error = ref('')

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
      <p class="eyebrow">学生维护 · 非官方网站</p>
      <h1>CUHKSZ Eats</h1>
      <p class="hero-copy">用真实照片，认识校园里可以吃饭的地方。</p>
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
          <img v-if="place.cover" :src="place.cover" :alt="place.name" :title="place.coverTitle" />
          <div v-else class="cover-placeholder" role="img" :aria-label="`${place.name}暂无封面`">食</div>
          <div class="card-body">
            <h3>{{ place.name }}</h3>
            <span>查看地点 <span aria-hidden="true">→</span></span>
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
          <img :src="photo.src" :alt="photo.title" loading="lazy" />
        </figure>
      </div>
      <article v-for="album in content.campusSupplementary.albums" :key="album.name" class="album">
        <h3>{{ album.name }}</h3>
        <div class="photo-grid">
          <figure v-for="photo in album.photos" :key="photo.src" class="photo-card">
            <img :src="photo.src" :alt="photo.title" loading="lazy" />
          </figure>
        </div>
      </article>
    </section>
  </main>
</template>
