<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  analyticsConfig,
  analyticsEnabled,
  getAnalyticsConsent,
  loadAnalytics,
  saveAnalyticsConsent,
  trackPage,
  withdrawAnalyticsConsent,
} from '../analytics.js'

const route = useRoute()
const isOpen = ref(false)
const consent = ref(null)
const isLoading = ref(false)
const closeButton = ref(null)

onMounted(() => {
  consent.value = getAnalyticsConsent()
  isOpen.value = analyticsEnabled && consent.value === null
  if (consent.value === 'accepted') trackCurrentPage()
})

watch(() => route.path, async () => {
  if (consent.value !== 'accepted') return
  await nextTick()
  trackCurrentPage()
})

watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  closeButton.value?.focus()
})

async function trackCurrentPage() {
  await trackPage(route.path)
}

function reject() {
  withdrawAnalyticsConsent()
  consent.value = 'rejected'
  isOpen.value = false
}

async function accept() {
  saveAnalyticsConsent(true)
  consent.value = 'accepted'
  isLoading.value = true
  isOpen.value = false
  await loadAnalytics()
  await trackCurrentPage()
  isLoading.value = false
}

function openSettings() {
  isOpen.value = true
}

function withdraw() {
  withdrawAnalyticsConsent()
  consent.value = 'rejected'
  isOpen.value = false
}
</script>

<template>
  <p>
    <button class="privacy-settings-link" type="button" @click="openSettings">
      统计与隐私设置
    </button>
  </p>

  <Teleport to="body">
    <div
      v-if="isOpen"
      class="privacy-backdrop"
      role="presentation"
      @mousedown.self="reject"
    >
      <section
        class="privacy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-dialog-title"
        @keydown.esc="reject"
      >
        <button ref="closeButton" class="privacy-dialog-close" type="button" aria-label="关闭并不同意统计" @click="reject">
          ×
        </button>
        <p class="eyebrow">本次访问的选择</p>
        <h2 id="privacy-dialog-title">隐私统计说明</h2>

        <template v-if="analyticsEnabled">
          <p>本站希望使用 Umami Cloud 统计本次访问，用于了解各页面的整体使用情况和改进网站。</p>
          <p>若您同意，浏览器将向 Umami Software, Inc. 的境外服务器发送当前页面路径、来源页面、浏览器和设备类型、屏幕尺寸、语言及粗略地区等访问数据。Umami 会使用请求 IP 推算地区并生成匿名会话标识，但声明不会保存原始 IP，也不使用 Cookie。</p>
          <p>本站不会启用用户身份识别、广告追踪、跨站追踪、会话回放或输入内容采集。您的选择仅在当前标签页访问期间有效；拒绝不会影响网站正常使用。您可以随时通过页脚的“统计与隐私设置”停止后续统计。</p>

          <details class="privacy-details">
            <summary>查看完整隐私说明</summary>
            <div>
              <p><strong>处理者：</strong>CUHKSZ Eats 维护者；联系邮箱：<a href="mailto:l0123i456@163.com">l0123i456@163.com</a>。</p>
              <p><strong>境外接收方：</strong>Umami Software, Inc.；可通过其<a href="https://umami.is/privacy" target="_blank" rel="noreferrer">隐私政策与联系方式</a>了解详情。</p>
              <p><strong>数据区域：</strong>{{ analyticsConfig.dataRegion }}；<strong>保存期限：</strong>{{ analyticsConfig.retention }}。</p>
              <p><strong>处理范围：</strong>仅页面访问量、页面路径、来源、粗粒度设备和地区统计。本站不调用 <code>umami.identify()</code>，不发送自定义事件或会话属性，也不公开统计看板。</p>
              <p><strong>撤回、查询或删除：</strong>您可在本弹窗撤回，撤回仅阻止后续统计，无法撤销此前已发送的数据。如需查询、投诉或请求删除，请联系站点维护者。</p>
            </div>
          </details>

          <p v-if="consent === 'accepted'" class="privacy-status">您已同意本次访问的统计，可在此撤回。</p>
          <p v-else-if="consent === 'rejected'" class="privacy-status">您已拒绝本次访问的统计，可在此重新同意。</p>

          <div class="privacy-actions">
            <button v-if="consent === 'accepted'" type="button" @click="withdraw">撤回并停止后续统计</button>
            <button v-else type="button" @click="reject">不同意</button>
            <button v-if="consent !== 'accepted'" type="button" @click="accept">同意本次访问</button>
            <button v-else type="button" @click="isOpen = false">保留同意并关闭</button>
          </div>
        </template>

        <template v-else>
          <p>当前部署未启用 Umami Cloud，您的浏览器不会加载其脚本或向其发送访问统计。</p>
          <div class="privacy-actions privacy-actions--single">
            <button type="button" @click="isOpen = false">关闭</button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>

  <span v-if="isLoading" class="visually-hidden" role="status">正在启用访问统计</span>
</template>
