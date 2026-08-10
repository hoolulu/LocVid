<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { GRID_COLUMNS } from '@/constants/layout'
import { useSettingsStore } from '@/stores/settings'
import VideoCard from './VideoCard.vue'
import type { Video } from '@/types'

const props = defineProps<{
  videos: Video[]
  showPlayCount?: boolean
  showProgress?: boolean
  focusedId?: string | null
}>()

const emit = defineEmits<{
  play: [id: string]
  toggleFavorite: [id: string]
  contextmenu: [event: MouseEvent, id: string]
}>()

const settings = useSettingsStore()
const containerRef = ref<HTMLElement | null>(null)

const columns = computed(() => GRID_COLUMNS[settings.preset])
const rowHeight = computed(() => (settings.preset === 'cinema' ? 188 : 200))

const rows = computed(() => {
  const out: Video[][] = []
  const cols = columns.value
  for (let i = 0; i < props.videos.length; i += cols) {
    out.push(props.videos.slice(i, i + cols))
  }
  return out
})

const useVirtual = computed(() => props.videos.length > columns.value * 3)

const scrollTop = ref(0)
const viewportHeight = ref(600)
// rAF 节流：scroll 事件高频触发，合并到下一帧再更新，避免虚拟化重算阻塞
let scrollRaf = 0
function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
  })
}
onMounted(() => {
  if (containerRef.value) viewportHeight.value = containerRef.value.clientHeight
})

const visibleRange = computed(() => {
  if (!useVirtual.value) return { start: 0, end: rows.value.length }
  const total = rows.value.length
  if (total === 0) return { start: 0, end: 0 }
  // 边界保护：scrollTop 残留超过总行数时（切库/切分类后小库行数变少），
  // clamp 到最后一行而非越界空切片（rows.slice(start>total) 会渲染空白网格）
  const rawStart = Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - 2)
  const start = rawStart >= total ? Math.max(0, total - 1) : rawStart
  const visible = Math.ceil(viewportHeight.value / rowHeight.value) + 4
  const end = Math.min(total, start + visible)
  return { start, end }
})

// 列表切换（切库/切分类/翻页/搜索）时重置滚动到顶部：
// 否则残留 scrollTop 会让虚拟窗口落在新列表的错误位置（小库时甚至越界空白）。
// 注意用「内容签名」（首元素 id + 长度）而非数组引用：收藏/取消收藏触发的 loadVideos
// 会产生新数组引用但内容未变——若按引用重置，浏览中收藏卡片会误跳回顶部（回归）
watch(
  () => (props.videos.length > 0 ? `${props.videos[0].id}:${props.videos.length}` : ''),
  () => {
    scrollTop.value = 0
    const el = containerRef.value
    if (el && el.scrollTop !== 0) el.scrollTop = 0
  },
)

const visibleRows = computed(() => rows.value.slice(visibleRange.value.start, visibleRange.value.end))

const topPad = computed(() => visibleRange.value.start * rowHeight.value)
const bottomPad = computed(() => Math.max(0, (rows.value.length - visibleRange.value.end) * rowHeight.value))

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
}))
</script>

<template>
  <div
    ref="containerRef"
    class="video-grid min-h-0 flex-1 overflow-y-auto pb-4"
    :class="useVirtual ? '' : 'grid gap-3'"
    :style="useVirtual ? undefined : gridStyle"
    @scroll="onScroll"
  >
    <template v-if="!useVirtual">
      <VideoCard
        v-for="video in videos"
        :key="video.id"
        :video="video"
        :show-play-count="showPlayCount"
        :show-progress="showProgress"
        :focused="focusedId === video.id"
        @play="emit('play', $event)"
        @toggle-favorite="emit('toggleFavorite', $event)"
        @contextmenu="emit('contextmenu', $event, video.id)"
      />
    </template>

    <template v-else>
      <div :style="{ height: `${topPad}px` }" />
      <div
        v-for="(row, ri) in visibleRows"
        :key="row[0]?.id ?? `row-${visibleRange.start + ri}`"
        class="video-grid-row mb-3 grid gap-3"
        :style="gridStyle"
      >
        <VideoCard
          v-for="video in row"
          :key="video.id"
          :video="video"
          :show-play-count="showPlayCount"
          :show-progress="showProgress"
          :focused="focusedId === video.id"
          @play="emit('play', $event)"
          @toggle-favorite="emit('toggleFavorite', $event)"
          @contextmenu="emit('contextmenu', $event, video.id)"
        />
      </div>
      <div :style="{ height: `${bottomPad}px` }" />
    </template>
  </div>
</template>
