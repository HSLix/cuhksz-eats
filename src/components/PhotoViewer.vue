<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ResponsiveImage from './ResponsiveImage.vue'

const props = defineProps({
  photo: { type: Object, required: true },
  alt: { type: String, required: true },
  triggerLabel: { type: String, required: true },
  hint: { type: String, default: '查看大图' },
  dialogLabel: { type: String, default: '照片查看器' },
  sizes: { type: String, default: '(max-width: 720px) calc(100vw - 2.5rem), 33vw' },
})

const open = ref(false)
const trigger = ref(null)

function showViewer() {
  open.value = true
}

function closeViewer() {
  open.value = false
  nextTick(() => trigger.value?.focus())
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeViewer()
}

watch(open, (isOpen) => {
  const action = isOpen ? 'addEventListener' : 'removeEventListener'
  window[action]('keydown', handleKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <button
    ref="trigger"
    class="photo-zoom-trigger"
    type="button"
    :aria-label="triggerLabel"
    @click="showViewer"
  >
    <ResponsiveImage :photo="photo" :alt="alt" :sizes="sizes" loading="lazy" />
    <span class="zoom-hint">{{ hint }}</span>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      class="image-viewer"
      :class="{ 'image-viewer--menu': photo.kind === 'menu' }"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogLabel"
      @click.self="closeViewer"
    >
      <button class="viewer-close" type="button" aria-label="关闭照片查看器" @click="closeViewer">×</button>
      <ResponsiveImage :photo="photo" :alt="alt" :responsive="false" />
    </div>
  </Teleport>
</template>
