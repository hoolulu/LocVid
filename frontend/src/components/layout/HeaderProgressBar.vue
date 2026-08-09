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
  durationBusy,
  thumbIdle,
  stage,
  stageLabel,
  pipelineText,
  stagePercent,
  pipelineSummary,
  progressText,
  togglePause,
} = useThumbProgress()

// 全部处理完成闪示（5s 内显示；超时后 composable 清空 lastCompleted）
const completedFlash = computed(() => {
  if (!lastCompleted.value) return null
  if (Date.now() - lastCompleted.value.at > 5000) return null
  return t('task.allDone')
})

// 阶段徽标颜色（repair=琥珀 / thumb=主色 / duration=蓝）
const chipClass = computed(() => {
  if (stage.value === 'repair') return 'task-chip--remux'
  if (stage.value === 'duration') return 'task-chip--duration'
  return ''
})

// 进度条宽度
const barWidth = computed(() => `${Math.max(0, Math.min(100, stagePercent.value))}%`)
</script>

<template>
  <div
    class="progress-bar-wrap"
    :class="{ 'progress-bar-collapsed': !showBar }"
  >
    <!-- 入库提示：新影片检测到，开始处理（5s 闪示） -->
    <div v-if="incomingFlash" class="task-done-banner task-incoming-banner">
      <span class="task-incoming-icon">📥</span>
      <span>{{ t('task.incoming') }}</span>
    </div>

    <!-- 完成闪示：全部后台任务处理完成（5s） -->
    <div v-if="completedFlash" class="task-done-banner">
      <span class="task-done-icon">✓</span>
      <span>{{ completedFlash }}</span>
    </div>

    <!-- 单任务条：徽标 + 阶段文本 + 进度条 + 总况汇总（单行，尽量不遮内容） -->
    <div v-if="stage !== 'idle'" class="task-pipeline">
      <span class="task-chip" :class="chipClass">{{ stageLabel }}</span>
      <span class="progress-text task-pipeline-text" :title="pipelineText">
        {{ pipelineText }}
      </span>
      <div class="task-pipeline-track">
        <div class="progress-fill" :style="{ width: barWidth }" />
      </div>
      <span v-if="pipelineSummary" class="task-pipeline-summary">{{ pipelineSummary }}</span>
      <span v-if="durationBusy || !thumbIdle" class="task-pipeline-actions">
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
      </span>
    </div>

    <!-- 空闲详情：全空闲时点右上角「缩略图」chip 展开——显示缩略图总况，
         避免进度条区域空白（此前 stage==='idle' 时内部什么都不渲染） -->
    <div v-else-if="manualExpand" class="task-pipeline">
      <span class="task-chip">{{ t('task.thumbLabel') }}</span>
      <span class="progress-text task-pipeline-text" :title="progressText">
        {{ progressText }}
      </span>
      <span v-if="pipelineSummary" class="task-pipeline-summary">{{ pipelineSummary }}</span>
    </div>
  </div>
</template>
