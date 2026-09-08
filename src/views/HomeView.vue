<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ResponsiveImage from '../components/ResponsiveImage.vue'
import SiteSearch from '../components/SiteSearch.vue'
import { loadContent } from '../content.js'

const content = ref(null)
const error = ref('')

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
