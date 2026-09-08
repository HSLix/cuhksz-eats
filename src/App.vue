<script setup>
import AnalyticsPrivacy from './components/AnalyticsPrivacy.vue'
</script>

<template>
  <div class="site-shell">
    <RouterView />
    <footer class="site-footer">
      <p class="site-footer-disclaimer">CUHKSZ Eats 是由个人独立维护的非官方网站，与香港中文大学（深圳）及站内所列商户无隶属、授权或认可关系。内容仅记录特定时间的个人用餐与实拍信息，不代表校方或商户的实时菜单、价格及承诺，请以现场和官方信息为准。</p>
      <p>经您同意后，本站可使用 Umami Cloud 统计本次访问的匿名汇总数据；拒绝不影响使用。</p>
      <p>图片由 CUHKSZ Eats 提供；版权仍属于原摄影者。</p>
      <p>MIT License 仅适用于程序代码；网站文字、原始照片及生成衍生图不在授权范围内。</p>
      <p>
        本网站的程序代码在
        <a href="https://github.com/HSLix/cuhksz-eats" target="_blank" rel="noopener noreferrer">GitHub</a>
        开源。
      </p>
      <p>信息纠错 / 图片移除：<a href="mailto:l0123i456@163.com">l0123i456@163.com</a></p>
      <AnalyticsPrivacy />
    </footer>
  </div>
</template>
