<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useGalleryStore } from '@/stores/gallery'
import { useAlbumStore } from '@/stores/album'
import { useLibraryStore } from '@/stores/library'
import {
  clearHistory,
  createLibrary,
  deleteLibrary,
  pickFolder,
  updateLibrary,
} from '@/api/files'
import { exportData, importData } from '@/api'
import { cleanupOrphans, getThumbStats } from '@/api/thumbs'
import { getGallerySortOptions } from '@/constants/sort'
import { t, useI18n, type Locale } from '@/i18n'
import type { Settings } from '@/types'

const ui = useUiStore()
const settings = useSettingsStore()
const library = useLibraryStore()
const gallery = useGalleryStore()
const album = useAlbumStore()
const { locale } = useI18n()

function onLocaleChange(e: Event) {
  const { setLocale } = useI18n()
  setLocale((e.target as HTMLSelectElement).value as Locale)
}

type SettingsTab = 'library' | 'playback' | 'thumbnail' | 'tag' | 'other'
const TAB_KEY = 'loc-gallery-settings-tab'

const tab = ref<SettingsTab>((localStorage.getItem(TAB_KEY) as SettingsTab) || 'library')
const settingsScope = ref<'global' | 'library'>('global')
const form = reactive<Partial<Settings>>({})
const newLib = reactive({ alias: '', path: '', library_type: 'title-based' as 'id-based' | 'title-based' })
const pageSizeMode = ref<'40' | '80' | 'custom'>('40')
const customPageSize = ref('40')

// 缩略图维护（占用统计 / 清理孤立 / 重生成失败）
const thumbStats = ref<{ files: number; bytes: number } | null>(null)

async function loadThumbStats() {
  try {
    thumbStats.value = await getThumbStats()
  } catch {
    thumbStats.value = null
  }
}

function formatThumbBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function onCleanupThumbs() {
  const ok = await ui.showConfirm(t('settings.cleanupThumbsMsg'), t('settings.cleanupBtn'))
  if (!ok) return
  const res = await cleanupOrphans()
  ui.showToast(t('thumb.cleaned', { n: res.removed }))
  await loadThumbStats()
}

const presets = computed(() => [
  { value: 'cinema', label: t('settings.preset.cinema') },
  { value: 'classic', label: t('settings.preset.classic') },
])

// 悬停预览：开关 + 模式 合并为单一下拉（off | video | thumb），避免语义重复
const hoverPreviewOption = computed<'off' | 'video' | 'thumb'>({
  get: () => (form.html5_hover_preview ? (form.html5_hover_preview_mode === 'thumb' ? 'thumb' : 'video') : 'off'),
  set: (v) => {
    if (v === 'off') {
      form.html5_hover_preview = false
    } else {
      form.html5_hover_preview = true
      form.html5_hover_preview_mode = v
    }
  },
})

const tabs = computed<{ id: SettingsTab; label: string }[]>(() => [
  { id: 'library', label: t('settings.tab.library') },
  { id: 'playback', label: t('settings.tab.playback') },
  { id: 'thumbnail', label: t('settings.tab.thumbnail') },
  { id: 'tag', label: t('settings.tab.tag') },
  { id: 'other', label: t('settings.tab.other') },
])

watch(tab, (v) => localStorage.setItem(TAB_KEY, v))

onMounted(async () => {
  await library.loadLibraries()
  await settings.loadSettings()
  Object.assign(form, settings.settings || {})
  syncPageSizeFromForm()
})

watch(
  () => form.ui_theme,
  (v) => {
    if (v === 'light' || v === 'dark') settings.previewTheme(v)
  },
)

watch(
  () => form.ui_preset,
  (v) => {
    if (v === 'cinema' || v === 'classic') settings.previewPreset(v)
  },
)

function syncPageSizeFromForm() {
  const n = form.default_page_size
  if (n === 40) pageSizeMode.value = '40'
  else if (n === 80) pageSizeMode.value = '80'
  else {
    pageSizeMode.value = 'custom'
    customPageSize.value = String(n ?? 40)
  }
}

function applyPageSizeToForm() {
  if (pageSizeMode.value === '40') form.default_page_size = 40
  else if (pageSizeMode.value === '80') form.default_page_size = 80
  else form.default_page_size = parseInt(customPageSize.value, 10) || 40
}

async function save() {
  applyPageSizeToForm()
  try {
    await settings.updateSettings({ ...form }, settingsScope.value)
    ui.showToast(t('settings.saved'))
    close()
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    ui.showToast(t('settings.saveFailed', { msg }), 'error')
  }
}

async function pickPath() {
  const res = await pickFolder()
  if (res.path) newLib.path = res.path
}

async function pickLibPath(lib: { path: string }) {
  const res = await pickFolder()
  if (res.path) lib.path = res.path
}

async function addLibrary() {
  if (!newLib.alias || !newLib.path) {
    ui.showToast(t('settings.library.addRequired'))
    return
  }
  try {
    await createLibrary(newLib.alias, newLib.path, newLib.library_type)
    newLib.alias = ''
    newLib.path = ''
    newLib.library_type = 'title-based'
    await library.loadLibraries()
    ui.showToast(t('settings.library.added'))
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    ui.showToast(t('settings.library.addFailed', { msg }), 'error')
  }
}

async function saveLibraryRow(lib: { id: string; alias: string; path: string; library_type?: string }) {
  try {
    await updateLibrary(lib.id, {
      alias: lib.alias,
      path: lib.path,
      library_type: lib.library_type || 'title-based',
    })
    await library.loadLibraries()
    ui.showToast(t('settings.saved'))
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    ui.showToast(t('settings.saveFailed', { msg }), 'error')
  }
}

async function onRemoveLibrary(id: string, alias: string) {
  const ok = await ui.showConfirm(t('settings.library.deleteConfirm', { alias }), t('settings.deleteLibrary'))
  if (!ok) return
  try {
    await deleteLibrary(id)
    await library.loadLibraries()
    gallery.clearFolderCaches()
    gallery.category = null
    gallery.folder = null
    gallery.page = 1
    await gallery.loadCategories()
    await gallery.loadVideos()
    await album.loadAlbums()
    ui.showToast(t('settings.library.deleted'))
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    ui.showToast(t('settings.library.deleteFailed', { msg }), 'error')
  }
}

async function onClearHistory() {
  const ok = await ui.showConfirm(t('settings.clearHistoryConfirm'))
  if (!ok) return
  await clearHistory()
  ui.showToast(t('history.cleared'))
}

// ── 数据备份（导出/导入）──
const importFileInput = ref<HTMLInputElement | null>(null)

function onPickImportFile() {
  importFileInput.value?.click()
}

async function onExportData() {
  try {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loc-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ui.showToast(t('settings.exported'))
  } catch {
    ui.showToast(t('settings.exportFailed'))
  }
}

async function onImportFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (typeof data !== 'object' || data === null) throw new Error('bad payload')
    const ok = await ui.showConfirm(t('settings.importMsg'), t('settings.importTitle'))
    if (!ok) return
    const res = await importData(data as Record<string, unknown>)
    ui.showToast(t('settings.importDone', { names: res.imported.join('、') }))
    // 刷新受影响的本地状态
    await Promise.all([
      library.loadLibraries(),
      settings.loadSettings(),
      gallery.loadCategories(),
      gallery.loadVideos(),
      album.loadAlbums(),
    ])
  } catch {
    ui.showToast(t('settings.importInvalid'))
  }
}

function close() {
  settings.revertPreview()
  ui.settingsOpen = false
  document.documentElement.classList.remove('lg-modal-open')
}

watch(
  () => ui.settingsOpen,
  (open) => {
    document.documentElement.classList.toggle('lg-modal-open', open)
    if (open) {
      void settings.loadSettings().then(() => {
        Object.assign(form, settings.settings || {})
        syncPageSizeFromForm()
      })
      if (tab.value === 'thumbnail') void loadThumbStats()
    }
  },
)

watch(tab, (t) => {
  localStorage.setItem(TAB_KEY, t)
  if (t === 'thumbnail') void loadThumbStats()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.settingsOpen" class="lg-modal-overlay" @click.self="close">
      <div class="settings-dialog" role="dialog" aria-modal="true" @click.stop>
        <header class="settings-topbar">
          <h2>{{ t('settings.title') }}</h2>
          <span class="settings-topbar-hint">
            {{ settingsScope === 'global' ? t('settings.scopeGlobal') : t('settings.scopeLibrary') }}
          </span>
        </header>

        <div class="settings-shell">
          <nav class="settings-sidebar" :aria-label="t('settings.navAria')">
            <button
              v-for="t in tabs"
              :key="t.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: tab === t.id }"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </nav>

          <div class="settings-body">
            <!-- 视频库 -->
            <template v-if="tab === 'library'">
              <section class="settings-block space-y-4">
                <h3 class="settings-block-title">{{ t('settings.libraryManage') }}</h3>

                <!-- 类型说明（并排双卡） -->
                <div class="grid gap-3 md:grid-cols-2">
                  <div class="flex items-start gap-2.5 rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-card)] p-3">
                    <span class="shrink-0 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-hover)] px-2 py-0.5 text-xs font-semibold text-[var(--lg-text-primary)]">{{ t('settings.library.typeTitle') }}</span>
                    <p class="text-xs leading-relaxed text-[var(--lg-text-secondary)]">{{ t('settings.library.typeHintTitle') }}</p>
                  </div>
                  <div class="flex items-start gap-2.5 rounded-lg border border-[var(--lg-accent)]/40 bg-[var(--lg-accent)]/[0.07] p-3">
                    <span class="shrink-0 rounded-md border border-[var(--lg-accent)]/50 bg-[var(--lg-accent)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--lg-accent)]">{{ t('settings.library.typeId') }}</span>
                    <p class="text-xs leading-relaxed text-[var(--lg-text-secondary)]">{{ t('settings.library.typeHintId') }}</p>
                  </div>
                </div>

                <p class="settings-subtitle">{{ t('settings.existingLibraries') }}</p>
                <div v-if="library.libraries.length" class="overflow-hidden rounded-lg border border-[var(--lg-border)]">
                  <div class="grid grid-cols-[9rem_13rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-3.5 py-2 text-[0.6875rem] uppercase tracking-wider text-[var(--lg-text-muted)]">
                    <span>{{ t('settings.library.alias') }}</span>
                    <span>{{ t('settings.library.type') }}</span>
                    <span>{{ t('settings.library.path') }}</span>
                    <span class="text-right">{{ t('settings.actions') }}</span>
                  </div>
                  <div class="divide-y divide-[var(--lg-border)]">
                    <div v-for="lib in library.libraries" :key="lib.id" class="grid grid-cols-[9rem_13rem_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--lg-bg-hover)]">
                      <input v-model="lib.alias" class="min-w-0 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1.5 text-sm font-semibold text-[var(--lg-text-primary)] outline-none transition-colors focus:border-[var(--lg-accent)]" :placeholder="t('settings.library.alias')" />
                      <div class="inline-flex w-fit overflow-hidden rounded-md border border-[var(--lg-border)]">
                        <label class="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors" :class="lib.library_type === 'title-based' ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]' : 'text-[var(--lg-text-muted)] hover:bg-[var(--lg-bg-hover)]'">
                          <input type="radio" :value="'title-based'" v-model="lib.library_type" :name="'lib-type-' + lib.id" class="sr-only" />
                          <span>{{ t('settings.library.typeTitle') }}</span>
                        </label>
                        <label class="flex cursor-pointer items-center gap-1.5 border-l border-[var(--lg-border)] px-2.5 py-1.5 text-xs transition-colors" :class="lib.library_type === 'id-based' ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]' : 'text-[var(--lg-text-muted)] hover:bg-[var(--lg-bg-hover)]'">
                          <input type="radio" :value="'id-based'" v-model="lib.library_type" :name="'lib-type-' + lib.id" class="sr-only" />
                          <span>{{ t('settings.library.typeId') }}</span>
                        </label>
                      </div>
                      <div class="flex min-w-0 items-center gap-2">
                        <input v-model="lib.path" :title="lib.path" class="min-w-0 flex-1 truncate rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1.5 font-mono text-xs text-[var(--lg-text-primary)] outline-none transition-colors focus:border-[var(--lg-accent)]" />
                        <button type="button" class="shrink-0 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-hover)] px-2.5 py-1.5 text-xs text-[var(--lg-text-secondary)] transition-colors hover:bg-[var(--lg-bg-active)]" @click="pickLibPath(lib)">{{ t('settings.library.browse') }}</button>
                      </div>
                      <div class="flex justify-end gap-2">
                        <button type="button" class="rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-hover)] px-2.5 py-1.5 text-xs text-[var(--lg-text-primary)] transition-colors hover:bg-[var(--lg-bg-active)]" @click="saveLibraryRow(lib)">{{ t('common.save') }}</button>
                        <button type="button" class="rounded-md border border-[var(--lg-danger-border)] bg-[var(--lg-danger-bg)] px-2.5 py-1.5 text-xs text-[var(--lg-danger)] transition-colors hover:opacity-80" @click="onRemoveLibrary(lib.id, lib.alias)">{{ t('common.delete') }}</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-lg border border-dashed border-[var(--lg-border)] p-6 text-center text-sm text-[var(--lg-text-muted)]">{{ t('settings.emptyLibraries') }}</div>

                <p class="settings-subtitle" style="margin-top: 1rem">{{ t('settings.addLibraryTitle') }}</p>
                <div class="rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-card)] p-3.5">
                  <div class="grid grid-cols-[9rem_13rem_minmax(0,1fr)_auto] items-center gap-3">
                    <input v-model="newLib.alias" :placeholder="t('settings.library.alias')" autocomplete="off" class="min-w-0 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1.5 text-sm font-semibold text-[var(--lg-text-primary)] outline-none transition-colors focus:border-[var(--lg-accent)]" />
                    <div class="inline-flex w-fit overflow-hidden rounded-md border border-[var(--lg-border)]">
                      <label class="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors" :class="newLib.library_type === 'title-based' ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]' : 'text-[var(--lg-text-muted)] hover:bg-[var(--lg-bg-hover)]'">
                        <input type="radio" value="title-based" v-model="newLib.library_type" name="new-lib-type" class="sr-only" />
                        <span>{{ t('settings.library.typeTitle') }}</span>
                      </label>
                      <label class="flex cursor-pointer items-center gap-1.5 border-l border-[var(--lg-border)] px-2.5 py-1.5 text-xs transition-colors" :class="newLib.library_type === 'id-based' ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]' : 'text-[var(--lg-text-muted)] hover:bg-[var(--lg-bg-hover)]'">
                        <input type="radio" value="id-based" v-model="newLib.library_type" name="new-lib-type" class="sr-only" />
                        <span>{{ t('settings.library.typeId') }}</span>
                      </label>
                    </div>
                    <div class="flex min-w-0 items-center gap-2">
                      <input v-model="newLib.path" :placeholder="t('settings.library.path')" autocomplete="off" class="min-w-0 flex-1 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1.5 font-mono text-xs text-[var(--lg-text-primary)] outline-none transition-colors focus:border-[var(--lg-accent)]" />
                      <button type="button" class="shrink-0 rounded-md border border-[var(--lg-border)] bg-[var(--lg-bg-hover)] px-2.5 py-1.5 text-xs text-[var(--lg-text-secondary)] transition-colors hover:bg-[var(--lg-bg-active)]" @click="pickPath">{{ t('settings.library.browse') }}</button>
                    </div>
                    <div class="flex justify-end">
                      <button type="button" class="rounded-md bg-[var(--lg-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--lg-text-on-accent)] transition-colors hover:brightness-110" @click="addLibrary">{{ t('settings.library.add') }}</button>
                    </div>
                  </div>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.appearance') }}</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.theme') }}</span>
                    <select v-model="form.ui_theme" class="settings-input">
                      <option value="dark">{{ t('settings.theme.dark') }}</option>
                      <option value="light">{{ t('settings.theme.light') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.preset') }}</span>
                    <select v-model="form.ui_preset" class="settings-input">
                      <option v-for="p in presets" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                  </label>
                </div>
              </section>
            </template>

            <!-- 播放 -->
            <template v-else-if="tab === 'playback'">
              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.tab.playback') }}</h3>
                <div class="settings-grid">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.resume') }}</span>
                    <select v-model="form.html5_resume_playback" class="settings-input">
                      <option :value="true">{{ t('settings.on') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.autoplay') }}</span>
                    <select v-model="form.html5_playlist_autoplay" class="settings-input">
                      <option :value="true">{{ t('settings.on') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.autoRemux') }}</span>
                    <select v-model="form.html5_auto_remux" class="settings-input">
                      <option :value="true">{{ t('settings.autoRemuxOn') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.seekPreview') }}</span>
                    <select v-model="form.html5_seek_preview" class="settings-input">
                      <option :value="true">{{ t('settings.seekPreviewOn') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.externalPlayerPath') }}</span>
                    <input
                      v-model="form.external_player_path"
                      class="settings-input"
                      :placeholder="t('settings.externalPlayerPlaceholder')"
                    />
                  </label>
                  <div class="settings-field settings-field--full">
                    <p class="settings-field-hint">
                      {{ t('settings.externalPlayerHint') }}
                    </p>
                  </div>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.hotkeys') }}</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.prevKey') }}</span>
                    <input v-model="form.html5_player_prev_key" class="settings-input" maxlength="12" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.nextKey') }}</span>
                    <input v-model="form.html5_player_next_key" class="settings-input" maxlength="12" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.wheelSeek') }}</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_wheel_seek_sec"
                        type="number"
                        min="0"
                        max="120"
                        class="settings-input"
                      />
                      <span class="settings-unit">{{ t('settings.sec') }}</span>
                    </div>
                  </label>
                </div>
              </section>
            </template>

            <!-- 缩略图 -->
            <template v-else-if="tab === 'thumbnail'">
              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.thumbGen') }}</h3>
                <div class="settings-grid">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.thumbPos') }}</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.thumb_position"
                        type="number"
                        step="0.05"
                        min="0.05"
                        max="0.95"
                        class="settings-input"
                      />
                      <span class="settings-unit">{{ t('settings.ratio') }}</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.idleScan') }}</span>
                    <select v-model="form.thumb_idle_scan" class="settings-input">
                      <option :value="true">{{ t('settings.on') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.progressBar') }}</span>
                    <select v-model="form.thumb_progress_bar" class="settings-input">
                      <option value="auto">{{ t('settings.progressAuto') }}</option>
                      <option value="always">{{ t('settings.progressAlways') }}</option>
                      <option value="never">{{ t('settings.progressNever') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.workers') }}</span>
                    <input v-model.number="form.thumb_workers" type="number" min="1" max="8" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.candidateCount') }}</span>
                    <input
                      v-model.number="form.thumb_candidate_count"
                      type="number"
                      min="3"
                      max="12"
                      class="settings-input"
                    />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.autoBestSingle') }}</span>
                    <select v-model="form.thumb_auto_select_best" class="settings-input">
                      <option :value="true">{{ t('settings.on') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.autoBestBatch') }}</span>
                    <select v-model="form.thumb_batch_auto_select" class="settings-input">
                      <option :value="true">{{ t('settings.on') }}</option>
                      <option :value="false">{{ t('settings.off') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.jitterPct') }}</span>
                    <input v-model.number="form.thumb_jitter_pct" type="number" min="5" max="15" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.jitterMin') }}</span>
                    <input v-model.number="form.thumb_jitter_min" type="number" min="3" max="12" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.jitterMax') }}</span>
                    <input v-model.number="form.thumb_jitter_max" type="number" min="88" max="97" class="settings-input" />
                  </label>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.hoverPreviewSection') }}</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.hoverPreviewMode') }}</span>
                    <select v-model="hoverPreviewOption" class="settings-input">
                      <option value="off">{{ t('settings.hoverPreviewOff') }}</option>
                      <option value="video">{{ t('settings.hoverPreviewModeVideo') }}</option>
                      <option value="thumb">{{ t('settings.hoverPreviewModeThumb') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.pinMode') }}</span>
                    <select v-model="form.html5_hover_tip_pin" class="settings-input">
                      <option :value="true">{{ t('settings.pinOn') }}</option>
                      <option :value="false">{{ t('settings.pinOff') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.segments') }}</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_hover_preview_segments"
                        type="number"
                        min="1"
                        max="10"
                        class="settings-input"
                      />
                      <span class="settings-unit">{{ t('settings.unit') }}</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.segmentSec') }}</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_hover_preview_segment_sec"
                        type="number"
                        min="1"
                        max="15"
                        class="settings-input"
                      />
                      <span class="settings-unit">{{ t('settings.sec') }}</span>
                    </div>
                  </label>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.maintenance') }}</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <span class="settings-field-hint">
                    {{ t('settings.cacheUsage', { text: thumbStats ? `${formatThumbBytes(thumbStats.bytes)}（${thumbStats.files} ${t('thumb.files')}）` : '…' }) }}
                  </span>
                  <button type="button" class="settings-btn" @click="onCleanupThumbs">{{ t('settings.cleanupBtn') }}</button>
                </div>
              </section>
            </template>

            <!-- 标签 -->
            <template v-else-if="tab === 'tag'">
              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.tagGen') }}</h3>
                <div class="settings-grid">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.tagAlbumMin') }}</span>
                    <input
                      v-model.number="form.tag_album_min_videos"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      class="settings-input"
                    />
                  </label>
                </div>
                <p class="settings-hint">{{ t('settings.tagAlbumMinHint') }}</p>
              </section>
            </template>

            <!-- 其他 -->
            <template v-else>
              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.general') }}</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.lang') }}</span>
                    <select :value="locale" class="settings-input" @change="onLocaleChange">
                      <option value="zh">{{ t('settings.lang.zh') }}</option>
                      <option value="en">{{ t('settings.lang.en') }}</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.defaultPageSize') }}</span>
                    <div class="flex gap-2">
                      <select v-model="pageSizeMode" class="settings-input">
                        <option value="40">{{ t('settings.page40') }}</option>
                        <option value="80">{{ t('settings.page80') }}</option>
                        <option value="custom">{{ t('settings.custom') }}</option>
                      </select>
                      <input
                        v-if="pageSizeMode === 'custom'"
                        v-model="customPageSize"
                        type="number"
                        min="1"
                        max="999"
                        class="settings-input"
                        style="width: 5rem"
                        :placeholder="t('settings.countPlaceholder')"
                      />
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.historyRetention') }}</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.history_retention_days"
                        type="number"
                        min="1"
                        max="3650"
                        class="settings-input"
                      />
                      <span class="settings-unit">{{ t('settings.days') }}</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.defaultSort') }}</span>
                    <select v-model="form.default_sort" class="settings-input">
                      <option v-for="opt in getGallerySortOptions()" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </label>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.fileWatch') }}</h3>
                <label class="settings-field">
                  <span class="settings-field-label">{{ t('settings.ignoreDirs') }}</span>
                  <input
                    v-model="form.watch_ignore_dirs"
                    type="text"
                    class="settings-input"
                    :placeholder="t('settings.ignoreDirsPlaceholder')"
                  />
                  <span class="settings-field-hint">{{ t('settings.ignoreDirsHint') }}</span>
                </label>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.backupSection') }}</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" class="settings-btn" @click="onExportData">{{ t('settings.exportBtn') }}</button>
                  <button type="button" class="settings-btn" @click="onPickImportFile">{{ t('settings.importBtn') }}</button>
                  <input ref="importFileInput" type="file" accept="application/json,.json" class="hidden" @change="onImportFilePick" />
                  <span class="settings-field-hint">{{ t('settings.backupHint') }}</span>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.maintenance') }}</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" class="settings-btn" @click="onClearHistory">{{ t('settings.clearHistoryBtn') }}</button>
                  <span class="settings-field-hint">{{ t('settings.thumbWorkersHint') }}</span>
                </div>
              </section>
            </template>
          </div>
        </div>

        <footer class="settings-footer">
          <select v-model="settingsScope" class="settings-input" style="width: auto; min-width: 8rem">
            <option value="global">{{ t('settings.scopeGlobal') }}</option>
            <option value="library">{{ t('settings.scopeLibrary') }}</option>
          </select>
          <div class="flex gap-2">
            <button type="button" class="settings-btn" @click="close">{{ t('common.cancel') }}</button>
            <button type="button" class="settings-btn settings-btn--primary" @click="save">{{ t('common.save') }}</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
