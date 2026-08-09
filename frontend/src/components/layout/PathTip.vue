<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { thumbUrl } from '@/api/client'
import { t } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { formatDuration, formatSize, formatBadgeLabel } from '@/utils/format'

const settings = useSettingsStore()
const { visible, item, tipLeft, tipTop, measuring, pinned, afterLayout, closeTip } = usePathTip()
const { placeholderLoading, stopPreviewNow, previewRatio, previewFailed } = useHoverPreview()
const tipRef = ref<HTMLElement | null>(null)

// 悬浮预览启用：预览区渲染「加载占位」而非缩略图，视频就绪后在其上淡入播放
const hoverPreviewEnabled = computed(
  () => settings.settings?.html5_hover_preview !== false,
)

// 预览区渲染条件：预览开启且比例就绪（有真实尺寸才渲染，避免空容器挂 video 黑屏）
const previewAreaVisible = computed(
  () => hoverPreviewEnabled.value && !!previewRatio.value,
)

// 占位尺寸按原视频宽高比自适应：约束最大宽/高，竖屏（比例<1）宽度随高度反推
const PREVIEW_MAX_W = () => Math.min(window.innerWidth * 0.88, 1104)
const PREVIEW_MAX_H = () => Math.min(window.innerHeight * 0.7, 864)
const placeholderStyle = computed(() => {
  const ratio = previewRatio.value
  const maxW = PREVIEW_MAX_W()
  const maxH = PREVIEW_MAX_H()
  if (!ratio || ratio <= 0) {
    // 未知比例：默认 16:9 占位
    return { width: `${maxW}px`, aspectRatio: '16 / 9', maxWidth: `${maxW}px`, maxHeight: `${maxH}px` }
  }
  // 以宽度优先：w = maxW，h = w / ratio；若 h 超 maxH 则 h = maxH，w = h * ratio
  let w = maxW
  let h = maxW / ratio
  if (h > maxH) {
    h = maxH
    w = maxH * ratio
  }
  return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` }
})

// 视频比例变化（竖屏/横屏）后重新测量浮层尺寸并定位
// 等占位尺寸过渡（0.18s）完成后再测，避免取到过渡中间值
watch(previewRatio, () => {
  window.setTimeout(() => void nextTick(() => afterLayout(tipRef.value)), 200)
})

function onCloseTip() {
  stopPreviewNow()
  closeTip()
}

// 钉住模式：点击浮层外部任意位置等同关闭（与关闭按钮行为一致）
function onDocClick(e: MouseEvent) {
  if (!pinned) return
  const target = e.target as Node | null
  if (tipRef.value && target && tipRef.value.contains(target)) return
  onCloseTip()
}

watch(pinned, (v) => {
  if (v) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onUnmounted(() => document.removeEventListener('click', onDocClick))

function getPathDir(path: string, filename: string) {
  if (!path) return ''
  if (filename && path.endsWith(filename)) {
    return path.slice(0, path.length - filename.length).replace(/[\\/]+$/, '')
  }
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return idx >= 0 ? path.slice(0, idx) : ''
}

function shortenMiddle(str: string, maxLen: number) {
  if (!str || str.length <= maxLen) return str || ''
  const edge = Math.max(6, Math.floor((maxLen - 1) / 2))
  return `${str.slice(0, edge)}…${str.slice(-edge)}`
}

function formatTs(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  if (d.toDateString() === now.toDateString()) return t('tip.today', { time: `${hh}:${mm}` })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return t('tip.yesterday', { time: `${hh}:${mm}` })
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  if (d.getFullYear() === now.getFullYear()) return `${m}-${day} ${hh}:${mm}`
  return `${y}-${m}-${day} ${hh}:${mm}`
}

const dirSegments = computed(() => {
  const v = item.value
  if (!v) return []
  const dir = getPathDir(v.path, v.filename)
  const parts = dir.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 5) return parts
  return ['…', ...parts.slice(-(5 - 1))]
})

const techChips = computed(() => {
  const v = item.value
  if (!v) return []
  const chips: string[] = []
  const dur = formatDuration(v.durationSec)
  if (dur) chips.push(t('tip.duration', { dur }))
  if (v.formatBadge) chips.push(formatBadgeLabel(v.formatBadge))
  if (v.size) chips.push(formatSize(v.size))
  if (v.mtime) chips.push(t('tip.modified', { ts: formatTs(v.mtime) }))
  return chips
})

const userChips = computed(() => {
  const v = item.value
  if (!v) return []
  const chips: string[] = []
  if (v.favorited && v.favoritedAt) chips.push(t('tip.favoritedAt', { ts: formatTs(v.favoritedAt) }))
  else if (v.favorited) chips.push(t('tip.favorited'))
  if (v.playedAt) {
    const n = v.playCount || 1
    chips.push(t('tip.lastPlayed', { ts: formatTs(v.playedAt), n }))
  }
  return chips
})

function onImgLoad() {
  void nextTick(() => afterLayout(tipRef.value))
}

// 后端判定不可预览（previewable===false）：预览永不启动（useHoverPreview 直接跳过），
// previewRatio/previewFailed 都不会就绪 → 必须主动触发定位，否则浮层永远停在 (-9999,-9999) 屏幕外
const previewStatic = computed(() => item.value != null && item.value.previewable === false)

// 定位触发：
// - 预览开启且已启动：previewRatio 就绪（下方单独 watch）→ 定位
// - 其余"预览区形态立即确定"的场景（缩略图模式 / 不可预览静态提示 / 预览失败回退）：
//   浮层每次显示或切换视频（item.id 变化）都重新定位——不能只靠值变化触发，
//   否则快速切换两个 previewable===false 的视频时 previewStatic 恒为 true 不会触发
watch(
  () => [visible.value, item.value?.id, previewFailed.value, previewStatic.value],
  ([v]) => {
    if (!v) return
    if (!hoverPreviewEnabled.value || previewStatic.value || previewFailed.value) {
      void nextTick(() => afterLayout(tipRef.value))
    }
  },
)
watch(previewRatio, () => {
  window.setTimeout(() => void nextTick(() => afterLayout(tipRef.value)), 200)
})
</script>

<template>
  <div
    v-if="visible && item"
    ref="tipRef"
    class="path-tip"
    :class="{ 'path-tip--measuring': measuring }"
    role="tooltip"
    :style="{ left: `${tipLeft}px`, top: `${tipTop}px` }"
    :title="item.path"
  >
    <button
      v-if="pinned"
      class="path-tip-close"
      title="{{ t('tip.closePreview') }}"
      @click="onCloseTip"
    >
      ✕
    </button>
    <div class="path-tip-preview">
      <!-- 悬浮预览启用：预览区仅在视频比例就绪后渲染（直接以正确比例出现，
           不经过 16:9 占位 → 真实比例的横→竖变化，也不在加载中显示缩略图）；
           比例未就绪时预览区留空（浮层仅显示文字），就绪后 spinner → 视频淡入 -->
      <div
        v-if="previewAreaVisible"
        class="path-tip-preview--placeholder"
        :class="{ 'path-tip-preview--placeholder-idle': !placeholderLoading }"
        :style="placeholderStyle"
      >
        <span v-if="placeholderLoading" class="hover-preview-spinner" />
      </div>
      <!-- 悬浮预览关闭：回到缩略图展示（仅在设置关闭预览时；优先于"不支持预览"提示，
           用户没开预览时看到的应是缩略图而非提示） -->
      <template v-else-if="!hoverPreviewEnabled">
        <img
          v-if="item.thumbReady || item.thumbVersion"
          :src="thumbUrl(item.id, item.thumbVersion)"
          alt=""
          decoding="async"
          @load="onImgLoad"
        />
        <div v-else class="path-tip-preview--empty">{{ t('thumb.emptyHint') }}</div>
      </template>
      <!-- 预览已确认失败（error / seek 超时）：回退缩略图，避免预览区一片空白 -->
      <template v-else-if="previewFailed">
        <img
          v-if="item.thumbReady || item.thumbVersion"
          :src="thumbUrl(item.id, item.thumbVersion)"
          alt=""
          decoding="async"
          @load="onImgLoad"
        />
        <div v-else class="path-tip-preview--empty">{{ t('thumb.previewUnavailable') }}</div>
        <div class="path-tip-preview--fallback">{{ t('thumb.previewFailed') }}</div>
      </template>
      <!-- 后端已判定可播放但不支持悬停预览（伪装TS/MKV/HEVC 等，原生 <video> 解不了）：
           直接提示，不再尝试预览 -->
      <div v-else-if="item.previewable === false" class="path-tip-preview--unsupported">
        {{ t('thumb.previewUnsupported') }}
      </div>
      <span v-if="item.formatBadge" class="thumb-format-badge">{{ formatBadgeLabel(item.formatBadge) }}</span>
      <span v-if="item.durationSec" class="thumb-duration">{{ formatDuration(item.durationSec) }}</span>
    </div>
    <div class="path-tip-body">
      <div v-if="dirSegments.length" class="path-tip-dir">
        <template v-for="(seg, i) in dirSegments" :key="i">
          <span v-if="i > 0">\</span>
          <span>{{ seg }}</span>
        </template>
      </div>
      <div v-if="item.filename" class="path-tip-file" :title="item.filename">
        {{ shortenMiddle(item.filename, 40) }}
      </div>
      <div v-if="techChips.length" class="path-tip-meta">
        <span v-for="chip in techChips" :key="chip" class="path-tip-chip">{{ chip }}</span>
      </div>
      <div v-if="userChips.length" class="path-tip-meta">
        <span v-for="chip in userChips" :key="chip" class="path-tip-chip">{{ chip }}</span>
      </div>
    </div>
  </div>
</template>
