import { createApp, nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { loadContent } from './content.js'
import DishView from './views/DishView.vue'
import HomeView from './views/HomeView.vue'
import PlaceView from './views/PlaceView.vue'
import StallView from './views/StallView.vue'
import './styles.css'

const scrollPositions = new Map()

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/places/:slug', name: 'place', component: PlaceView },
    {
      path: '/places/:placeSlug/dishes/:dishSlug',
      name: 'place-dish',
      component: DishView,
    },
    { path: '/places/:placeSlug/stalls/:stallSlug', name: 'stall', component: StallView },
    {
      path: '/places/:placeSlug/stalls/:stallSlug/dishes/:dishSlug',
      name: 'stall-dish',
      component: DishView,
    },
  ],
  async scrollBehavior(to, from, savedPosition) {
    const position = savedPosition ?? scrollPositions.get(to.fullPath)
    if (!position) return { top: 0 }
    await loadContent()
    await nextTick()
    return position
  },
})

router.beforeEach((to, from) => {
  if (from.name) scrollPositions.set(from.fullPath, { left: window.scrollX, top: window.scrollY })
})

createApp(App).use(router).mount('#app')
