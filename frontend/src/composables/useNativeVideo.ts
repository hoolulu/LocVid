import type { Video } from '@/types'

/**
 * 浏览器原生 `<video>` 播放通道。
 *
 * 为什么要有这条通道：movi-player 走的是 WASM 解封装 + WebCodecs 解码 + WebGL canvas
 * 渲染，任何文件都要多扛一层 canvas 上传；而库里绝大多数是标准 MP4 + H.264，浏览器
 * 本身就能系统硬解、直接 GPU 合层，成本低一个量级（1080p60 差距尤其明显）。
 *
 * 触发条件由后端 `/api/play/info` 的 `native` 字段给出（标准 MP4/H.264、非伪装 TS、
 * 非实验性直连），解不了的文件继续走 movi，两条通道互不影响。
 *
 * 原生通道用浏览器自带控件（`controls`），播放进度/续播/连播仍由 usePlayback 接管：
 * 这里只负责元素生命周期与媒体事件，不碰业务状态。
 */

export interface NativeVideoHandlers {
  onLoaded?: (durationSec: number) => void
  onTime?: (currentTime: number) => void
  onEnded?: () => void
  onPlayStateChange?: (playing: boolean) => void
  onError?: (err: unknown) => void
}

export interface NativeVideoPlayer {
  play(): void
  pause(): void
  seek(seconds: number): void
  getCurrentTime(): number
  getDuration(): number
  getPaused(): boolean
  getElement(): HTMLVideoElement | null
  setVolume(v: number): void
  setMuted(m: boolean): void
  destroy(): void
}

export function createNativeVideo(
  host: HTMLElement,
  url: string,
  handlers: NativeVideoHandlers = {},
  opts: { startAt?: number } = {},
): NativeVideoPlayer {
  const el = document.createElement('video')
  el.className = 'player-native-video'
  el.controls = true
  el.playsInline = true
  el.preload = 'metadata'
  el.autoplay = true
  // 原生控件在深色播放页里不刺眼：controls 由 UA 绘制，只能靠 CSS 变量微调
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.background = '#000'
  el.style.objectFit = 'contain'

  const startAt = opts.startAt && opts.startAt > 0 ? opts.startAt : 0
  let seekApplied = false

  function applyStart() {
    if (seekApplied || !startAt) return
    seekApplied = true
    try {
      el.currentTime = startAt
    } catch {
      /* metadata 未就绪时忽略，下次事件再试 */
    }
  }

  const onLoadedMetadata = () => {
    applyStart()
    handlers.onLoaded?.(el.duration || 0)
  }
  const onTimeUpdate = () => handlers.onTime?.(el.currentTime)
  const onEnded = () => handlers.onEnded?.()
  const onPlay = () => handlers.onPlayStateChange?.(true)
  const onPause = () => handlers.onPlayStateChange?.(false)
  const onError = () => handlers.onError?.(el.error || new Error('native video error'))

  el.addEventListener('loadedmetadata', onLoadedMetadata)
  el.addEventListener('canplay', applyStart)
  el.addEventListener('timeupdate', onTimeUpdate)
  el.addEventListener('ended', onEnded)
  el.addEventListener('play', onPlay)
  el.addEventListener('pause', onPause)
  el.addEventListener('error', onError)

  el.src = url
  host.appendChild(el)

  return {
    play() {
      void el.play().catch(() => {
        /* 自动播放被拦：用户点一下控件即可，不弹错 */
      })
    },
    pause() {
      el.pause()
    },
    seek(seconds: number) {
      el.currentTime = seconds
    },
    getCurrentTime() {
      return el.currentTime
    },
    getDuration() {
      return el.duration || 0
    },
    getPaused() {
      return el.paused
    },
    getElement() {
      return el
    },
    setVolume(v: number) {
      el.volume = v
    },
    setMuted(m: boolean) {
      el.muted = m
    },
    destroy() {
      el.removeEventListener('loadedmetadata', onLoadedMetadata)
      el.removeEventListener('canplay', applyStart)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('error', onError)
      try {
        el.pause()
      } catch {
        /* ignore */
      }
      el.removeAttribute('src')
      el.load()
      el.remove()
    },
  }
}

export type { Video as NativeVideoItem }
