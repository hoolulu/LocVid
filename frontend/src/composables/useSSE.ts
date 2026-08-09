import { onUnmounted, ref } from 'vue'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'

let versionDebounce: ReturnType<typeof setTimeout> | null = null
let lastVersion = ''
// 切库后抑制 SSE 握手触发二次列表加载：切库（activeLibraryId 变化）会触发 SSE 重连，
// 新连接握手推 version（新库版本≠旧库 lastVersion → changed=true）→ 500ms 后重复 loadVideos
// → 图片显示后又被刷新一次（"轻微刷新动作"）。切库业务层已 loadVideos，握手不应再触发。
let suppressVersionLoadUntil = 0

export function suppressVersionLoad(ms = 2000) {
  suppressVersionLoadUntil = Date.now() + ms
}

export function useSSE(onVersion?: () => void, onProgress?: () => void) {
  const connected = ref(false)
  let es: EventSource | null = null
  const gallery = useGalleryStore()
  const library = useLibraryStore()

  function connect() {
    es?.close()
    const libQ = library.activeLibraryId
      ? `?library_id=${encodeURIComponent(library.activeLibraryId)}`
      : ''
    es = new EventSource(`/api/events${libQ}`)
    connected.value = true

    es.onmessage = (e) => {
      const colon = e.data.indexOf(':')
      const type = colon >= 0 ? e.data.slice(0, colon) : e.data
      const payload = colon >= 0 ? e.data.slice(colon + 1) : ''
      if (type === 'version') {
        const parts = payload.split(':')
        const lid = parts.length > 1 ? parts[0] : ''
        const ver = parts.length > 1 ? parts.slice(1).join(':') : payload
        if (lid && lid !== library.activeLibraryId) return
        if (versionDebounce) clearTimeout(versionDebounce)
        versionDebounce = setTimeout(async () => {
          // 切库握手窗口内：不重复加载列表（业务层已 loadVideos）
          if (Date.now() < suppressVersionLoadUntil) {
            lastVersion = ver
            return
          }
          const changed = ver && ver !== lastVersion
          lastVersion = ver
          await gallery.loadCategories()
          if (changed) await gallery.loadVideos()
          onVersion?.()
        }, 500)
      } else if (type === 'progress') {
        onProgress?.()
      }
    }

    es.onerror = () => {
      es?.close()
      es = null
      connected.value = false
      setTimeout(connect, 5000)
    }
  }

  function disconnect() {
    es?.close()
    es = null
    connected.value = false
  }

  onUnmounted(disconnect)

  return { connected, connect, disconnect }
}
