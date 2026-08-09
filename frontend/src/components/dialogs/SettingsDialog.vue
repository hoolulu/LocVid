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
import { cleanupOrphans, getThumbStats, regenerateFailed } from '@/api/thumbs'
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

type SettingsTab = 'library' | 'playback' | 'thumbnail' | 'other'
const TAB_KEY = 'loc-gallery-settings-tab'

const tab = ref<SettingsTab>((localStorage.getItem(TAB_KEY) as SettingsTab) || 'library')
const settingsScope = ref<'global' | 'library'>('global')
const form = reactive<Partial<Settings>>({})
const newLib = reactive({ alias: '', path: '' })
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

async function onRegenerateFailed() {
  const ok = await ui.showConfirm(t('settings.regenFailedMsg'), t('thumb.regenFailed'))
  if (!ok) return
  const res = (await regenerateFailed()) as { regenerated?: number }
  ui.showToast(t('settings.regenDone', { n: res.regenerated ?? 0 }))
}

const presets = computed(() => [
  { value: 'netflix', label: t('settings.preset.cinema') },
  { value: 'youtube', label: t('settings.preset.classic') },
])

const tabs = computed<{ id: SettingsTab; label: string }[]>(() => [
  { id: 'library', label: t('settings.tab.library') },
  { id: 'playback', label: t('settings.tab.playback') },
  { id: 'thumbnail', label: t('settings.tab.thumbnail') },
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
    if (v === 'netflix' || v === 'youtube') settings.previewPreset(v)
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
  await settings.updateSettings({ ...form }, settingsScope.value)
  ui.showToast(t('settings.saved'))
  close()
}

async function pickPath() {
  const res = await pickFolder()
  if (res.path) newLib.path = res.path
}

async function addLibrary() {
  if (!newLib.alias || !newLib.path) return
  await createLibrary(newLib.alias, newLib.path)
  newLib.alias = ''
  newLib.path = ''
  await library.loadLibraries()
}

async function saveLibraryRow(lib: { id: string; alias: string; path: string }) {
  await updateLibrary(lib.id, { alias: lib.alias, path: lib.path })
  ui.showToast(t('settings.saved'))
}

async function onRemoveLibrary(id: string, alias: string) {
  const ok = await ui.showConfirm(t('settings.library.deleteConfirm', { alias }), t('settings.deleteLibrary'))
  if (!ok) return
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
              <section class="settings-block">
                <h3 class="settings-block-title">{{ t('settings.libraryManage') }}</h3>
                <p class="settings-subtitle">{{ t('settings.existingLibraries') }}</p>
                <div v-if="library.libraries.length" class="lib-table">
                  <div class="lib-table-head">
                    <span>{{ t('settings.library.alias') }}</span>
                    <span>{{ t('settings.library.path') }}</span>
                    <span class="lib-col-actions">{{ t('settings.actions') }}</span>
                  </div>
                  <div class="lib-table-body">
                    <div v-for="lib in library.libraries" :key="lib.id" class="lib-table-row">
                      <input v-model="lib.alias" class="settings-input settings-input--compact" />
                      <div class="lib-path-cell">
                        <input v-model="lib.path" class="settings-input settings-input--compact" />
                      </div>
                      <div class="lib-col-actions">
                        <button type="button" class="settings-btn" @click="saveLibraryRow(lib)">{{ t('common.save') }}</button>
                        <button
                          type="button"
                          class="settings-btn settings-btn--danger"
                          @click="onRemoveLibrary(lib.id, lib.alias)"
                        >
                          {{ t('common.delete') }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="lib-empty">{{ t('settings.emptyLibraries') }}</div>

                <p class="settings-subtitle" style="margin-top: 1rem">{{ t('settings.addLibraryTitle') }}</p>
                <div class="lib-table-row lib-add-row">
                  <input
                    v-model="newLib.alias"
                    :placeholder="t('settings.library.alias')"
                    class="settings-input settings-input--compact"
                    autocomplete="off"
                  />
                  <div class="lib-path-cell">
                    <input
                      v-model="newLib.path"
                      :placeholder="t('settings.library.path')"
                      class="settings-input settings-input--compact"
                      autocomplete="off"
                    />
                    <button type="button" class="settings-btn" @click="pickPath">{{ t('settings.library.browse') }}</button>
                  </div>
                  <div class="lib-col-actions">
                    <button type="button" class="settings-btn settings-btn--primary" @click="addLibrary">
                      {{ t('settings.library.add') }}
                    </button>
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
                    <span class="settings-field-label">{{ t('settings.pinMode') }}</span>
                    <select v-model="form.html5_hover_tip_pin" class="settings-input">
                      <option :value="true">{{ t('settings.pinOn') }}</option>
                      <option :value="false">{{ t('settings.pinOff') }}</option>
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
                  <label class="settings-field">
                    <span class="settings-field-label">{{ t('settings.hoverPreview') }}</span>
                    <select v-model="form.html5_hover_preview" class="settings-input">
                      <option :value="true">{{ t('settings.hoverPreviewOn') }}</option>
                      <option :value="false">{{ t('settings.hoverPreviewOff') }}</option>
                    </select>
                  </label>
                  <label v-if="form.html5_hover_preview" class="settings-field">
                    <span class="settings-field-label">{{ t('settings.hoverPreviewMode') }}</span>
                    <select v-model="form.html5_hover_preview_mode" class="settings-input">
                      <option value="video">{{ t('settings.hoverPreviewModeVideo') }}</option>
                      <option value="thumb">{{ t('settings.hoverPreviewModeThumb') }}</option>
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
                <h3 class="settings-block-title">{{ t('settings.maintenance') }}</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <span class="settings-field-hint">
                    {{ t('settings.cacheUsage', { text: thumbStats ? `${formatThumbBytes(thumbStats.bytes)}（${thumbStats.files} ${t('thumb.files')}）` : '…' }) }}
                  </span>
                  <button type="button" class="settings-btn" @click="onCleanupThumbs">{{ t('settings.cleanupBtn') }}</button>
                  <button type="button" class="settings-btn" @click="onRegenerateFailed">{{ t('settings.regenFailedBtn') }}</button>
                </div>
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
