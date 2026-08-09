<script setup lang="ts">
import { computed, ref } from 'vue'
import { thumbUrl } from '@/api/client'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import type { Video } from '@/types'
import { formatBadgeLabel } from '@/utils/format'

const props = defineProps<{
  video: Video
  showPlayCount?: boolean
  showProgress?: boolean
  focused?: boolean
}>()

const emit = defineEmits<{
  play: [id: string]
  toggleFavorite: [id: string]
  contextmenu: [event: MouseEvent]
}>()

const ui = useUiStore()
const gallery = useGalleryStore()
const settings = useSettingsStore()
const { scheduleShow, onAnchorLeave, pinned, hide } = usePathTip()
const { startPreview, stopPreview, stopPreviewNow } = useHoverPreview()

// 缩略图加载失败自动重试一次（切库/并发高峰期偶发失败/404 → 避免卡片永久空白）
const thumbRetry = ref<Record<string, number>>({})
function onThumbError(e: Event) {
  const img = e.target as HTMLImageElement
  const vid = img.dataset.vid
  if (!vid) return
  const n = thumbRetry.value[vid] || 0
  if (n >= 1) return // 只重试一次
  thumbRetry.value[vid] = n + 1
  const src = img.getAttribute('src') || ''
  // 加时间戳参数强制绕过浏览器错误缓存，重新发起请求
  img.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + Date.now()
}

const isSelected = computed(() => ui.selectedIds.has(props.video.id))
const albumCount = computed(() => props.video.albumIds?.length || 0)
const albumTitle = computed(() =>
  albumCount.value > 0 ? t('album.inN', { n: albumCount.value }) : t('album.add'),
)

/** 搜索关键词高亮：仅当全局搜索词命中标题时渲染 <mark>（HTML 已转义，防注入） */
const highlightedTitle = computed(() => {
  const title = props.video.title
  const q = gallery.query?.trim()
  if (!q) return ''
  const idx = title.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return ''
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  return (
    esc(title.slice(0, idx)) +
    `<mark>${esc(title.slice(idx, idx + q.length))}</mark>` +
    esc(title.slice(idx + q.length))
  )
})

const progressPct = computed(() => {
  if (!props.video.playDuration || !props.video.playPosition) return 0
  return Math.min(100, (props.video.playPosition / props.video.playDuration) * 100)
})

function formatDuration(sec?: number) {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function thumbPlaceholder() {
  if (props.video.thumbStatus === 'generating') return t('thumb.generating')
  if (props.video.thumbStatus === 'failed') return t('thumb.failed')
  return t('thumb.none')
}

function onCardClick() {
  if (ui.manageMode || ui.selectedCount > 0) {
    ui.toggleSelect(props.video.id)
    return
  }
  // 进入播放页：立即关闭预览浮层与预览视频（含钉住模式），
  // 避免点击卡片后预览浮层残留（视频还在播放）。
  stopPreviewNow()
  hide()
  emit('play', props.video.id)
}

function onCheckChange(e: Event) {
  e.stopPropagation()
  ui.toggleSelect(props.video.id)
}
</script>

<template>
  <article
    class="video-card group relative w-full cursor-pointer self-start overflow-hidden rounded-[var(--lg-radius)] bg-[var(--lg-bg-elevated)] transition"
    :class="{ 'video-card--selected': isSelected, 'video-card--focused': focused }"
    :data-video-id="video.id"
    data-testid="video-card"
    @click="onCardClick"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div
      class="thumb-wrap relative aspect-video bg-[var(--lg-thumb-placeholder-bg)]"
      @mouseenter="(e) => {
        scheduleShow(video, e.currentTarget as HTMLElement)
        // 钉住中（浮层保留）不启动新卡片预览；否则正常启动
        if (!pinned) startPreview(video)
      }"
      @mouseleave="(e) => {
        const anchor = e.currentTarget as HTMLElement
        onAnchorLeave(e, anchor)
        // 钉住模式：浮层保留（含预览视频继续播放），由关闭按钮统一停止
        if (settings.settings?.html5_hover_tip_pin === false) stopPreview()
      }"
    >
      <!-- 不用 loading="lazy"：虚拟网格（VirtualVideoGrid）已只渲染视口附近的行，
           首屏 img 本应立即可见；lazy 判定基于 img 视口位置，切库/滚动瞬间 topPad 高度
           变化中会被误判"视口外"而推迟/不加载 → 大量缩略图空白（偶发，刷新才好） -->
      <img
        v-if="video.thumbReady"
        :src="thumbUrl(video.id, video.thumbVersion)"
        :alt="video.title"
        :data-vid="video.id"
        class="h-full w-full object-cover"
        @error="onThumbError"
      />
      <div
        v-else
        class="flex h-full flex-col items-center justify-center text-sm text-[var(--lg-text-muted)]"
        :class="{ 'animate-pulse': video.thumbStatus === 'generating' }"
      >
        {{ thumbPlaceholder() }}
      </div>
      <div
        v-if="showProgress && progressPct > 2"
        class="absolute bottom-0 left-0 right-0 z-[1] h-1 bg-black/40"
      >
        <div class="h-full bg-[var(--lg-accent)]" :style="{ width: `${progressPct}%` }" />
      </div>
      <span v-if="video.formatBadge" class="thumb-overlay thumb-format-badge">
        {{ formatBadgeLabel(video.formatBadge) }}
      </span>
      <span v-if="video.durationSec" class="thumb-overlay thumb-duration">
        {{ formatDuration(video.durationSec) }}
      </span>
      <span
        v-if="showPlayCount && video.playCount"
        class="thumb-overlay thumb-play-count"
      >
        ▶ {{ video.playCount }}
      </span>
      <button
        type="button"
        class="card-album-badge"
        :class="{ on: albumCount > 0 }"
        :title="albumTitle"
        :aria-label="albumTitle"
        @click.stop="ui.openAlbumPicker([video.id])"
      >
        <svg class="card-album-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="card-fav"
        :class="{ on: video.favorited }"
      :title="video.favorited ? t('fav.remove') : t('fav.add')"
      :aria-label="video.favorited ? t('fav.remove') : t('fav.add')"
        @click.stop="emit('toggleFavorite', video.id)"
      >
        ♥
      </button>
    </div>

    <input
      type="checkbox"
      class="card-check"
      :checked="isSelected"
      :aria-label="t('batch.selectItem')"
      @click.stop
      @change="onCheckChange"    />

    <div class="card-title-wrap px-2 pb-2 pt-1.5">
      <h3 class="card-title line-clamp-2 text-sm leading-snug">
        <span v-if="highlightedTitle" v-html="highlightedTitle" />
        <template v-else>{{ video.title }}</template>
      </h3>
      <p
        v-if="gallery.viewMode === 'history' && video.playedAt"
        class="mt-1 text-xs text-[var(--lg-text-muted)]"
      >
        {{ new Date(video.playedAt * 1000).toLocaleDateString() }}
      </p>
    </div>
  </article>
</template>
