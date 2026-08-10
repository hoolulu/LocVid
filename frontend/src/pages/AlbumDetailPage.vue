<script setup lang="ts">

import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useRoute, useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import CategorySidebar from '@/components/layout/CategorySidebar.vue'

import { t } from '@/i18n'

import VideoCard from '@/components/gallery/VideoCard.vue'
import BrowsePagination from '@/components/gallery/BrowsePagination.vue'

import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { videoContextMenuItems } from '@/composables/useVideoContextActions'

import { removeVideosFromAlbum, setAlbumCover } from '@/api/albums'
import { getVideos } from '@/api'

import { useAlbumStore } from '@/stores/album'

import { useGalleryStore } from '@/stores/gallery'

import { useLibraryStore } from '@/stores/library'

import { useSettingsStore } from '@/stores/settings'

import { useUiStore } from '@/stores/ui'

import { usePlayerStore } from '@/stores/player'

import type { SortMode } from '@/types'
import { getPlaylistSortOptions } from '@/constants/sort'

const route = useRoute()

const router = useRouter()

const album = useAlbumStore()

const gallery = useGalleryStore()

const library = useLibraryStore()

const settings = useSettingsStore()

const ui = useUiStore()

const { onPlay, onToggleFavorite } = useGalleryPlay()

const player = usePlayerStore()

const customPageSize = ref('')

// 专辑内排序：默认"专辑顺序"（手动专辑=加入顺序，标签专辑=打标签顺序）
const albumSort = ref<SortMode>('page')
const sortOptions = computed(() => getPlaylistSortOptions())

async function onAlbumSortChange() {
  gallery.page = 1
  await gallery.loadVideos({ sort: albumSort.value })
}



onMounted(async () => {
  document.addEventListener('lg-context-action', onContextAction)
  const id = route.params.id as string
  if (!library.activeLibraryId) await library.loadLibraries()
  // 侧栏全局显示：确保分类已加载（幂等，避免重复请求）
  if (!gallery.categories.length) await gallery.loadCategories()
  await album.loadAlbum(id)
  gallery.viewMode = 'album-detail'
  gallery.albumId = id
  gallery.category = null
  gallery.page = 1
  await gallery.loadVideos({ sort: albumSort.value })
})

onUnmounted(() => {
  document.removeEventListener('lg-context-action', onContextAction)
})



async function playAll() {
  if (player.open) return
  const albumId = route.params.id as string
  // 全量播放：page_size=0 后端返回专辑全部视频（不依赖当前页/每页大小），
  // 避免大专辑只播第一页前 40 个
  const data = await getVideos({ album_id: albumId, page_size: 0, sort: 'page' })
  if (!data.items.length) return
  await onPlay(data.items[0].id, data.items)
}

async function onPageSizeChange(size: number) {
  customPageSize.value = ''
  gallery.setPageSize(size, settings.preset)
  await gallery.loadVideos({ sort: albumSort.value })
}

async function onCustomPageSize(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const n = parseInt(customPageSize.value, 10)
  if (!Number.isFinite(n) || n < 1) return
  gallery.setPageSize(n, settings.preset)
  await gallery.loadVideos({ sort: albumSort.value })
}

async function changePage(next: number) {
  if (next < 1 || next > gallery.totalPages) return
  gallery.page = next
  await gallery.loadVideos({ sort: albumSort.value })
}



async function removeFromAlbum(id: string) {
  const albumId = route.params.id as string
  const ok = await ui.showConfirm(t('album.removeVideoConfirm'))
  if (!ok) return
  await removeVideosFromAlbum(albumId, [id])
  await gallery.loadVideos({ sort: albumSort.value })
  await album.loadAlbum(albumId)
}



function onVideoContext(e: MouseEvent, videoId: string) {
  // 全局视频菜单（含按收藏/专辑状态动态文案）+ 专辑上下文附加项；play/rename/delete 等 action 由 App 全局处理器统一处理
  const video = gallery.videos.find((v) => v.id === videoId)
  ui.showContextMenu(
    e,
    [
      ...videoContextMenuItems(video),
      { label: t('album.setCover'), action: 'set-cover' },
      { label: t('album.removeVideo'), action: 'remove', danger: true },
    ],
    { targetId: videoId, targetType: 'video' },
  )
}



async function onContextAction(ev: Event) {
  // 仅处理专辑上下文特有 action；其余（播放/收藏/重命名/删除等）由 App.vue 全局 handler 处理
  const detail = (ev as CustomEvent).detail as { action: string; targetId?: string }
  const id = detail.targetId
  if (!id) return
  if (detail.action === 'remove') await removeFromAlbum(id)
  else if (detail.action === 'set-cover') {
    const albumId = route.params.id as string
    await setAlbumCover(albumId, id)
    await album.loadAlbum(albumId)
    ui.showToast(t('album.coverUpdated'))
  }
}

</script>



<template>

  <div class="flex h-full min-h-0 flex-col">

    <AppHeader />

    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'classic'" />
      <main class="flex min-h-0 flex-1 flex-col overflow-hidden p-4">

      <button class="mb-4 shrink-0 self-start text-sm text-[var(--lg-text-muted)] hover:text-[var(--lg-text-primary)]" @click="router.push('/albums')">

        ← {{ t('album.backToList') }}

      </button>

      <div class="mb-4 flex shrink-0 items-center gap-4">

        <div>

          <h2 class="text-xl font-medium">{{ album.currentAlbum?.name }}</h2>

          <p class="text-sm text-[var(--lg-text-muted)]">

            {{ t('album.videoCount', { n: album.currentAlbum?.video_count || 0 }) }}

            <span v-if="album.currentAlbum?.total_duration_sec">

              · {{ t('album.minutes', { n: Math.floor((album.currentAlbum.total_duration_sec || 0) / 60) }) }}

            </span>

          </p>

        </div>

        <select
          v-model="albumSort"
          class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-2 py-1 text-sm"
          @change="onAlbumSortChange"
        >
          <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <button

          class="ml-auto rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)]"

          @click="playAll"

        >

          {{ t('album.playAll') }}

        </button>

      </div>

      <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 overflow-y-auto pb-4">

        <VideoCard

          v-for="video in gallery.videos"

          :key="video.id"

          :video="video"

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

