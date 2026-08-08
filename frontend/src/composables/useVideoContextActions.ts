import { onMounted, onUnmounted } from 'vue'
import { openFolder, renameVideo, deleteVideos } from '@/api/files'
import { regenerateThumbSmart } from '@/composables/useThumbRegenerate'
import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { usePlayback } from '@/composables/usePlayback'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore, type ContextMenuItem } from '@/stores/ui'
import type { Video } from '@/types'

export function videoContextMenuItems(video?: Video): ContextMenuItem[] {
  return [
    { label: '播放', action: 'play' },
    { label: '换缩略图', action: 'regen-thumb' },
    // 按当前状态动态文案（业内惯例：已收藏/已加入专辑时显示操作反向）
    { label: video?.favorited ? '取消收藏' : '收藏', action: 'favorite' },
    {
      label: video?.albumIds?.length ? `管理专辑（${video.albumIds.length}）` : '加入专辑',
      action: 'add-album',
    },
    { label: '重命名', action: 'rename' },
    { label: '移动到分类', action: 'move' },
    { label: '打开所在文件夹', action: 'open-folder' },
    { label: '复制文件路径', action: 'copy-path' },
    { label: '复制标题', action: 'copy-title' },
    { label: '属性', action: 'props' },
    { label: '删除', action: 'delete', danger: true },
  ]
}

export function showVideoContextMenu(e: MouseEvent, videoId: string) {
  const ui = useUiStore()
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const video =
    gallery.videos.find((v) => v.id === videoId) ??
    player.playlist.find((v) => v.id === videoId) ??
    (player.playingId === videoId ? player.playingItem : undefined)
  ui.showContextMenu(e, videoContextMenuItems(video), { targetId: videoId, targetType: 'video' })
}

/** 复制文本到剪贴板：优先 Async Clipboard API，失败时回退 execCommand('copy') */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 降级到 execCommand */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function findVideo(id: string, gallery: ReturnType<typeof useGalleryStore>, player: ReturnType<typeof usePlayerStore>): Video | undefined {
  return gallery.videos.find((v) => v.id === id) ?? player.playlist.find((v) => v.id === id)
}

function patchVideoInPlayer(id: string, patch: Partial<Video>) {
  const player = usePlayerStore()
  const pl = player.playlist.find((v) => v.id === id)
  if (pl) Object.assign(pl, patch)
  if (player.playingId === id && player.playingItem) Object.assign(player.playingItem, patch)
}

export function setupVideoContextActions() {
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const ui = useUiStore()
  const { onPlay, onToggleFavorite } = useGalleryPlay()
  const { playVideo, cancelPlayback } = usePlayback()

  async function onContextAction(ev: Event) {
    const detail = (ev as CustomEvent).detail as {
      action: string
      targetId?: string
      targetType?: string
    }
    if (detail.targetType !== 'video') return
    const id = detail.targetId
    if (!id) return

    if (detail.action === 'play') {
      if (player.open) {
        const item = findVideo(id, gallery, player)
        if (item) await playVideo(item, player.playlist)
      } else {
        await onPlay(id)
      }
    } else if (detail.action === 'favorite') {
      await onToggleFavorite(id)
      const plItem = player.playlist.find((v) => v.id === id)
      if (plItem) plItem.favorited = !plItem.favorited
    } else if (detail.action === 'add-album') {
      ui.openAlbumPicker([id])
    } else if (detail.action === 'open-folder') {
      await openFolder(id)
    } else if (detail.action === 'copy-path') {
      const item = findVideo(id, gallery, player)
      const path = item?.path || item?.filename || ''
      await copyTextToClipboard(path)
      ui.showToast(path ? '文件路径已复制' : '未找到文件路径')
    } else if (detail.action === 'copy-title') {
      const item = findVideo(id, gallery, player)
      const title = item?.title || ''
      await copyTextToClipboard(title)
      ui.showToast(title ? '标题已复制' : '未找到标题')
    } else if (detail.action === 'props') {
      ui.openVideoProps(id)
    } else if (detail.action === 'regen-thumb') {
      await regenerateThumbSmart(id)
      await gallery.loadVideos()
    } else if (detail.action === 'rename') {
      const item = findVideo(id, gallery, player)
      // 默认值不含后缀（用户改的是主名），提示语说明扩展名会自动保留
      const suffix = item?.filename?.match(/\.[^.]+$/)?.[0] || ''
      const defaultStem = suffix ? (item?.filename ?? '').slice(0, -suffix.length) : (item?.filename ?? '')
      const name = prompt(`新文件名（扩展名 ${suffix || '将自动保留'}）`, defaultStem || item?.title || '')
      if (name) {
        // 后端始终保留原扩展名：按 stem（去掉扩展名）传参，避免 "xxx.mp4" 被追加成 "xxx.mp4.mp4"
        const stem =
          suffix && name.toLowerCase().endsWith(suffix.toLowerCase())
            ? name.slice(0, -suffix.length)
            : name
        const res = await renameVideo(id, stem)
        // 改名后视频 id（路径 hash）变化：同步更新播放列表里的 id，
        // 列表本身由 loadVideos 重拉（后端已把收藏/历史/专辑/缩略图迁移到新 id）
        const newId = res.id ?? id
        patchVideoInPlayer(id, { id: newId, filename: stem + suffix, title: stem })
        await gallery.loadVideos()
        ui.showToast('已重命名')
      }
    } else if (detail.action === 'move') {
      ui.openFolderMove({ mode: 'videos', videoIds: [id], category: gallery.category || undefined })
    } else if (detail.action === 'delete') {
      const ok = await ui.showConfirm(
        '删除后视频会移入回收站，收藏/历史/专辑记录会一并移除。',
        '确定删除此视频？',
      )
      if (!ok) return
      const wasPlaying = player.playingId === id
      const idx = player.playlist.findIndex((v) => v.id === id)
      await deleteVideos([id])
      const remaining = player.playlist.filter((v) => v.id !== id)
      player.playlist = remaining
      if (wasPlaying) {
        if (remaining.length) {
          const next = remaining[Math.min(idx, remaining.length - 1)]
          await playVideo(next, remaining)
        } else {
          await cancelPlayback()
        }
      }
      await gallery.loadVideos()
      ui.showToast('已删除')
    }
  }

  onMounted(() => document.addEventListener('lg-context-action', onContextAction))
  onUnmounted(() => document.removeEventListener('lg-context-action', onContextAction))
}
