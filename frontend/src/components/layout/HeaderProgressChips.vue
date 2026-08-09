<script setup lang="ts">
import { useThumbProgress } from '@/composables/useThumbProgress'
import { t } from '@/i18n'

const {
  showThumbChip,
  thumbDotClass,
  thumbChipTitle,
  showBar,
  durationBusy,
  toggleBar,
} = useThumbProgress()
</script>

<template>
  <button
    v-if="durationBusy"
    type="button"
    class="thumb-status-chip"
    :class="{ 'thumb-status-chip--expanded': showBar }"
    :title="t('thumb.probeTip')"
    :aria-label="t('thumb.probeTitle')"
    @click="toggleBar"
  >
    <span class="thumb-status-dot thumb-status-dot--busy" aria-hidden="true" />
    <span class="thumb-status-label">{{ t('thumb.durationLabel') }}</span>
  </button>

  <button
    v-if="showThumbChip"
    type="button"
    class="thumb-status-chip"
    :class="{ 'thumb-status-chip--expanded': showBar }"
    :title="thumbChipTitle"
    :aria-expanded="showBar ? 'true' : 'false'"
    :aria-label="t('thumb.thumbnailLabel')"
    @click="toggleBar"
  >
    <span class="thumb-status-dot" :class="thumbDotClass" aria-hidden="true" />
    <span class="thumb-status-label">{{ t('thumb.thumbnailLabel') }}</span>
  </button>
</template>
