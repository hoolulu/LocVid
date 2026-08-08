<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import CategorySidebar from '@/components/layout/CategorySidebar.vue'
import VideoCard from '@/components/gallery/VideoCard.vue'
import BrowsePagination from '@/components/gallery/BrowsePagination.vue'
import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { showVideoContextMenu } from '@/composables/useVideoContextActions'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import type { SortMode } from '@/types'

const gallery = useGalleryStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const { onPlay, onToggleFavorite } = useGalleryPlay()
const customPageSize = ref('')

onMounted(async () => {
  gallery.viewMode = 'browse'
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  // 直接赋值内存排序（不调 setSort，避免 persistSort 污染浏览页默认排序）；
  // 后端 playcount_desc 按播放次数倒序（不走过滤器缓存，始终返回最新）
  gallery.sort = 'playcount_desc' as SortMode
  if (!library.activeLibraryId) await library.loadLibraries()
  // 侧栏全局显示：确保分类已加载（幂等，避免重复请求）
  if (!gallery.categories.length) await gallery.loadCategories()
  await gallery.loadVideos()
})

async function changePage(next: number) {
  if (next < 1 || next > gallery.totalPages) return
  gallery.page = next
  await gallery.loadVideos()
}

async function onPageSizeChange(size: number) {
  customPageSize.value = ''
  gallery.setPageSize(size, settings.preset)
  await gallery.loadVideos()
}

async function onCustomPageSize(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const n = parseInt(customPageSize.value, 10)
  if (!Number.isFinite(n) || n < 1) return
  gallery.setPageSize(n, settings.preset)
  await gallery.loadVideos()
}

function onVideoContext(e: MouseEvent, videoId: string) {
  showVideoContextMenu(e, videoId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'youtube'" />
      <main class="flex flex-1 flex-col overflow-hidden p-4">
      <div class="mb-4 flex shrink-0 items-center gap-3">
        <h2 class="text-lg font-medium">最多播放</h2>
        <span class="text-sm text-[var(--lg-text-muted)]">共 {{ gallery.total }} 个</span>
      </div>
      <div
        v-if="!gallery.loading && !gallery.videos.length"
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-[var(--lg-text-muted)]"
      >
        <span class="text-3xl opacity-60">▶</span>
        <span>视频库为空</span>
      </div>
      <div
        v-else
        class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 overflow-y-auto pb-4"
      >
        <VideoCard
          v-for="video in gallery.videos"
          :key="video.id"
          :video="video"
          show-play-count
          show-progress
          @play="onPlay"
          @toggle-favorite="onToggleFavorite"
          @contextmenu="onVideoContext($event, video.id)"
        />
      </div>
      <BrowsePagination
        v-model:custom-page-size="customPageSize"
        class="shrink-0"
        @page-size-change="onPageSizeChange"
        @custom-page-size="onCustomPageSize"
        @change-page="changePage"
        @jump-page="changePage"
      />
      </main>
    </div>
  </div>
</template>
