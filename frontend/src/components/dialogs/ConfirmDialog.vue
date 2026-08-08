<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

function onOk() {
  ui.resolveConfirm(true)
}

function onCancel() {
  ui.resolveConfirm(false)
}
</script>

<template>
  <div
    v-if="ui.confirmDialog"
    class="lg-modal-overlay"
    @click.self="onCancel"
  >
    <div class="lg-confirm-dialog" role="alertdialog" aria-modal="true">
      <h3 class="text-sm font-semibold">{{ ui.confirmDialog.title }}</h3>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--lg-text-secondary)]">
        {{ ui.confirmDialog.message }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover"
          @click="onCancel"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded bg-[var(--lg-accent)] px-3 py-1.5 text-sm text-[var(--lg-text-on-accent)]"
          @click="onOk"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>
