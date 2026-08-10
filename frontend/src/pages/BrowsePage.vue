<script setup lang="ts">

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'

import CategorySidebar from '@/components/layout/CategorySidebar.vue'

import VirtualVideoGrid from '@/components/gallery/VirtualVideoGrid.vue'
import BrowsePagination from '@/components/gallery/BrowsePagination.vue'
import BatchActionBar from '@/components/layout/BatchActionBar.vue'

import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { useBrowseNavigation } from '@/composables/useBrowseNavigation'
import { showVideoContextMenu } from '@/composables/useVideoContextActions'

import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { scanFormat } from '@/api/thumbs'
import type { SortMode } from '@/types'
import { getGallerySortOptions } from '@/constants/sort'
import { GRID_COLUMNS } from '@/constants/layout'
import { t } from '@/i18n'



const router = useRouter()

const gallery = useGalleryStore()

const library = useLibraryStore()

const settings = useSettingsStore()

const player = usePlayerStore()

const { onPlay, onToggleFavorite, onRandomPlay } = useGalleryPlay()
const { syncUrl, applyRouteQuery, selectCategory } = useBrowseNavigation()

const customPageSize = ref('')
const sortOptions = computed(() => getGallerySortOptions())
const formatFilterOptions = computed(() => [
  { value: '', label: t('other.allFormats') },
  { value: 'unsupported', label: t('other.noPlayable') },
])
const skeletonCount = computed(() => Math.min(gallery.pageSize, 24))
const skeletonColumns = computed(() => GRID_COLUMNS[settings.preset])
const skeletonStyle = computed(() => ({
  gridTemplateColumns: `repeat(${skeletonColumns.value}, minmax(0, 1fr))`,
}))



const breadcrumb = computed(() => {

  if (!gallery.category) return ''

  let text = gallery.category

  if (gallery.folder) {

    text += ' / ' + gallery.folder.split('/').join(' / ')

  }

  return text

})





async function init() {
  gallery.viewMode = 'browse'
  gallery.restoreRandomSeed()
  gallery.restoreBrowseState()
  gallery.restoreSort()
  gallery.restorePageSize(settings.preset)

  applyRouteQuery(
    'cat' in router.currentRoute.value.query,
    'folder' in router.currentRoute.value.query,
  )

  const videosTask = gallery.loadVideos()
  void Promise.all([library.loadLibraries(), settings.loadSettings()]).then(() => {
    gallery.restorePageSize(settings.preset)
    // 用户从未手动选过排序时，应用设置里的默认排序
    gallery.applyDefaultSort(settings.settings?.default_sort)
    void gallery.loadCategories()
    if (gallery.category) void gallery.loadFolderTree(gallery.category)
  })

  await videosTask
  syncUrl()
}

watch(
  () => settings.preset,
  async (preset) => {
    gallery.restorePageSize(preset)
    await gallery.loadVideos()
    syncUrl()
  },
)



onMounted(() => {

  void init()

  // 键盘网格导航：↑↓←→ 移动焦点卡片、Enter 播放、F 收藏。
  // 用捕获阶段监听并在焦点存在时拦截方向键/Enter/F，避免与 App 全局的 ←→ 翻页冲突。
  window.addEventListener('keydown', onGridKeydown, true)

})

onUnmounted(() => {

  window.removeEventListener('keydown', onGridKeydown, true)

})

// ── 键盘网格导航 ──
const focusId = ref<string | null>(null)

async function handlePlay(id: string) {
  focusId.value = id
  await onPlay(id)
}

async function handleToggleFavorite(id: string) {
  focusId.value = id
  await onToggleFavorite(id)
}

// 焦点卡片滚动到可见区域（虚拟滚动下焦点卡片可能不在视口内）
watch(focusId, (id) => {
  if (!id) return
  document.querySelector<HTMLElement>(`[data-video-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
})

function onGridKeydown(e: KeyboardEvent) {
  // 播放器打开时键盘交给播放器（PlayerView 也在捕获阶段监听，window 捕获先于 document 捕获，
  // 这里必须先让路，否则方向键/空格会被网格导航拦截）
  if (player.open) return
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
  if (gallery.loading || !gallery.videos.length) return
  if (e.key === 'Escape') {
    focusId.value = null
    return
  }
  const videos = gallery.videos
  const cols = GRID_COLUMNS[settings.preset]
  let idx = focusId.value ? videos.findIndex((v) => v.id === focusId.value) : -1
  if (idx < 0) idx = 0
  let moved = false
  if (e.key === 'ArrowUp' && idx - cols >= 0) {
    idx -= cols
    moved = true
  } else if (e.key === 'ArrowDown' && idx + cols < videos.length) {
    idx += cols
    moved = true
  } else if (e.key === 'ArrowLeft' && idx > 0) {
    idx -= 1
    moved = true
  } else if (e.key === 'ArrowRight' && idx < videos.length - 1) {
    idx += 1
    moved = true
  }
  if (moved) {
    e.preventDefault()
    e.stopImmediatePropagation()
    focusId.value = videos[idx].id
    return
  }
  if (e.key === 'Enter' && focusId.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    void handlePlay(focusId.value)
  } else if ((e.key === 'f' || e.key === 'F') && focusId.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    void handleToggleFavorite(focusId.value)
  }
}



async function onCinemaCategoryChange(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  await selectCategory(name || null)
}

async function onSortChange(e: Event) {

  gallery.setSort((e.target as HTMLSelectElement).value as SortMode)

  await gallery.loadVideos()

  syncUrl()

}



async function onFormatChange(e: Event) {

  gallery.setFormatFilter((e.target as HTMLSelectElement).value)

  if (gallery.formatFilter) void scanFormat()

  await gallery.loadVideos()

  syncUrl()

}



async function onPageSizeChange(size: number) {
  customPageSize.value = ''
  gallery.setPageSize(size, settings.preset)
  await gallery.loadVideos()
  syncUrl()
}

async function onCustomPageSize(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const n = parseInt(customPageSize.value, 10)
  if (!Number.isFinite(n) || n < 1) return
  gallery.setPageSize(n, settings.preset)
  await gallery.loadVideos()
  syncUrl()
}

async function changePage(next: number) {
  if (next < 1 || next > gallery.totalPages) return
  gallery.page = next
  await gallery.loadVideos()
  syncUrl()
}

async function onJumpPage(page: number) {
  await changePage(page)
}



function onVideoContext(e: MouseEvent, videoId: string) {
  showVideoContextMenu(e, videoId)
}

</script>



<template>

  <div class="flex h-full min-h-0 flex-col">

    <AppHeader />

    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'classic'" />

      <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">

        <div class="mb-2 shrink-0 text-sm text-[var(--lg-text-muted)]" v-if="breadcrumb">

          {{ breadcrumb }}

        </div>

        <div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <h2 class="text-lg font-medium">{{ gallery.category || t('common.all') }}</h2>
          <span class="text-sm text-[var(--lg-text-muted)]">{{ t('page.count', { n: gallery.total }) }}</span>

          <select
            v-if="settings.preset === 'cinema'"
            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1 text-sm"
            :value="gallery.category || ''"
            @change="onCinemaCategoryChange"
          >
            <option value="">{{ t('browse.allCategories') }}</option>
            <option v-for="cat in gallery.categories" :key="cat.name" :value="cat.name">
              {{ cat.name }} ({{ cat.count }})
            </option>
          </select>

          <select

            class="ml-auto rounded border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-2 py-1 text-sm"

            :value="gallery.formatFilter"

            @change="onFormatChange"

          >

            <option v-for="opt in formatFilterOptions" :key="opt.value" :value="opt.value">

              {{ opt.label }}

            </option>

          </select>

          <select

            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-2 py-1 text-sm"

            :value="gallery.sort"

            @change="onSortChange"

          >

            <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">

              {{ opt.label }}

            </option>

          </select>

          <button

            class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm lg-hover"

            @click="onRandomPlay"

          >

            {{ t('page.randomPlay') }}

          </button>

        </div>



        <div
          v-if="gallery.loading && !gallery.videos.length"
          class="video-grid min-h-0 flex-1 grid gap-3 pb-4"
          :style="skeletonStyle"
        >
          <div
            v-for="n in skeletonCount"
            :key="n"
            class="gallery-skeleton-card"
          />
        </div>

        <VirtualVideoGrid
          v-else
          class="transition-opacity duration-150"
          :class="{ 'opacity-60 pointer-events-none': gallery.refreshing }"
          :videos="gallery.videos"
          :focused-id="focusId"
          show-play-count
          show-progress
          @play="handlePlay"
          @toggle-favorite="handleToggleFavorite"
          @contextmenu="onVideoContext"
        />



        <BrowsePagination
          v-model:custom-page-size="customPageSize"
          class="shrink-0"
          @page-size-change="onPageSizeChange"
          @custom-page-size="onCustomPageSize"
          @change-page="changePage"
          @jump-page="onJumpPage"
        />



        <BatchActionBar />

      </main>

    </div>

  </div>

</template>

