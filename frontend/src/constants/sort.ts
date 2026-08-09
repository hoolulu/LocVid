import type { SortMode } from '@/types'
import { t } from '@/i18n'

export interface SortOption {
  value: SortMode
  label: string
}

/** 画廊排序（11 种，不含 page）——函数返回保证切换语言后 label 实时刷新 */
export function getGallerySortOptions(): SortOption[] {
  return [
    { value: 'mtime_desc', label: t('sort.mtimeDesc') },
    { value: 'mtime_asc', label: t('sort.mtimeAsc') },
    { value: 'playcount_desc', label: t('sort.playcountDesc') },
    { value: 'playcount_asc', label: t('sort.playcountAsc') },
    { value: 'title_asc', label: t('sort.titleAsc') },
    { value: 'title_desc', label: t('sort.titleDesc') },
    { value: 'size_desc', label: t('sort.sizeDesc') },
    { value: 'size_asc', label: t('sort.sizeAsc') },
    { value: 'random', label: t('sort.random') },
    { value: 'filename_asc', label: t('sort.filenameAsc') },
    { value: 'filename_desc', label: t('sort.filenameDesc') },
  ]
}

/** 播放列表排序（列表顺序 + 9 种） */
export function getPlaylistSortOptions(): SortOption[] {
  return [
    { value: 'page', label: t('sort.pageOrder') },
    { value: 'random', label: t('sort.random') },
    ...getGallerySortOptions().filter((o) => o.value !== 'random'),
  ]
}

// 兼容旧引用（模块级常量，切语言不刷新，仅用于不依赖动态场景的兜底）
export const GALLERY_SORT_OPTIONS: SortOption[] = getGallerySortOptions()
export const PLAYLIST_SORT_OPTIONS: SortOption[] = getPlaylistSortOptions()
