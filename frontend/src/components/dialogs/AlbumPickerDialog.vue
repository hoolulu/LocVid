<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { addVideosToAlbum, removeVideosFromAlbum } from '@/api/albums'
import { addVideoTags, removeVideoTag } from '@/api/tags'
import { t } from '@/i18n'
import { useAlbumStore } from '@/stores/album'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const album = useAlbumStore()
const gallery = useGalleryStore()
const player = usePlayerStore()

const loading = ref(false)
const creating = ref(false)
const newAlbumName = ref('')
const checked = reactive<Record<string, boolean>>({})
const initialChecked = reactive<Record<string, boolean>>({})

const hint = computed(() => {
  const n = ui.albumPickerIds.length
  return n === 1
    ? t('album.pickerHint')
    : t('album.pickerForVideos', { n })
})

/** 标签专辑（filter.tag 非空）——勾选它=给视频打对应标签，由标签动态聚合进专辑 */
function isTagAlbum(a: { filter?: { tag: string } }) {
  return !!(a.filter && a.filter.tag)
}

/** 判断视频是否已属于该专辑（标签专辑按 tags 判断，手动专辑按 albumIds 判断） */
function videoInAlbum(
  video: { albumIds?: string[]; tags?: string[] } | null | undefined,
  a: { id: string; filter?: { tag: string } },
) {
  if (!video) return false
  if (isTagAlbum(a)) return (video.tags || []).includes(a.filter!.tag)
  return (video.albumIds || []).includes(a.id)
}

function videoById(id: string) {
  return (
    gallery.videos.find((v) => v.id === id) ??
    player.playlist.find((v) => v.id === id) ??
    (player.playingId === id ? player.playingItem : undefined)
  )
}

function membership(albumId: string) {
  const ids = ui.albumPickerIds
  const target = album.albums.find((a) => a.id === albumId)
  const hits = ids.filter((id) => videoInAlbum(videoById(id), target || { id: albumId }))
  return {
    all: hits.length === ids.length,
    some: hits.length > 0 && hits.length < ids.length,
  }
}

function resetState() {
  for (const key of Object.keys(checked)) delete checked[key]
  for (const key of Object.keys(initialChecked)) delete initialChecked[key]
  newAlbumName.value = ''
}

/** 直接新建专辑并把当前选中的视频加入其中 */
async function createAlbum() {
  const name = newAlbumName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    const created = await album.addAlbum(name)
    const id = created?.id
    if (id) {
      // 新专辑默认勾选（加入当前视频）；initialChecked 留 false，让 confirm 视为"新增归属"，
      // 由 confirm 统一调 addVideosToAlbum 保证前后端一致（这里不改内存 albumIds）
      checked[id] = true
      ui.showToast(t('album.created', { name }))
    }
    newAlbumName.value = ''
  } catch (err) {
    ui.showToast(t('album.createFailed', { msg: err instanceof Error ? err.message : String(err) }))
  } finally {
    creating.value = false
  }
}

function initCheckboxes() {
  resetState()
  for (const a of album.albums) {
    const m = membership(a.id)
    checked[a.id] = m.all
    initialChecked[a.id] = m.all
  }
}

function patchVideoAlbumIds(videoId: string, albumId: string, add: boolean, tag?: string) {
  const apply = (video: { albumIds?: string[]; tags?: string[] } | null | undefined) => {
    if (!video) return
    if (tag) {
      // 标签专辑：更新标签集合，同时把对应标签专辑 id 同步进 albumIds（角标/按钮据此展示）
      const tags = new Set(video.tags || [])
      if (add) tags.add(tag)
      else tags.delete(tag)
      video.tags = [...tags]
      const target = album.albums.find((a) => a.filter?.tag === tag)
      if (target) {
        const ids = new Set(video.albumIds || [])
        if (add) ids.add(target.id)
        else ids.delete(target.id)
        video.albumIds = [...ids]
      }
      return
    }
    const ids = new Set(video.albumIds || [])
    if (add) ids.add(albumId)
    else ids.delete(albumId)
    video.albumIds = [...ids]
  }
  apply(gallery.videos.find((v) => v.id === videoId))
  apply(player.playlist.find((v) => v.id === videoId))
  if (player.playingId === videoId) apply(player.playingItem)
}

watch(
  () => ui.albumPickerOpen,
  async (open) => {
    if (!open) {
      resetState()
      return
    }
    loading.value = true
    try {
      await album.loadAlbums()
      initCheckboxes()
    } catch (err) {
      ui.showToast(t('album.loadFailed', { msg: err instanceof Error ? err.message : String(err) }))
      ui.closeAlbumPicker()
    } finally {
      loading.value = false
    }
  },
)

async function confirm() {
  const ids = ui.albumPickerIds
  if (!ids.length) return

  // 标签专辑：勾选=打标签，取消=移除标签（由标签动态聚合进专辑）
  const tagOps: { videoId: string; add: string[]; remove: string[] }[] = ids.map((id) => ({
    videoId: id,
    add: [],
    remove: [],
  }))
  // 手动专辑：维持原 add/remove 逻辑
  const ops: { albumId: string; add?: string[]; remove?: string[] }[] = []

  for (const a of album.albums) {
    const want = !!checked[a.id]
    const had = !!initialChecked[a.id]
    const tag = a.filter?.tag
    if (tag) {
      for (const id of ids) {
        const inAlbum = (videoById(id)?.tags || []).includes(tag)
        const op = tagOps.find((o) => o.videoId === id)!
        if (want && !inAlbum) op.add.push(tag)
        else if (!want && inAlbum) op.remove.push(tag)
      }
      continue
    }
    if (want && !had) {
      const missing = ids.filter((id) => !(videoById(id)?.albumIds || []).includes(a.id))
      if (missing.length) ops.push({ albumId: a.id, add: missing })
    } else if (!want && had) {
      const present = ids.filter((id) => (videoById(id)?.albumIds || []).includes(a.id))
      if (present.length) ops.push({ albumId: a.id, remove: present })
    }
  }

  const hasTagOps = tagOps.some((o) => o.add.length || o.remove.length)
  if (!hasTagOps && !ops.length) {
    ui.showToast(t('album.unchanged'))
    ui.closeAlbumPicker()
    return
  }

  try {
    for (const op of tagOps) {
      if (op.add.length) {
        await addVideoTags(op.videoId, op.add)
        op.add.forEach((tag) => patchVideoAlbumIds(op.videoId, '', true, tag))
      }
      if (op.remove.length) {
        for (const tag of op.remove) {
          await removeVideoTag(op.videoId, tag)
          patchVideoAlbumIds(op.videoId, '', false, tag)
        }
      }
    }
    for (const op of ops) {
      if (op.add?.length) {
        await addVideosToAlbum(op.albumId, op.add)
        op.add.forEach((id) => patchVideoAlbumIds(id, op.albumId, true))
      }
      if (op.remove?.length) {
        await removeVideosFromAlbum(op.albumId, op.remove)
        op.remove.forEach((id) => patchVideoAlbumIds(id, op.albumId, false))
      }
    }
    ui.showToast(t('album.updated'))
    ui.closeAlbumPicker()
  } catch (err) {
    ui.showToast(t('album.updateFailed', { msg: err instanceof Error ? err.message : String(err) }))
  }
}

function close() {
  ui.closeAlbumPicker()
}
</script>

<template>
  <dialog
    v-if="ui.albumPickerOpen"
    open
    class="album-picker-dialog fixed inset-0 z-[250] m-auto w-full max-w-md rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] p-0 text-[var(--lg-text-primary)] shadow-2xl backdrop:bg-black/60"
  >
    <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-4 py-3">
      <h2 class="text-lg font-medium">{{ t('album.add') }}</h2>
      <button type="button" class="rounded px-2 py-1 lg-hover" @click="close">✕</button>
    </div>
    <p class="px-4 pt-3 text-sm text-[var(--lg-text-muted)]">{{ hint }}</p>
    <div class="flex gap-2 border-b border-[var(--lg-border)] px-4 py-2">
      <input
        v-model="newAlbumName"
        type="text"
        placeholder="{{ t('album.newNamePlaceholder') }}"
        class="min-w-0 flex-1 rounded border border-[var(--lg-border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--lg-accent)]"
        :disabled="creating"
        @keydown.enter="createAlbum"
      />
      <button
        type="button"
        class="shrink-0 rounded border border-[var(--lg-accent)] px-3 py-1 text-sm text-[var(--lg-accent)] disabled:opacity-40"
        :disabled="!newAlbumName.trim() || creating"
        @click="createAlbum"
      >
        {{ t('album.createShort') }}
      </button>
    </div>
    <div class="max-h-64 overflow-y-auto p-3">
      <div v-if="loading" class="py-8 text-center text-sm text-[var(--lg-text-muted)]">{{ t('common.loading') }}</div>
      <p v-else-if="!album.albums.length" class="py-6 text-center text-sm text-[var(--lg-text-muted)]">
        {{ t('album.empty') }}
      </p>
      <label
        v-for="a in album.albums"
        v-else
        :key="a.id"
        class="album-picker-item"
      >
        <input v-model="checked[a.id]" type="checkbox" :value="a.id" />
        <span class="album-picker-name">{{ a.name }}</span>
        <span
          v-if="isTagAlbum(a)"
          class="shrink-0 rounded border border-[var(--lg-accent)]/40 bg-[var(--lg-accent)]/10 px-1.5 py-0.5 text-[0.65rem] text-[var(--lg-accent)]"
        >
          {{ t('album.tagAlbum') }}
        </span>
        <span class="album-picker-count">{{ t('album.videoCount', { n: a.video_count || 0 }) }}</span>
      </label>
    </div>
    <div class="flex justify-end gap-2 border-t border-[var(--lg-border)] px-4 py-3">
      <button type="button" class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm" @click="close">
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)] disabled:opacity-40"
        :disabled="loading"
        @click="confirm"
      >
        {{ t('common.confirm') }}
      </button>
    </div>
  </dialog>
</template>
