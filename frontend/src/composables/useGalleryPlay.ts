import { toggleFavorite } from '@/api'
import { playExternal } from '@/api/play'
import { usePlayback } from '@/composables/usePlayback'
import { usePlaylistLoader } from '@/composables/usePlaylistLoader'
import { t } from '@/i18n'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { Video } from '@/types'

export function useGalleryPlay() {
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const ui = useUiStore()
  const settings = useSettingsStore()
  const { playVideo } = usePlayback()
  const { bindFromGallery, bindRandomPlaylist } = usePlaylistLoader()

  async function onPlay(id: string, list?: Video[]) {
    if (player.open) {
      ui.showToast(t('other.closePlayerFirst'))
      return
    }
    const source = list ?? gallery.videos
    const item = source.find((v) => v.id === id)
    if (!item) return

    // 设置里选了「本地播放器」：直接交给外部播放器（带当前列表 + 续播位置）
    if (settings.settings?.player_mode === 'local') {
      try {
        await playExternal(item.id, {
          ids: source.map((v) => v.id),
          startSec: item.playPosition ?? undefined,
          newInstance: true,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ui.showToast(t('player.playLocalFailed', { msg }), 'error')
      }
      return
    }

    bindFromGallery(source)
    player.playlistSort = gallery.sort
    player.playlistRandomSeed = gallery.randomSeed
    await playVideo(item, player.playlist)
  }

  async function onToggleFavorite(id: string) {
    await toggleFavorite(id)
    await gallery.loadVideos()
  }

  async function onRandomPlay() {
    if (player.open) {
      ui.showToast(t('other.closePlayerFirst'))
      return
    }
    const seed = Date.now()
    gallery.setSort('random')
    gallery.randomSeed = seed
    try {
      const item = await bindRandomPlaylist(seed)
      if (!item) {
        ui.showToast(t('page.noVideos'))
        return
      }
      await playVideo(item, player.playlist)
    } catch (err) {
      ui.showToast(t('page.randomFailed', { msg: err instanceof Error ? err.message : String(err) }))
    }
  }

  return { onPlay, onToggleFavorite, onRandomPlay }
}
