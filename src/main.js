import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import DishView from './views/DishView.vue'
import HomeView from './views/HomeView.vue'
import PlaceView from './views/PlaceView.vue'
import StallView from './views/StallView.vue'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
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
  scrollBehavior: () => ({ top: 0 }),
})

createApp(App).use(router).mount('#app')
