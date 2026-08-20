import { createRouter, createWebHistory } from 'vue-router'
import BrowsePage from '@/pages/BrowsePage.vue'
import FavoritesPage from '@/pages/FavoritesPage.vue'
import ContinueWatchingPage from '@/pages/ContinueWatchingPage.vue'
import MostPlayedPage from '@/pages/MostPlayedPage.vue'
import AlbumsPage from '@/pages/AlbumsPage.vue'
import AlbumDetailPage from '@/pages/AlbumDetailPage.vue'
import StatsPage from '@/pages/StatsPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'browse', component: BrowsePage },
    { path: '/favorites', name: 'favorites', component: FavoritesPage },
    { path: '/continue-watching', name: 'continue-watching', component: ContinueWatchingPage },
    { path: '/most-played', name: 'most-played', component: MostPlayedPage },
    { path: '/albums', name: 'albums', component: AlbumsPage },
    { path: '/albums/:id', name: 'album-detail', component: AlbumDetailPage },
    { path: '/stats', name: 'stats', component: StatsPage },
  ],
})

export default router
