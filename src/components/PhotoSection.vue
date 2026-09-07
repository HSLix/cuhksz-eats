<script setup>
defineProps({
  title: { type: String, required: true },
  photos: { type: Array, required: true },
  coverSrc: { type: String, default: '' },
  coverAlt: { type: String, default: '' },
  containImages: { type: Boolean, default: false },
  showHeading: { type: Boolean, default: true },
})
</script>

<template>
  <section v-if="photos.length" class="content-section">
    <div v-if="showHeading" class="section-heading">
      <h2>{{ title }}</h2>
      <span class="count">{{ photos.length }} 张</span>
    </div>
    <div class="photo-grid" :class="{ 'photo-grid--contain': containImages }">
      <figure v-for="photo in photos" :key="photo.src" class="photo-card">
        <img :src="photo.src" :alt="photo.src === coverSrc && coverAlt ? coverAlt : photo.title" loading="lazy" />
        <figcaption v-if="photo.kind === 'dish'">{{ photo.title }}</figcaption>
      </figure>
    </div>
  </section>
</template>
