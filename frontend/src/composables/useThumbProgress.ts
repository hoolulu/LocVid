import { computed, ref } from 'vue'
import { getThumbStatus, getDurationStatus, getGlobalRemuxStatus, pauseThumbs, resumeThumbs } from '@/api/thumbs'
import { t } from '@/i18n'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'

export type ThumbProgressBarMode = 'auto' | 'always' | 'never'

type ThumbProgress = Record<string, unknown>
type DurationStatus = Record<string, unknown>

export interface RemuxRunning {
  library_id: string
  video_id: string
  title?: string
  progress_pct?: number
  message?: string
}
export interface RemuxStatus {
  active?: boolean
  running?: RemuxRunning[]
  queued?: number
  done_total?: number
  failed_keys?: number
}

const thumbProgress = ref<ThumbProgress | null>(null)
const durationStatus = ref<DurationStatus | null>(null)
const remuxStatus = ref<RemuxStatus | null>(null)
const userDismissed = ref(false)
const manualExpand = ref(false)

/** 最近完成的后台任务（顶部任务条显示「✓ 完成」闪示用） */
export const lastCompleted = ref<{ task: 'all'; at: number } | null>(null)
let completionTimer: ReturnType<typeof setTimeout> | null = null
// 上一轮是否「任一任务忙碌」（忙碌→全空闲 即视为「处理完成」）
let prevAnyBusy = false

/** 新影片入库提示（SSE version 事件触发）：顶部任务条闪示「检测到新影片」 */
export const incomingFlash = ref(false)
let incomingTimer: ReturnType<typeof setTimeout> | null = null
export function notifyIncoming() {
  incomingFlash.value = true
  if (incomingTimer) clearTimeout(incomingTimer)
  incomingTimer = setTimeout(() => {
    incomingFlash.value = false
  }, 5000)
}

export function normalizeThumbProgressBar(mode: string | undefined): ThumbProgressBarMode {
  const m = (mode || 'auto').trim().toLowerCase()
  if (m === 'always' || m === 'never') return m
  return 'auto'
}

function computePageThumbStats() {
  const gallery = useGalleryStore()
  const items = gallery.videos
  let ready = 0
  let generating = 0
  let queued = 0
  let missing = 0
  for (const v of items) {
    if (v.thumbReady || v.thumbStatus === 'ready') ready += 1
    else if (v.thumbStatus === 'generating') generating += 1
    else if (v.thumbStatus === 'failed') {
      /* counted separately */
    } else missing += 1
  }
  return { total: items.length, ready, generating, queued, missing }
}

function isPageThumbActive() {
  const gallery = useGalleryStore()
  if (!gallery.videos.length) return false
  const s = computePageThumbStats()
  return s.generating + s.queued + s.missing > 0
}

function isThumbProgressIdle(global: ThumbProgress | null) {
  if (!global) return !isPageThumbActive()
  const failCount = (global.failed as number) ?? 0
  if (failCount > 0) return false
  if (global.paused) return false
  const generating = (global.generating as number) ?? 0
  const queueSize = (global.queue_size as number) ?? 0
  if (generating > 0 || queueSize > 0) return false
  if (!global.idle_scan) return !isPageThumbActive()
  if (((global.missing as number) ?? 0) > 0) return false
  const notReady = Math.max(0, ((global.total as number) ?? 0) - ((global.ready as number) ?? 0))
  return notReady === 0
}

function isDurationWorkActive(st: DurationStatus | null) {
  if (!st) return false
  if (((st.pending as number) ?? 0) > 0) return true
  if (((st.queued as number) ?? 0) > 0) return true
  if (((st.probing as number) ?? 0) > 0) return true
  if (((st.remaining as number) ?? 0) > 0) return true
  return false
}

function formatDurationProgressText(st: DurationStatus | null) {
  if (!st) return t('thumb.probeLoading')
  if (st.fallback) {
    return t('thumb.probePage', { c: st.cached, t: st.total, p: st.percent ?? 0 })
  }
  const remaining = Math.max(0, ((st.remaining as number) ?? (st.pending as number)) ?? 0)
  const workersTotal = (st.workers_total as number) ?? (st.worker_count as number) ?? 2
  const workersActive = (st.workers_active as number) ?? (st.probing as number) ?? 0
  const rate = Number(st.rate_per_min) || 0
  let detail = t('thumb.probeRemain', { n: remaining })
  if (rate > 0) {
    detail += t('thumb.probeRate', { n: rate })
    const etaMin = Math.ceil(remaining / rate)
    if (etaMin > 0 && etaMin < 9999) detail += t('thumb.probeEta', { n: etaMin })
  }
  detail += t('thumb.probeWorkers', { n: workersTotal })
  if (workersActive > 0) {
    detail += t('thumb.probeActive', { n: workersActive })
  }
  const skipPart = st.skipped ? t('thumb.probeSkipped', { n: st.skipped }) : ''
  return t('thumb.probeText', { c: st.cached ?? 0, t: st.total ?? 0, p: st.percent ?? 0, d: detail, s: skipPart })
}

export function useThumbProgress() {
  const settings = useSettingsStore()
  const gallery = useGalleryStore()

  const mode = computed(() =>
    normalizeThumbProgressBar(settings.settings?.thumb_progress_bar),
  )

  const thumbIdle = computed(() => isThumbProgressIdle(thumbProgress.value))
  const durationBusy = computed(() => isDurationWorkActive(durationStatus.value))
  const remuxBusy = computed(() => {
    const st = remuxStatus.value
    if (!st) return false
    if (st.active) return true
    return ((st.running?.length ?? 0) > 0) || ((st.queued ?? 0) > 0)
  })

  function formatRemuxText(st: RemuxStatus | null) {
    if (!st || (!st.active && !(st.running?.length ?? 0) && !(st.queued ?? 0))) {
      return t('task.remuxIdle')
    }
    const running = st.running?.[0]
    if (running) {
      const pct = Math.round(running.progress_pct ?? 0)
      const title = running.title || running.video_id
      return t('task.remuxing', { title, p: pct })
    }
    return t('task.remuxQueued', { q: st.queued ?? 0 })
  }

  /** 任务从忙碌 → 全空闲 即视为「处理完成」：记录「✓ 全部处理完成」闪示（5s 后自动清除） */
  function detectCompletion() {
    const anyBusy = !thumbIdle.value || durationBusy.value || remuxBusy.value
    if (prevAnyBusy && !anyBusy) {
      lastCompleted.value = { task: 'all', at: Date.now() }
      if (completionTimer) clearTimeout(completionTimer)
      completionTimer = setTimeout(() => {
        lastCompleted.value = null
      }, 5000)
    }
    prevAnyBusy = anyBusy
  }

  /** 当前主导阶段（严格串行：修复 → 缩略图 → 时长；展示层按优先级显示当前阶段） */
  const stage = computed<'repair' | 'thumb' | 'duration' | 'idle'>(() => {
    if (remuxBusy.value) return 'repair'
    if (!thumbIdle.value) return 'thumb'
    if (durationBusy.value) return 'duration'
    return 'idle'
  })

  /** 单任务条：当前阶段徽标文案 */
  const stageLabel = computed(() => {
    switch (stage.value) {
      case 'repair':
        return t('task.remuxLabel')
      case 'thumb':
        return t('task.thumbLabel')
      case 'duration':
        return t('task.durationLabel')
      default:
        return ''
    }
  })

  /** 单任务条：当前阶段主文本 */
  const pipelineText = computed(() => {
    switch (stage.value) {
      case 'repair':
        return formatRemuxText(remuxStatus.value)
      case 'thumb': {
        const g = thumbProgress.value
        if (g?.total) return t('thumb.progressAll', { r: g.ready, t: g.total, p: g.percent, page: '' })
        return progressText.value
      }
      case 'duration':
        return formatDurationProgressText(durationStatus.value)
      default:
        return ''
    }
  })

  /** 单任务条：当前阶段进度（0-100） */
  const stagePercent = computed(() => {
    switch (stage.value) {
      case 'repair':
        return (remuxStatus.value?.running?.[0]?.progress_pct ?? 0)
      case 'thumb':
        return (thumbProgress.value?.percent as number) ?? 0
      case 'duration':
        return (durationStatus.value?.percent as number) ?? 0
      default:
        return 0
    }
  })

  /** 单任务条：总况汇总（影片数 + 缩略图就绪，不统计时长） */
  const pipelineSummary = computed(() => {
    const g = thumbProgress.value
    if (!g || !g.total) return ''
    return t('task.summary', { t: g.total, r: g.ready ?? 0 })
  })

  const showBar = computed(() => {
    if (mode.value === 'always') return true
    if (mode.value === 'never') return durationBusy.value || remuxBusy.value
    if (!thumbIdle.value || durationBusy.value || remuxBusy.value) return !userDismissed.value
    return manualExpand.value
  })

  const showThumbChip = computed(() => mode.value === 'auto')

  const thumbDotClass = computed(() => {
    const g = thumbProgress.value
    const failCount = (g?.failed as number) ?? 0
    if (failCount > 0) return 'thumb-status-dot--fail'
    if (!thumbIdle.value) return 'thumb-status-dot--busy'
    return 'thumb-status-dot--ok'
  })

  const thumbChipTitle = computed(() => {
    if (!thumbIdle.value && userDismissed.value) return t('thumb.statusIdle')
    if (showBar.value) return t('thumb.statusHide')
    return t('thumb.statusDetail')
  })

  const progressText = computed(() => {
    const g = thumbProgress.value
    const page = computePageThumbStats()
    if (g?.total) {
      const pagePart = page.total ? t('thumb.progressPagePart', { r: page.ready, t: page.total }) : ''
      let text =
        t('thumb.progressAll', { r: g.ready, t: g.total, p: g.percent, page: pagePart }) +
        t('thumb.progressQueue', { q: g.queue_size ?? 0, g: g.generating ?? 0 }) +
        t('thumb.progressMissing', { n: g.missing ?? 0 })
      if (!thumbIdle.value && isPageThumbActive()) text += t('thumb.progressActive')
      return text
    }
    if (isPageThumbActive()) return t('thumb.progressPageActive', { r: page.ready, t: page.total })
    return t('thumb.progressLoading')
  })

  const durationHint = computed(() => {
    const st = durationStatus.value
    if (st?.fallback) {
      return t('thumb.legacyHint')
    }
    return t('thumb.probeHint')
  })

  async function refresh() {
    // allSettled：单个接口失败（如旧后端无 /api/remux/status）不影响其余状态更新
    const [thumb, duration, remux] = await Promise.allSettled([
      getThumbStatus(),
      getDurationStatus(),
      getGlobalRemuxStatus(),
    ])
    if (thumb.status === 'fulfilled') thumbProgress.value = thumb.value
    if (duration.status === 'fulfilled') durationStatus.value = duration.value
    if (remux.status === 'fulfilled') remuxStatus.value = remux.value
    detectCompletion()
  }

  async function togglePause() {
    if (thumbProgress.value?.paused) await resumeThumbs()
    else await pauseThumbs()
    thumbProgress.value = await getThumbStatus()
  }

  function toggleBar() {
    if (mode.value !== 'auto') return
    // 任一任务活跃（修复/缩略图/时长）：点右上角 chip = 收起/恢复任务条（记住用户选择）
    if (!thumbIdle.value || durationBusy.value || remuxBusy.value) {
      userDismissed.value = !userDismissed.value
    } else {
      // 全空闲：点 chip = 展开/收起缩略图总况详情（HeaderProgressBar 空闲详情分支）
      manualExpand.value = !manualExpand.value
    }
  }

  function resetDismiss() {
    userDismissed.value = false
    manualExpand.value = false
  }

  return {
    thumbProgress,
    durationStatus,
    remuxStatus,
    lastCompleted,
    incomingFlash,
    notifyIncoming,
    mode,
    showBar,
    manualExpand,
    showThumbChip,
    thumbDotClass,
    thumbChipTitle,
    progressText,
    durationHint,
    durationBusy,
    remuxBusy,
    thumbIdle,
    stage,
    stageLabel,
    pipelineText,
    stagePercent,
    pipelineSummary,
    formatDurationProgressText,
    formatRemuxText,
    refresh,
    togglePause,
    toggleBar,
    resetDismiss,
    isPageThumbActive: () => isPageThumbActive(),
    gallery,
  }
}
