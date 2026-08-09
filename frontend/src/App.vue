<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useSSE } from '@/composables/useSSE'
import { usePlayerRestore } from '@/composables/usePlayerRestore'
import { usePlayerUrlSync } from '@/composables/usePlayerUrlSync'
import { useSettingsStore } from '@/stores/settings'
import PlayerView from '@/components/player/PlayerView.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import NonstandardDialog from '@/components/dialogs/NonstandardDialog.vue'
import AlbumPickerDialog from '@/components/dialogs/AlbumPickerDialog.vue'
import ThumbFailedDialog from '@/components/dialogs/ThumbFailedDialog.vue'
import ThumbPickerDialog from '@/components/dialogs/ThumbPickerDialog.vue'
import FolderMoveDialog from '@/components/dialogs/FolderMoveDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import VideoPropsDialog from '@/components/dialogs/VideoPropsDialog.vue'
import ContextMenu from '@/components/layout/ContextMenu.vue'
import PathTip from '@/components/layout/PathTip.vue'
import { setupVideoContextActions } from '@/composables/useVideoContextActions'
import { useRoute } from 'vue-router'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { useThumbProgress } from '@/composables/useThumbProgress'

const settings = useSettingsStore()
const ui = useUiStore()
const gallery = useGalleryStore()
const library = useLibraryStore()
const player = usePlayerStore()
const route = useRoute()
const { refresh: refreshThumbProgress, notifyIncoming } = useThumbProgress()
const { tryRestore } = usePlayerRestore()
const { playIdFromUrl } = usePlayerUrlSync()
const { closeTip } = usePathTip()
const { stopPreviewNow } = useHoverPreview()

setupVideoContextActions()

// 路由切换（切页到收藏/历史/专辑等）时清理悬停浮层与预览：
// 否则浮层跨页残留（钉住模式永久显示），预览 <video> 继续静音播放占带宽（P2）
watch(
  () => route.name,
  () => {
    closeTip()
    stopPreviewNow()
  },
)

const { connect, disconnect } = useSSE(
  // 新影片入库（watchdog 广播 version）→ 顶部任务条闪示「检测到新影片，开始处理…」。
  // 切库握手窗口已被 useSSE suppressVersionLoad 抑制，不会误触发。
  () => notifyIncoming(),
  () => refreshThumbProgress(),
)

watch(
  () => library.activeLibraryId,
  (id, prev) => {
    if (prev && id && id !== prev) {
      disconnect()
      connect()
    }
  },
)

onMounted(() => {
  connect()
  void settings.loadSettings()
  window.setTimeout(() => void refreshThumbProgress(), 300)
  document.addEventListener('keydown', onGlobalKeydown)
})

watch(
  () => ui.manageMode,
  (v) => document.body.classList.toggle('manage-mode', v),
  { immediate: true },
)

watch(
  () => ui.selectedCount,
  (n) => document.body.classList.toggle('has-selection', n > 0),
  { immediate: true },
)

watch(
  () => [library.activeLibraryId, playIdFromUrl()] as const,
  async ([libId, playId]) => {
    if (!libId || !playId || player.open) return
    await tryRestore(playId)
  },
  { immediate: true },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (e.key === '/' && !inInput && !player.open) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus()
    return
  }
  if (e.key === 'Escape' && inInput && target.matches('[data-testid="search-input"]')) {
    gallery.query = ''
    gallery.page = 1
    void gallery.loadVideos()
    ;(target as HTMLInputElement).blur()
    return
  }
  if (player.open || inInput) return
  if (route.name === 'browse' && gallery.totalPages > 1) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (gallery.page > 1) {
        gallery.page -= 1
        void gallery.loadVideos()
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (gallery.page < gallery.totalPages) {
        gallery.page += 1
        void gallery.loadVideos()
      }
    }
  }
}

</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <RouterView />
  </div>

  <PlayerView />
  <SettingsDialog />
  <NonstandardDialog />
  <AlbumPickerDialog />
  <ThumbFailedDialog />
  <ThumbPickerDialog />
  <FolderMoveDialog />
  <ConfirmDialog />
  <VideoPropsDialog />
  <ContextMenu />
  <PathTip />

  <div v-if="ui.toast" class="lg-toast">
    <svg class="lg-toast-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12l4 4L19 6"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span>{{ ui.toast.message }}</span>
  </div>

</template>
