<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore, type ThemePreset } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useAlbumStore } from '@/stores/album'
import { rescan, getSearchSuggest } from '@/api'
import HeaderProgressChips from '@/components/layout/HeaderProgressChips.vue'
import HeaderProgressBar from '@/components/layout/HeaderProgressBar.vue'

const route = useRoute()
const gallery = useGalleryStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const ui = useUiStore()
const album = useAlbumStore()

const navItems = [
  { name: 'browse', label: '首页', to: '/' },
  { name: 'favorites', label: '我的收藏', to: '/favorites' },
  { name: 'history', label: '最近播放', to: '/history' },
  { name: 'most-played', label: '最多播放', to: '/most-played' },
  { name: 'albums', label: '我的专辑', to: '/albums' },
]

const presetOptions: { value: ThemePreset; label: string }[] = [
  { value: 'netflix', label: '影院' },
  { value: 'youtube', label: '经典' },
]

const activeNav = computed(() => route.name)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let suggestTimer: ReturnType<typeof setTimeout> | null = null

// ── 搜索建议 / 历史 ──
const SEARCH_HISTORY_KEY = 'lg-search-history'
const searchSuggest = ref<string[]>([])
const showSuggest = ref(false)
const searchHistory = ref<string[]>(loadSearchHistory())

function loadSearchHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

function pushSearchHistory(q: string) {
  const t = q.trim()
  if (!t) return
  searchHistory.value = [t, ...searchHistory.value.filter((x) => x !== t)].slice(0, 10)
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory.value))
}

/** 提交一次搜索（输入/点建议/回车共用）：记录历史并重新加载列表 */
function submitSearch() {
  pushSearchHistory(gallery.query)
  showSuggest.value = false
  if (searchTimer) clearTimeout(searchTimer)
  void gallery.loadVideos()
}

async function onSearchInput(e: Event) {
  gallery.query = (e.target as HTMLInputElement).value
  // 搜索 = 全库搜索：清空分类/文件夹，避免"在分类里搜不到其他分类"的困惑
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  gallery.regenerateRandomSeedIfNeeded()
  showSuggest.value = true
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(() => {
    const q = gallery.query.trim()
    if (!q) {
      searchSuggest.value = []
      return
    }
    void getSearchSuggest(q).then((data) => {
      if (gallery.query.trim() === q) searchSuggest.value = data.items
    })
  }, 250)
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => gallery.loadVideos(), 300)
}

function onSearchFocus() {
  showSuggest.value = true
  searchHistory.value = loadSearchHistory()
}

function onSearchBlur() {
  // 延迟关闭，允许点击下拉项（mousedown 先于 blur 触发）
  setTimeout(() => {
    showSuggest.value = false
  }, 150)
}

function applySuggest(q: string) {
  gallery.query = q
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  gallery.regenerateRandomSeedIfNeeded()
  submitSearch()
}

function onSearchEnter(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  submitSearch()
}

async function onLibraryChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  await library.switchLibrary(id)
  gallery.clearFolderCaches()
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  await gallery.loadCategories()
  await gallery.loadVideos()
  await album.loadAlbums()
}

async function onRescan() {
  await rescan()
  await gallery.loadCategories()
  await gallery.loadVideos()
  ui.showToast('扫描完成')
}

async function onPresetChange(p: ThemePreset) {
  await settings.setPreset(p)
  const label = presetOptions.find((o) => o.value === p)?.label ?? p
  ui.showToast(`已切换为 ${label} 主题`)
}
</script>

<template>
  <header class="app-header shrink-0 border-b border-[var(--lg-border)] bg-[var(--lg-bg-header)]">
    <div class="app-header-main">
      <nav class="app-header-nav" aria-label="主视图">
        <h1 class="app-header-logo">
          <svg class="app-header-logo-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect
              x="2"
              y="4"
              width="20"
              height="16"
              rx="3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
            <path d="M10 9l6 3-6 3z" fill="currentColor" />
          </svg>
          <span class="text-[var(--lg-accent)]">Loc</span> Gallery
        </h1>
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="app-header-nav-link"
          :class="{ active: activeNav === item.name }"
        >
          {{ item.label }}
        </router-link>
        <div class="app-header-library">
          <span class="text-xs text-[var(--lg-text-muted)]">视频库</span>
          <select
            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1 text-sm"
            :value="library.activeLibraryId || ''"
            @change="onLibraryChange"
          >
            <option v-for="lib in library.libraries" :key="lib.id" :value="lib.id">
              {{ lib.alias }}
            </option>
          </select>
        </div>
      </nav>

      <div class="app-header-right">
        <div class="flex overflow-hidden rounded border border-[var(--lg-border)] text-xs" title="界面主题">
          <button
            v-for="p in presetOptions"
            :key="p.value"
            class="px-2.5 py-1.5 transition"
            :class="
              settings.preset === p.value
                ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]'
                : 'bg-[var(--lg-bg-secondary)] text-[var(--lg-text-secondary)] lg-hover'
            "
            @click="onPresetChange(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="relative">
          <input
            data-testid="search-input"
            type="search"
            placeholder="搜索"
            class="app-header-search rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-3 py-1.5 text-sm"
            :value="gallery.query"
            @input="onSearchInput"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown="onSearchEnter"
          />
          <div
            v-if="showSuggest"
            class="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] py-1 text-sm shadow-lg"
          >
            <template v-if="gallery.query.trim()">
              <button
                v-for="s in searchSuggest"
                :key="s"
                type="button"
                class="block w-full truncate px-3 py-1.5 text-left lg-hover"
                @mousedown.prevent="applySuggest(s)"
              >
                {{ s }}
              </button>
              <div v-if="!searchSuggest.length" class="px-3 py-1.5 text-[var(--lg-text-muted)]">
                无匹配建议
              </div>
            </template>
            <template v-else>
              <div v-if="searchHistory.length" class="px-3 pb-1 pt-1 text-xs text-[var(--lg-text-muted)]">
                搜索历史
              </div>
              <button
                v-for="h in searchHistory"
                :key="h"
                type="button"
                class="block w-full truncate px-3 py-1 text-left lg-hover"
                @mousedown.prevent="applySuggest(h)"
              >
                {{ h }}
              </button>
              <div v-if="!searchHistory.length" class="px-3 py-1.5 text-[var(--lg-text-muted)]">
                输入关键字搜索标题 / 文件名 / 分类 / 路径
              </div>
            </template>
          </div>
        </div>
        <button
          class="rounded border px-3 py-1.5 text-sm"
          :class="ui.manageMode ? 'border-[var(--lg-accent)] text-[var(--lg-accent)]' : 'border-[var(--lg-border)]'"
          @click="ui.manageMode = !ui.manageMode; if (!ui.manageMode) ui.clearSelection()"
        >
          批量
        </button>
        <button
          class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover"
          :title="settings.theme === 'dark' ? '切换亮色' : '切换暗色'"
          @click="settings.toggleTheme()"
        >
          {{ settings.theme === 'dark' ? '☾' : '☀' }}
        </button>
        <button class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover" @click="ui.settingsOpen = true">
          设置
        </button>
        <HeaderProgressChips />
        <button
          class="rounded border border-[var(--lg-accent)] px-3 py-1.5 text-sm text-[var(--lg-accent)] hover:bg-[var(--lg-accent-muted)]"
          @click="onRescan"
        >
          刷新
        </button>
      </div>
    </div>
    <HeaderProgressBar />
  </header>
</template>
