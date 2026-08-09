<script setup lang="ts">

import { computed } from 'vue'

import { batchFavorites, deleteVideos } from '@/api/files'

import { batchRegenerateThumb } from '@/api/thumbs'
import { openThumbPicker } from '@/composables/useThumbPicker'
import { t } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'

import { useGalleryStore } from '@/stores/gallery'

import { useUiStore } from '@/stores/ui'



const ui = useUiStore()

const gallery = useGalleryStore()
const settingsStore = useSettingsStore()



const visible = computed(() => ui.selectedCount > 0)

const ids = computed(() => [...ui.selectedIds])



async function onSelectAll() {

  ui.selectAll(gallery.videos.map((v) => v.id))

}



async function onDelete() {

  const ok = await ui.showConfirm(t('batch.deleteConfirm'), t('batch.deleteN', { n: ids.value.length }))
  if (!ok) return

  await deleteVideos(ids.value)

  ui.clearSelection(true)

  await gallery.loadVideos()

  ui.showToast(t('batch.deleted'))

}



async function onFavorite(add: boolean) {

  await batchFavorites(ids.value, add ? 'add' : 'remove')

  ui.clearSelection(true)

  await gallery.loadVideos()

}



function onAddToAlbum() {

  ui.openAlbumPicker(ids.value)

  ui.clearSelection(true)

}



function onBatchMove() {
  ui.openFolderMove({ mode: 'videos', videoIds: ids.value, category: gallery.category || undefined })
  ui.clearSelection(true)
}

async function onBatchRegenThumb() {
  await settingsStore.loadSettings()
  const batchAuto = settingsStore.settings?.thumb_batch_auto_select !== false
  const videoIds = ids.value

  if (!batchAuto) {
    ui.clearSelection(true)
    for (let i = 0; i < videoIds.length; i++) {
      const id = videoIds[i]
      const item = gallery.videos.find((v) => v.id === id)
      const title = item?.title || item?.filename || id
      await openThumbPicker(id, `${i + 1}/${videoIds.length} · ${title}`)
    }
    await gallery.loadVideos()
    ui.showToast(t('batch.regenDone'))
    return
  }

  await batchRegenerateThumb(videoIds, true)
  ui.clearSelection(true)
  await gallery.loadVideos()
  ui.showToast(t('thumb.queued'))
}

</script>



<template>

  <div

    v-if="visible"

    class="batch-action-bar shrink-0 flex flex-wrap items-center justify-center gap-2 border-t border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] px-4 py-3 shadow-lg"

  >

    <span class="text-sm">{{ t('batch.selected', { n: ui.selectedCount }) }}</span>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onSelectAll">{{ t('batch.selectAll') }}</button>
    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="ui.clearSelection()">{{ t('batch.deselectAll') }}</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onFavorite(true)">{{ t('batch.favorite') }}</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onFavorite(false)">{{ t('batch.unfavorite') }}</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onAddToAlbum">{{ t('batch.addAlbum') }}</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onBatchMove">{{ t('batch.move') }}</button>
    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onBatchRegenThumb">{{ t('batch.regenThumb') }}</button>

    <button class="rounded border border-red-500/50 px-3 py-1 text-sm text-red-400" @click="onDelete">{{ t('batch.delete') }}</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="ui.clearSelection(true)">{{ t('common.cancel') }}</button>

  </div>

</template>

