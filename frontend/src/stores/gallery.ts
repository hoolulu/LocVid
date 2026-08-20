import { defineStore } from 'pinia'

import { ref } from 'vue'

import { getCategories, getVideos } from '@/api'

import { getFolders } from '@/api/files'
import { getTags } from '@/api/tags'

import type { Category, FolderTreeResponse, SortMode, TagInfo, Video, ViewMode } from '@/types'
import type { ThemePreset } from '@/stores/settings'
import { DEFAULT_PAGE_SIZE } from '@/constants/layout'
import { pageSizeKey, PREFS_KEYS, getSavedBrowseState, setSavedBrowseState } from '@/utils/userPrefs'
import { clearVideoListCache } from '@/utils/videoListCache'



const RANDOM_SEED_KEY = PREFS_KEYS.randomSeed
const SORT_KEY = PREFS_KEYS.sort

// 视频列表请求序号：快速连续搜索/翻页时丢弃过期响应，避免慢响应覆盖新结果
let videosReqSeq = 0

export const DEFAULT_GALLERY_SORT: SortMode = 'mtime_desc'

export function defaultPageSizeForPreset(preset: ThemePreset): number {
  return DEFAULT_PAGE_SIZE[preset]
}

function pageSizeStorageKey(preset: ThemePreset) {
  return pageSizeKey(preset)
}



export const useGalleryStore = defineStore('gallery', () => {

  const viewMode = ref<ViewMode>('browse')

  const categories = ref<Category[]>([])

  const category = ref<string | null>(null)

  const folder = ref<string | null>(null)

  const query = ref('')

  const sort = ref<SortMode>(DEFAULT_GALLERY_SORT)

  // 分类排序模式（custom=自定义顺序可拖拽；其余按名称/数量排序）——从后端同步，避免"显示自定义实际非自定义"导致拖拽无效
  const categorySortMode = ref('custom')

  const randomSeed = ref<number | null>(null)

  const formatFilter = ref('')

  const tagFilter = ref('')

  const tagOptions = ref<TagInfo[]>([])

  const continueWatching = ref(false)

  const page = ref(1)

  const pageSize = ref(40)

  const videos = ref<Video[]>([])

  const total = ref(0)

  const totalPages = ref(0)

  const loading = ref(false)

  const refreshing = ref(false)

  const albumId = ref<string | null>(null)

  const expandedCategories = ref<Set<string>>(new Set())

  const expandedFolders = ref<Set<string>>(new Set())

  const folderTrees = ref<Record<string, FolderTreeResponse>>({})



  function restoreSort() {
    const saved = localStorage.getItem(SORT_KEY)
    if (saved) sort.value = saved as SortMode
    else sort.value = DEFAULT_GALLERY_SORT
  }

  /** 应用设置里的默认排序：仅在用户从未手动选过排序（无 localStorage 记录）时生效 */
  function applyDefaultSort(defaultSort?: SortMode) {
    if (defaultSort && !localStorage.getItem(SORT_KEY)) {
      sort.value = defaultSort
    }
  }

  function persistSort() {
    localStorage.setItem(SORT_KEY, sort.value)
  }

  function restoreBrowseState() {
    const saved = getSavedBrowseState()
    category.value = saved.category
    folder.value = saved.folder
  }

  function persistBrowseState() {
    setSavedBrowseState({ category: category.value, folder: folder.value })
  }

  function restoreRandomSeed() {
    const saved = localStorage.getItem(RANDOM_SEED_KEY)
    if (saved) randomSeed.value = Number(saved)
  }

  function restorePageSize(preset: ThemePreset) {
    const key = pageSizeStorageKey(preset)
    const saved = localStorage.getItem(key) ?? localStorage.getItem(PREFS_KEYS.pageSize)
    if (saved === 'all') {
      pageSize.value = defaultPageSizeForPreset(preset)
      localStorage.setItem(key, String(pageSize.value))
    } else if (saved) {
      const n = Number(saved)
      if (Number.isFinite(n) && n > 0) pageSize.value = n
      else pageSize.value = defaultPageSizeForPreset(preset)
    } else {
      pageSize.value = defaultPageSizeForPreset(preset)
    }
  }

  function setPageSize(size: number, preset: ThemePreset) {
    if (!Number.isFinite(size) || size < 1) return
    pageSize.value = size
    page.value = 1
    localStorage.setItem(pageSizeStorageKey(preset), String(size))
  }



  function persistRandomSeed() {

    if (randomSeed.value != null) {

      localStorage.setItem(RANDOM_SEED_KEY, String(randomSeed.value))

    } else {

      localStorage.removeItem(RANDOM_SEED_KEY)

    }

  }



  async function loadCategories() {

    const data = await getCategories()

    categories.value = data.items

    categorySortMode.value = data.sort_mode || 'custom'

  }



  async function loadFolderTree(cat: string) {

    if (folderTrees.value[cat]) return folderTrees.value[cat]

    const tree = await getFolders(cat)

    folderTrees.value[cat] = tree as FolderTreeResponse

    return tree as FolderTreeResponse

  }



  async function loadVideos(opts?: { sort?: SortMode }) {

    const mySeq = ++videosReqSeq

    const activeSort = opts?.sort ?? sort.value

    const params: Record<string, string | number | boolean> = {

      page: page.value,

      page_size: pageSize.value,

      sort: activeSort,

    }

    if (category.value) params.category = category.value

    if (folder.value) params.folder = folder.value

    if (query.value.trim()) params.q = query.value.trim()

    if (formatFilter.value) params.format = formatFilter.value

    if (tagFilter.value) params.tag = tagFilter.value

    if (continueWatching.value) params.continue_watching = true

    if (viewMode.value === 'favorites') params.favorites = true

    if (viewMode.value === 'history') params.history = true

    if (viewMode.value === 'album-detail' && albumId.value) params.album_id = albumId.value

    if (activeSort === 'random' && randomSeed.value != null) params.seed = randomSeed.value

    // 不再读列表缓存：本地服务毫秒级返回，且缓存键无版本校验会命中改名/重扫前的旧数据
    // （旧 id 的专辑/收藏状态），导致改名后页面显示过期状态
    loading.value = true
    refreshing.value = true

    try {

      const data = await getVideos(params)

      if (mySeq !== videosReqSeq) return // 已被更新的请求取代，丢弃过期响应

      videos.value = data.items

      total.value = data.total

      page.value = data.page

      pageSize.value = data.pageSize

      totalPages.value = data.totalPages

    } finally {

      if (mySeq === videosReqSeq) {
        loading.value = false
        refreshing.value = false
      }

    }

  }



  function regenerateRandomSeedIfNeeded() {
    if (sort.value === 'random') {
      randomSeed.value = Date.now()
      persistRandomSeed()
    }
  }

  function setCategory(name: string | null) {

    category.value = name

    folder.value = null

    page.value = 1
    persistBrowseState()
    regenerateRandomSeedIfNeeded()

  }



  function setFolder(path: string | null) {

    folder.value = path

    page.value = 1
    persistBrowseState()
    regenerateRandomSeedIfNeeded()

  }



  function setSort(next: SortMode) {

    sort.value = next

    if (next === 'random') {

      randomSeed.value = Date.now()

      persistRandomSeed()

    } else {

      randomSeed.value = null

      persistRandomSeed()

    }

    page.value = 1
    persistSort()

  }



  function setFormatFilter(value: string) {

    formatFilter.value = value

    page.value = 1
    regenerateRandomSeedIfNeeded()

  }



  function setTagFilter(value: string) {

    tagFilter.value = value

    page.value = 1
    regenerateRandomSeedIfNeeded()

  }



  function setContinueWatching(value: boolean) {

    continueWatching.value = value

    page.value = 1

  }



  async function loadTagOptions() {

    const data = await getTags()

    tagOptions.value = data.items

  }



  function toggleCategoryExpanded(name: string) {

    const next = new Set(expandedCategories.value)

    if (next.has(name)) next.delete(name)

    else next.add(name)

    expandedCategories.value = next

  }



  function toggleFolderExpanded(path: string) {

    const next = new Set(expandedFolders.value)

    if (next.has(path)) next.delete(path)

    else next.add(path)

    expandedFolders.value = next

  }



  function clearFolderCaches() {

    folderTrees.value = {}

    expandedCategories.value = new Set()

    expandedFolders.value = new Set()
    clearVideoListCache()

  }



  return {

    viewMode,

    categories,

    categorySortMode,

    category,

    folder,

    query,

    sort,

    randomSeed,

    formatFilter,

    tagFilter,

    tagOptions,

    continueWatching,

    page,

    pageSize,

    videos,

    total,

    totalPages,

    loading,

    refreshing,

    albumId,

    expandedCategories,

    expandedFolders,

    folderTrees,

    restoreRandomSeed,
    restoreBrowseState,
    restoreSort,
    applyDefaultSort,
    restorePageSize,
    setPageSize,

    loadCategories,

    loadFolderTree,

    loadVideos,

    setCategory,

    setFolder,

    setSort,

    setFormatFilter,

    setTagFilter,

    setContinueWatching,

    loadTagOptions,

    toggleCategoryExpanded,

    toggleFolderExpanded,

    clearFolderCaches,

    regenerateRandomSeedIfNeeded,

  }

})


