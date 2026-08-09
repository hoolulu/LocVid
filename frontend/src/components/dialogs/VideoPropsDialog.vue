<script setup lang="ts">
import { ref, watch } from 'vue'
import { getVideoProps, type VideoProps } from '@/api'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { formatBadgeLabel } from '@/utils/format'

const ui = useUiStore()

const propsData = ref<VideoProps | null>(null)
const loading = ref(false)
const error = ref('')

function formatSize(bytes?: number) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDuration(sec?: number | null) {
  if (!sec || sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatTime(ts?: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function modeLabel(mode?: string) {
  const map: Record<string, string> = {
    direct: t('props.direct'),
    hls: t('props.hls'),
    unsupported: t('props.unsupported'),
  }
  return mode ? (map[mode] ?? mode) : '—'
}

watch(
  () => ui.videoPropsOpen,
  async (open) => {
    if (!open || !ui.videoPropsId) return
    loading.value = true
    error.value = ''
    propsData.value = null
    try {
      propsData.value = await getVideoProps(ui.videoPropsId)
    } catch {
      error.value = t('props.loadFailed')
    } finally {
      loading.value = false
    }
  },
)

function onClose() {
  ui.closeVideoProps()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.videoPropsOpen" class="lg-modal-overlay" @click.self="onClose">
      <div class="lg-confirm-dialog" style="width: min(30rem, 92vw)" role="dialog" aria-modal="true">
        <h3 class="mb-3 flex items-center justify-between text-sm font-semibold">
          <span>{{ t('props.title') }}</span>
          <button
            type="button"
            class="rounded px-2 text-[var(--lg-text-muted)] lg-hover"
            :aria-label="t('common.close')"
            @click="onClose"
          >
            ✕
          </button>
        </h3>

        <div v-if="loading" class="py-8 text-center text-sm text-[var(--lg-text-muted)]">{{ t('common.loading') }}</div>
        <div v-else-if="error" class="py-8 text-center text-sm text-red-400">{{ error }}</div>

        <dl v-else-if="propsData" class="space-y-2 text-sm">
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.name') }}</dt>
            <dd class="min-w-0 break-words">{{ propsData.title }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.filename') }}</dt>
            <dd class="min-w-0 break-words">{{ propsData.filename }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.path') }}</dt>
            <dd class="min-w-0 break-all text-xs text-[var(--lg-text-secondary)]">{{ propsData.path }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.category') }}</dt>
            <dd>{{ propsData.category }}<template v-if="propsData.subfolder"> / {{ propsData.subfolder }}</template></dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.size') }}</dt>
            <dd>{{ formatSize(propsData.size) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.duration') }}</dt>
            <dd>{{ formatDuration(propsData.duration_sec) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.codec') }}</dt>
            <dd>{{ propsData.codec || '—' }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.container') }}</dt>
            <dd>{{ propsData.container || '—' }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.format') }}</dt>
            <dd>{{ propsData.formatBadge ? formatBadgeLabel(propsData.formatBadge) : '—' }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.playMode') }}</dt>
            <dd>{{ modeLabel(propsData.mode) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.modified') }}</dt>
            <dd>{{ formatTime(propsData.mtime) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.playCount') }}</dt>
            <dd>{{ propsData.playCount || 0 }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.lastPlayed') }}</dt>
            <dd>{{ formatTime(propsData.playedAt) }}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-[var(--lg-text-muted)]">{{ t('props.favorited') }}</dt>
            <dd>{{ propsData.favorited ? t('props.yes') : t('props.no') }}</dd>
          </div>
        </dl>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover"
            @click="onClose"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
