<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getVideoTags, setVideoTags, getTags } from '@/api/tags'
import { t } from '@/i18n'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { TagInfo } from '@/types'

const ui = useUiStore()
const gallery = useGalleryStore()
const player = usePlayerStore()

const loading = ref(false)
const saving = ref(false)
const newTag = ref('')
const currentTags = ref<string[]>([])
const allTags = ref<TagInfo[]>([])

const videoId = computed(() => ui.tagEditorId)

const currentVideo = computed(() => {
  const id = videoId.value
  if (!id) return undefined
  return (
    gallery.videos.find((v) => v.id === id) ??
    player.playlist.find((v) => v.id === id) ??
    (player.playingId === id ? player.playingItem : undefined)
  )
})

/** 常用标签建议：全库标签去掉已选的，取数量前 12 个 */
const suggestions = computed(() =>
  allTags.value
    .filter((x) => !currentTags.value.includes(x.tag))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((x) => x.tag),
)

async function load() {
  const id = videoId.value
  if (!id) return
  loading.value = true
  try {
    const [tagsRes, allRes] = await Promise.all([getVideoTags(id), getTags()])
    currentTags.value = tagsRes.tags || []
    allTags.value = allRes.items || []
  } finally {
    loading.value = false
  }
}

watch(videoId, (id) => {
  if (id) void load()
})

function addTag(tag: string) {
  const clean = tag.trim().replace(/^#/, '')
  if (!clean || currentTags.value.includes(clean)) return
  currentTags.value.push(clean)
  newTag.value = ''
}

function removeTag(tag: string) {
  currentTags.value = currentTags.value.filter((x) => x !== tag)
}

async function save() {
  const id = videoId.value
  if (!id || saving.value) return
  saving.value = true
  try {
    const res = await setVideoTags(id, currentTags.value)
    currentTags.value = res.tags || []
    // 同步本地列表项，避免刷新前标签不更新
    const item = currentVideo.value
    if (item) item.tags = res.tags || []
    ui.showToast(t('tag.saved'))
    ui.closeTagEditor()
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    ui.showToast(t('tag.saveFailed', { msg }), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    v-if="ui.tagEditorOpen"
    class="lg-modal-overlay"
    @click.self="ui.closeTagEditor()"
  >
    <div class="lg-modal max-w-md">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-base font-bold">{{ t('tag.editTitle') }}</h3>
        <button type="button" class="lg-modal-close" @click="ui.closeTagEditor()">✕</button>
      </div>

      <p class="mb-3 truncate text-sm text-[var(--lg-text-muted)]">
        {{ currentVideo?.title || currentVideo?.filename }}
      </p>

      <div v-if="loading" class="py-6 text-center text-sm text-[var(--lg-text-muted)]">
        {{ t('common.loading') }}
      </div>

      <template v-else>
        <!-- 当前标签 -->
        <div class="mb-3">
          <p class="mb-1.5 text-xs text-[var(--lg-text-muted)]">{{ t('tag.currentTags') }}</p>
          <div v-if="currentTags.length" class="flex flex-wrap gap-1.5">
            <span
              v-for="tag in currentTags"
              :key="tag"
              class="inline-flex items-center gap-1 rounded bg-sky-500/10 px-2 py-0.5 text-[13px] text-sky-400"
            >
              #{{ tag }}
              <button
                type="button"
                class="text-sky-400/60 hover:text-sky-200"
                :title="t('tag.remove')"
                @click="removeTag(tag)"
              >✕</button>
            </span>
          </div>
          <p v-else class="text-xs text-[var(--lg-text-muted)]">{{ t('tag.noTags') }}</p>
        </div>

        <!-- 输入新标签 -->
        <div class="mb-3 flex gap-2">
          <input
            v-model="newTag"
            class="lg-input flex-1"
            :placeholder="t('tag.addPlaceholder')"
            @keydown.enter.prevent="addTag(newTag)"
          />
          <button
            type="button"
            class="lg-btn"
            :disabled="!newTag.trim()"
            @click="addTag(newTag)"
          >{{ t('tag.add') }}</button>
        </div>

        <!-- 常用标签建议 -->
        <div v-if="suggestions.length" class="mb-4">
          <p class="mb-1.5 text-xs text-[var(--lg-text-muted)]">{{ t('tag.suggestions') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="tag in suggestions"
              :key="tag"
              type="button"
              class="rounded border border-[var(--lg-border)] px-2 py-0.5 text-[12px] text-[var(--lg-text-muted)] hover:border-sky-500/50 hover:text-sky-400"
              @click="addTag(tag)"
            >+ {{ tag }}</button>
          </div>
        </div>
      </template>

      <div class="flex justify-end gap-2">
        <button type="button" class="lg-btn lg-btn-ghost" @click="ui.closeTagEditor()">
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="lg-btn lg-btn-primary"
          :disabled="saving"
          @click="save"
        >{{ saving ? t('common.saving') : t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>
