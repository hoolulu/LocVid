import type { ThemePreset } from '@/stores/settings'

/** 经典主题每行 9 个，影院主题每行 10 个 */
export const GRID_COLUMNS: Record<ThemePreset, number> = {
  classic: 9,
  cinema: 10,
}

export const DEFAULT_PAGE_SIZE: Record<ThemePreset, number> = {
  classic: 45,
  cinema: 50,
}
