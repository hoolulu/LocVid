import { api } from './client'
import type { PlayInfo, Video } from '@/types'

export const getPlayInfo = (id: string) => api<PlayInfo>(`/play/info/${id}`)

export interface PlayExternalOptions {
  /** 播放列表 id（按右侧列表顺序），第一项之后接着播 */
  ids?: string[]
  /** 续播位置（秒），>5 才会传给播放器 */
  startSec?: number
  /** 新开一个播放器实例（默认 true；false 则复用已开的窗口） */
  newInstance?: boolean
}

export const playExternal = (id: string, opts: PlayExternalOptions = {}) =>
  api<{ ok: boolean; path: string; playlist?: string | null; player?: string }>(
    `/play-external/${id}`,
    {
      method: 'POST',
      body: JSON.stringify({
        ids: opts.ids ?? [],
        start_sec: opts.startSec ?? null,
        new_instance: opts.newInstance ?? true,
      }),
    },
  )

export const startRemux = (id: string) =>
  api<Record<string, unknown>>(`/videos/${id}/remux`, { method: 'POST' })

export const getRemuxStatus = (id: string) =>
  api<{ state: string; progress_pct?: number; message?: string; error?: string }>(
    `/videos/${id}/remux`,
  )

export const recordPlay = (id: string) =>
  api('/history/record', { method: 'POST', body: JSON.stringify({ id }) })

export const savePosition = (id: string, positionSec: number, durationSec?: number) =>
  api('/history/position', {
    method: 'POST',
    body: JSON.stringify({ id, position_sec: positionSec, duration_sec: durationSec }),
  })

export type { Video }
