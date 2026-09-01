import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SortMode, Video } from '@/types'
import type { PlaylistContext } from '@/utils/playlist'
import type { createMoviPlayer } from '@/composables/useMoviPlayer'

export const usePlayerStore = defineStore('player', () => {
  const open = ref(false)
  const playingId = ref<string | null>(null)
  const playingItem = ref<Video | null>(null)
  const playSession = ref(0)
  const playlist = ref<Video[]>([])
  const playlistSort = ref<SortMode>('page')
  const playlistRandomSeed = ref<number | null>(null)
  const activeSliceVideoId = ref<string | null>(null)
  const overlayVisible = ref(false)
  const overlayTitle = ref('')
  const overlayDetail = ref('')
  const overlayProgress = ref<number | null>(null)
  const overlayIndeterminate = ref(false)
  const statusText = ref('')
  const videoEl = ref<HTMLVideoElement | null>(null)
  const canvasEl = ref<HTMLCanvasElement | null>(null)
  const subtitleEl = ref<HTMLDivElement | null>(null)
  const moviPlayer = ref<ReturnType<typeof createMoviPlayer> | null>(null)
  // 宿主 div：命令式创建的 <movi-player> web 组件节点挂在这里
  const moviHostEl = ref<HTMLElement | null>(null)
  // 播放进度/状态（供自定义控制栏绑定）
  const currentTime = ref(0)
  const duration = ref(0)
  const isPaused = ref(true)
  const volume = ref(1)
  const muted = ref(false)
  const playlistContext = ref<PlaylistContext | null>(null)
  const playlistLoadedThrough = ref(0)
  const playlistTotalPages = ref(0)
  const playlistCanLoadMore = ref(false)
  const playlistLoading = ref(false)
  const lastPlayedItem = ref<Video | null>(null)
  // 页面隐藏（visibilitychange → hidden）时后台自动暂停：标记暂停 + 记录恢复位置
  const backgroundPaused = ref(false)
  const backgroundResumeAt = ref(0)

  function resetPlaylistMeta() {
    playlistContext.value = null
    playlistLoadedThrough.value = 0
    playlistTotalPages.value = 0
    playlistCanLoadMore.value = false
    playlistLoading.value = false
  }

  function bumpSession() {
    playSession.value += 1
    return playSession.value
  }

  function isStale(session: number) {
    return session !== playSession.value
  }

  function showOverlay(title: string, detail = '', opts: { progress?: number | null; indeterminate?: boolean } = {}) {
    overlayVisible.value = true
    overlayTitle.value = title
    overlayDetail.value = detail
    overlayProgress.value = opts.progress ?? null
    overlayIndeterminate.value = !!opts.indeterminate
  }

  function hideOverlay() {
    overlayVisible.value = false
    overlayTitle.value = ''
    overlayDetail.value = ''
    overlayProgress.value = null
    overlayIndeterminate.value = false
  }

  function openPlayer(item: Video, list: Video[] = []) {
    open.value = true
    playingId.value = item.id
    playingItem.value = item
    lastPlayedItem.value = item
    // 新一次播放/恢复都会消费掉后台暂停标记（避免残留遮罩错误出现在新视频上）
    backgroundPaused.value = false
    backgroundResumeAt.value = 0
    if (list.length) playlist.value = list
    else if (!playlist.value.find((v) => v.id === item.id)) {
      playlist.value = [item]
    }
  }

  function closePlayer() {
    if (playingItem.value) lastPlayedItem.value = playingItem.value
    open.value = false
    playingId.value = null
    playingItem.value = null
    backgroundPaused.value = false
    backgroundResumeAt.value = 0
    hideOverlay()
    statusText.value = ''
  }

  return {
    open,
    playingId,
    playingItem,
    playSession,
    playlist,
    playlistSort,
    playlistRandomSeed,
    activeSliceVideoId,
    overlayVisible,
    overlayTitle,
    overlayDetail,
    overlayProgress,
    overlayIndeterminate,
    statusText,
    videoEl,
    canvasEl,
    subtitleEl,
    moviPlayer,
    moviHostEl,
    currentTime,
    duration,
    isPaused,
    volume,
    muted,
    playlistContext,
    playlistLoadedThrough,
    playlistTotalPages,
    playlistCanLoadMore,
    playlistLoading,
    lastPlayedItem,
    backgroundPaused,
    backgroundResumeAt,
    resetPlaylistMeta,
    bumpSession,
    isStale,
    showOverlay,
    hideOverlay,
    openPlayer,
    closePlayer,
  }
})
