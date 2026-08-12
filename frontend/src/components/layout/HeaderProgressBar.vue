<script setup lang="ts">
import { computed } from 'vue'
import { useThumbProgress } from '@/composables/useThumbProgress'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const {
  thumbProgress,
  lastCompleted,
  incomingFlash,
  showBar,
  manualExpand,
  thumbPaused,
  completionActive,
  thumbIdle,
  durationBusy,
  stage,
  steps,
  pipelineText,
  stagePercent,
  progressText,
  pipelineSummary,
  togglePause,
  toggleBar,
  mode,
} = useThumbProgress()

// 全部处理完成闪示（5s 内显示；超时后 composable 清空 lastCompleted）
const completedFlash = computed(() => {
  if (!lastCompleted.value) return null
  if (Date.now() - lastCompleted.value.at > 5000) return null
  return t('task.allDone')
})

// 进度条轨道颜色（repair=琥珀 / thumb=主色 / duration=蓝）
const stageClass = computed(() => {
  if (stage.value === 'repair') return 'task-track--remux'
  if (stage.value === 'duration') return 'task-track--duration'
  return ''
})

// 进度条宽度
const barWidth = computed(() => `${Math.max(0, Math.min(100, stagePercent.value))}%`)

const pctText = computed(() => {
  // 完成闪示期间 stage 已归 idle，固定显示 100%
  if (completionActive.value) return '100%'
  const p = Math.round(stagePercent.value)
  // 大库 percent 失真：缩略图/时长阶段 percent = 全库 ready/total（数千视频恒≈100%），
  // 有新视频在生成却显示 100% 会让用户误以为卡住 → 改为显示"处理中"
  const busyButFull =
    (stage.value === 'thumb' && p >= 99 && !thumbIdle.value) ||
    (stage.value === 'duration' && p >= 99 && durationBusy.value)
  if (busyButFull) return '…'
  return `${p}%`
})

const failedCount = computed(() => (thumbProgress.value?.failed as number) ?? 0)
</script>

<template>
  <div
    class="progress-bar-wrap"
    :class="{ 'progress-bar-collapsed': !showBar }"
  >
    <!-- 处理中（或完成闪示期）：单行 = 状态徽标 + 步骤 stepper + 文本 + 进度条 + 百分比 + 操作 -->
    <div v-if="stage !== 'idle' || completedFlash" class="task-pipeline">
      <!-- 入库 / 完成状态徽标（行内显示，不额外占一行） -->
      <span
        v-if="incomingFlash"
        class="task-badge task-badge--incoming"
        :title="t('task.incoming')"
      >
        <span class="task-badge-icon">📥</span>{{ t('task.incomingShort') }}
      </span>
      <span
        v-else-if="completedFlash"
        class="task-badge task-badge--done"
        :title="completedFlash"
      >
        <span class="task-badge-icon">✓</span>{{ t('task.allDoneShort') }}
      </span>

      <!-- 入库处理管道步骤：修复 → 缩略图 → 时长 -->
      <div class="task-steps" aria-label="处理步骤">
        <template v-for="(s, i) in steps" :key="s.key">
          <span class="task-step" :class="`task-step--${s.state}`">
            <span
              class="task-step-dot"
              :class="{ 'task-step-dot--current': s.state === 'current' }"
            >{{ s.state === 'done' ? '✓' : '' }}</span>
            {{ s.label }}
          </span>
          <span v-if="i < steps.length - 1" class="task-step-sep" />
        </template>
      </div>

      <span class="progress-text task-pipeline-text" :title="pipelineText || completedFlash || ''">
        {{ pipelineText || completedFlash || '' }}
      </span>

      <div class="task-pipeline-track" :class="stageClass">
        <div class="progress-fill" :style="{ width: barWidth }" />
      </div>
      <span class="task-pct">{{ pctText }}</span>

      <span class="task-pipeline-actions">
        <button
          v-if="stage === 'thumb' && !thumbPaused"
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          {{ t('thumb.pause') }}
        </button>
        <button
          v-else-if="stage === 'thumb' && thumbPaused"
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          {{ t('thumb.resume') }}
        </button>
        <button
          v-if="failedCount > 0"
          type="button"
          class="progress-btn progress-btn--fail"
          @click="ui.thumbFailedOpen = true"
        >
          {{ t('thumb.failedCount', { n: failedCount }) }}
        </button>
        <button
          v-if="mode === 'auto'"
          type="button"
          class="progress-btn progress-btn--close"
          :title="t('thumb.statusHide')"
          @click="toggleBar"
        >
          ✕
        </button>
      </span>
    </div>

    <!-- 空闲详情：全空闲时点右上角「缩略图」chip 展开——显示缩略图总况 -->
    <div v-else-if="manualExpand" class="task-pipeline task-pipeline--idle">
      <span class="task-chip">{{ t('task.thumbLabel') }}</span>
      <span class="progress-text task-pipeline-text" :title="progressText">
        {{ progressText }}
      </span>
      <span v-if="pipelineSummary" class="task-pipeline-summary">{{ pipelineSummary }}</span>
    </div>
  </div>
</template>
