<script setup>
import PhotoViewer from './PhotoViewer.vue'

const props = defineProps({
  title: { type: String, required: true },
  photos: { type: Array, required: true },
  coverSrc: { type: String, default: '' },
  coverAlt: { type: String, default: '' },
  containImages: { type: Boolean, default: false },
  showHeading: { type: Boolean, default: true },
})

function photoAlt(photo) {
  if (photo.src === props.coverSrc && props.coverAlt) return props.coverAlt
  return photo.kind === 'menu' ? props.title : photo.title
}
</script>

<template>
  <section v-if="photos.length" class="content-section">
    <div v-if="showHeading" class="section-heading">
      <h2>{{ title }}</h2>
      <span class="count">{{ photos.length }} 张</span>
    </div>
    <div class="photo-grid" :class="{ 'photo-grid--contain': containImages }">
      <figure v-for="photo in photos" :key="photo.src" class="photo-card">
        <PhotoViewer
          :photo="photo"
          :alt="photoAlt(photo)"
          :trigger-label="photo.kind === 'menu' ? `放大查看${photoAlt(photo)}` : `查看照片：${photoAlt(photo)}`"
          :hint="photo.kind === 'menu' ? '放大查看' : '查看大图'"
          :dialog-label="photo.kind === 'menu' ? '菜单照片查看器' : '照片查看器'"
          sizes="(max-width: 720px) calc(100vw - 2.5rem), 33vw"
        />
        <figcaption v-if="photo.kind === 'dish'">{{ photo.title }}</figcaption>
      </figure>
    </div>
  </section>
</template>
