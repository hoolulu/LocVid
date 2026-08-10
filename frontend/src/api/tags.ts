import { api } from './client'
import type { TagInfo } from '@/types'

export const getTags = () => api<{ items: TagInfo[] }>('/tags')

export const getTagVideos = (tag: string) =>
  api<{ tag: string; video_ids: string[] }>(`/tags/${encodeURIComponent(tag)}/videos`)

export const getVideoTags = (videoId: string) =>
  api<{ video_id: string; tags: string[] }>(`/videos/${videoId}/tags`)

export const setVideoTags = (videoId: string, tags: string[]) =>
  api<{ ok: boolean; video_id: string; tags: string[] }>(`/videos/${videoId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  })

export const addVideoTags = (videoId: string, tags: string[]) =>
  api<{ ok: boolean; video_id: string; tags: string[] }>(`/videos/${videoId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  })

export const removeVideoTag = (videoId: string, tag: string) =>
  api<{ ok: boolean; video_id: string; tags: string[] }>(
    `/videos/${videoId}/tags/${encodeURIComponent(tag)}`,
    { method: 'DELETE' },
  )
