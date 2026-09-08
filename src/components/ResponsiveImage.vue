<script setup>
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })
defineProps({
  photo: { type: Object, required: true },
  alt: { type: String, required: true },
  title: { type: String, default: '' },
  sizes: { type: String, default: '100vw' },
  responsive: { type: Boolean, default: true },
})

const attrs = useAttrs()
const publicUrl = (source) => `${import.meta.env.BASE_URL}${source.replace(/^\//, '')}`
</script>

<template>
  <span class="responsive-image" itemscope itemtype="https://schema.org/ImageObject">
    <img
      v-bind="attrs"
      itemprop="contentUrl"
      :src="publicUrl(photo.src)"
      :srcset="responsive ? photo.sources.map((source) => `${publicUrl(source.src)} ${source.width}w`).join(', ') : undefined"
      :sizes="responsive ? sizes : undefined"
      :width="photo.width"
      :height="photo.height"
      :alt="alt"
      :title="title || undefined"
    />
    <meta itemprop="creditText" :content="photo.creditText" />
    <meta itemprop="copyrightNotice" :content="photo.copyrightNotice" />
  </span>
</template>
