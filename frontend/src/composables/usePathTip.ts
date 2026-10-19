import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { Video } from '@/types'

const visible = ref(false)
const item = ref<Video | null>(null)
const anchorRect = ref<DOMRect | null>(null)
const inPlaylist = ref(false)
const tipLeft = ref(0)
const tipTop = ref(0)
const measuring = ref(false)
// 钉住状态：浮层已显示，鼠标移开后不自动消失，需点关闭按钮
const pinned = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null
// 离开卡片后的"宽限期"：鼠标多半正在移向浮层，给一点点时间让它落到浮层上。
// 直接 hide 的话，鼠标跨过卡片右边缘那一下浮层就没了（实测有几率触发）。
let hideTimer: ReturnType<typeof setTimeout> | null = null
let anchorEl: HTMLElement | null = null

// 卡片与浮层之间不留缝（positionTip 的 pad=0）：留缝时鼠标从卡片移向浮层会先压到
// 下层卡片，那张卡的 hover 把浮层重置掉，右下角的「本地播放」按钮就永远点不到。
// 贴紧后鼠标一离开卡片右边缘就进到浮层里，浮层的 mouseleave 才是收起时机。

function isPinMode() {
  // 默认移开鼠标自动消失（pin=false）；仅显式开启时才是钉住模式
  return useSettingsStore().settings?.html5_hover_tip_pin === true
}

function positionTip(tipW: number, tipH: number) {
  const rect = anchorRect.value
  if (!rect) return
  // 0：浮层紧贴卡片（留缝会让按钮点不到，见文件顶部的说明）
  const pad = 0
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left: number
  let top: number

  const spaceRight = vw - rect.right - pad
  const spaceLeft = rect.left - pad
  const spaceAbove = rect.top - pad

  if (inPlaylist.value && spaceLeft >= tipW) {
    left = rect.left - tipW - pad
    top = rect.top + rect.height / 2 - tipH / 2
  } else if (spaceRight >= tipW) {
    left = rect.right + pad
    top = rect.top + rect.height / 2 - tipH / 2
  } else if (spaceLeft >= tipW) {
    left = rect.left - tipW - pad
    top = rect.top + rect.height / 2 - tipH / 2
  } else if (spaceAbove >= tipH) {
    left = rect.left + rect.width / 2 - tipW / 2
    top = rect.top - tipH - pad
  } else {
    left = rect.left + rect.width / 2 - tipW / 2
    top = rect.bottom + pad
  }

  tipLeft.value = Math.round(Math.min(Math.max(pad, left), vw - tipW - pad))
  tipTop.value = Math.round(Math.min(Math.max(pad, top), vh - tipH - pad))
}

function scheduleShow(video: Video, anchor: HTMLElement, playlist = false) {
  if (!video.path) return
  // 悬停预览关闭时整个浮层不显示（含缩略图）
  if (useSettingsStore().settings?.html5_hover_preview === false) return
  // 钉住模式下浮层保留，不随新卡片 hover 更新（需先点关闭）
  if (pinned.value) return
  if (anchorEl === anchor && visible.value) return
  hide()
  anchorEl = anchor
  inPlaylist.value = playlist
  timer = setTimeout(() => {
    item.value = video
    anchorRect.value = anchor.getBoundingClientRect()
    tipLeft.value = -9999
    tipTop.value = -9999
    measuring.value = true
    visible.value = true
  }, 220)
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hide() {
  cancelHide()
  if (timer) clearTimeout(timer)
  timer = null
  anchorEl = null
  visible.value = false
  item.value = null
  measuring.value = false
  pinned.value = false
}

function onAnchorLeave(e: MouseEvent, anchor: HTMLElement) {
  const related = e.relatedTarget as Node | null
  if (related && anchor.contains(related)) return
  // 钉住模式：鼠标移开不隐藏，转为钉住状态（浮层保留，点关闭按钮才消失）
  if (isPinMode() && visible.value) {
    pinned.value = true
    return
  }
  // 鼠标是移进浮层（去点右下角的「本地播放」）：不算离开，交给浮层的 mouseleave 收
  if (related instanceof Element && related.closest('.path-tip')) return
  // 其余情况给 120ms 宽限：鼠标可能正跨过卡片边缘往浮层去，落到浮层上会 cancelHide
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    hide()
  }, 120)
}

function closeTip() {
  hide()
}

function afterLayout(tipEl: HTMLElement | null) {
  if (!tipEl || !anchorRect.value) return
  const preview = tipEl.querySelector('.path-tip-preview') as HTMLElement | null
  const body = tipEl.querySelector('.path-tip-body') as HTMLElement | null
  let w = 0
  if (preview) {
    const img = preview.querySelector('img') as HTMLImageElement | null
    const placeholder = preview.querySelector(
      '.path-tip-preview--placeholder',
    ) as HTMLElement | null
    // 占位（自适应比例）优先：宽度即预览区真实宽度，避免被下方 body 文字撑宽
    if (placeholder && placeholder.offsetWidth > 0) {
      w = Math.round(placeholder.offsetWidth)
    } else {
      const pr = preview.getBoundingClientRect()
      if (pr.width > 0) {
        w = Math.round(pr.width)
      } else if (img) {
        const ir = img.getBoundingClientRect()
        w = Math.round(ir.width)
        if (w <= 0 && img.naturalWidth > 0) {
          const maxW = Math.min(window.innerWidth * 0.88, 920)
          const maxH = Math.min(window.innerHeight * 0.7, 720)
          const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
          w = Math.round(img.naturalWidth * scale)
        }
      } else {
        // 占位模式兜底：16:9 比例
        w = Math.round(preview.offsetWidth || 0)
      }
    }
  }
  if (w <= 0) w = 640 // 极端兜底，避免浮层宽度塌陷
  if (w > 0) {
    tipEl.style.width = `${w}px`
    tipEl.style.maxWidth = `${w}px`
    if (body) {
      body.style.width = `${w}px`
      body.style.maxWidth = `${w}px`
    }
  }
  const rect = tipEl.getBoundingClientRect()
  positionTip(rect.width, rect.height)
  measuring.value = false
}

export function usePathTip() {
  return {
    cancelHide,
    visible,
    item,
    anchorRect,
    inPlaylist,
    tipLeft,
    tipTop,
    measuring,
    pinned,
    scheduleShow,
    hide,
    closeTip,
    onAnchorLeave,
    afterLayout,
  }
}
