import { t } from '@/i18n'

export function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0 || !Number.isFinite(sec)) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const RESUME_MIN_SEC = 15
const RESUME_END_MARGIN_SEC = 45

export function normalizeResumePosition(pos: number, durationSec?: number | null): number | null {
  if (!Number.isFinite(pos) || pos < RESUME_MIN_SEC) return null
  if (durationSec != null && durationSec > 0 && pos >= durationSec - RESUME_END_MARGIN_SEC) return null
  return pos
}

export function getSavedPosition(
  playPosition?: number,
  playDuration?: number,
  enabled = true,
): number | null {
  if (!enabled) return null
  return normalizeResumePosition(Number(playPosition), playDuration)
}

// 函数内现算，保证切语言后 label 实时刷新
export function formatBadgeLabel(kind?: string | null): string {
  if (!kind) return ''
  const key = kind.toLowerCase()
  const labels: Record<string, string> = {
    special: t('other.format.special'),
    remuxable: t('other.format.repairable'),
    interleaved: t('other.format.interleaved'),
    disguised: t('other.format.disguised'),
    fragmented: t('other.format.fragmented'),
    unsupported: t('other.format.notPlayable'),
    hls: 'HLS',
    moov_end: t('other.format.moovEnd'),
    large: t('other.format.large'),
    transcode: t('other.format.special'),
  }
  return labels[key] ?? kind
}

