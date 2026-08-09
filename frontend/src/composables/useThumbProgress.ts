import { computed, ref } from 'vue'
import { getThumbStatus, getDurationStatus, pauseThumbs, resumeThumbs } from '@/api/thumbs'
import { t } from '@/i18n'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'

export type ThumbProgressBarMode = 'auto' | 'always' | 'never'

type ThumbProgress = Record<string, unknown>
type DurationStatus = Record<string, unknown>

const thumbProgress = ref<ThumbProgress | null>(null)
const durationStatus = ref<DurationStatus | null>(null)
const userDismissed = ref(false)
const manualExpand = ref(false)

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

  const showBar = computed(() => {
    if (mode.value === 'always') return true
    if (mode.value === 'never') return durationBusy.value
    if (!thumbIdle.value || durationBusy.value) return !userDismissed.value
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
    const [thumb, duration] = await Promise.all([getThumbStatus(), getDurationStatus()])
    thumbProgress.value = thumb
    durationStatus.value = duration
  }

  async function togglePause() {
    if (thumbProgress.value?.paused) await resumeThumbs()
    else await pauseThumbs()
    thumbProgress.value = await getThumbStatus()
  }

  function toggleBar() {
    if (mode.value !== 'auto') return
    if (!thumbIdle.value || durationBusy.value) {
      userDismissed.value = !userDismissed.value
    } else {
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
    mode,
    showBar,
    showThumbChip,
    thumbDotClass,
    thumbChipTitle,
    progressText,
    durationHint,
    durationBusy,
    thumbIdle,
    formatDurationProgressText,
    refresh,
    togglePause,
    toggleBar,
    resetDismiss,
    isPageThumbActive: () => isPageThumbActive(),
    gallery,
  }
}
