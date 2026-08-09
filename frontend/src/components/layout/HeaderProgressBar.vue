<script setup lang="ts">
import { useThumbProgress } from '@/composables/useThumbProgress'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const {
  thumbProgress,
  durationStatus,
  showBar,
  progressText,
  durationHint,
  durationBusy,
  formatDurationProgressText,
  togglePause,
} = useThumbProgress()
</script>

<template>
  <div
    class="progress-bar-wrap"
    :class="{ 'progress-bar-collapsed': !showBar }"
  >
    <div class="progress-info">
      <div class="progress-info-left">
        <span class="progress-text">{{ progressText }}</span>
        <span
          v-if="thumbProgress?.idle_scan"
          class="idle-scan-badge"
          :title="t('thumb.progressTip')"
        >
          {{ t('thumb.backfill') }}
        </span>
      </div>
      <div class="progress-actions">
        <button
          v-if="!thumbProgress?.paused"
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          {{ t('thumb.pause') }}
        </button>
        <button
          v-else
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          {{ t('thumb.resume') }}
        </button>
        <button
          v-if="((thumbProgress?.failed as number) ?? 0) > 0"
          type="button"
          class="progress-btn"
          @click="ui.thumbFailedOpen = true"
        >
          {{ t('thumb.failedCount', { n: thumbProgress?.failed as number }) }}
        </button>
      </div>
    </div>
    <div class="progress-track">
      <div
        class="progress-fill"
        :style="{ width: `${Math.max(0, Math.min(100, (thumbProgress?.percent as number) ?? 0))}%` }"
      />
    </div>

    <div v-if="durationBusy" class="duration-progress-wrap">
      <div class="progress-info">
        <div class="progress-info-left">
          <span class="progress-text">{{ formatDurationProgressText(durationStatus) }}</span>
        </div>
      </div>
      <div class="progress-track">
        <div
          class="progress-fill duration-progress-fill"
          :style="{ width: `${Math.max(0, Math.min(100, (durationStatus?.percent as number) ?? 0))}%` }"
        />
      </div>
      <p class="duration-progress-hint">{{ durationHint }}</p>
    </div>
  </div>
</template>
