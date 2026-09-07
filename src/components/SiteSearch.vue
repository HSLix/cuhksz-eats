<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps({
  entries: {
    type: Array,
    default: () => [],
  },
})

const query = ref('')
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('zh-CN'))
const results = computed(() => {
  if (!normalizedQuery.value) return []
  return props.entries.filter((entry) => (
    entry.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery.value)
  ))
})
</script>

<template>
  <div class="site-search" role="search">
    <label for="site-search-input">搜索餐饮地点、档口或菜品</label>
    <input
      id="site-search-input"
      v-model="query"
      type="search"
      inputmode="search"
      autocomplete="off"
      placeholder="例如：麦当劳"
    />
    <div v-if="normalizedQuery" class="search-results" aria-live="polite">
      <p v-if="!results.length" class="search-empty">没有找到相关餐饮信息</p>
      <ul v-else>
        <li v-for="result in results" :key="result.id">
          <RouterLink :to="result.path">
            <span class="search-result-type">{{ result.typeLabel }}</span>
            <strong>{{ result.name }}</strong>
            <span class="search-result-owner">{{ result.ownerLabel }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
