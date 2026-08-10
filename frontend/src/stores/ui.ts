import { defineStore } from 'pinia'

import { computed, ref } from 'vue'

import { t } from '@/i18n'

import type { ThumbCandidate } from '@/api/thumbs'



export type ContextMenuItem = {

  label: string

  action: string

  danger?: boolean

  disabled?: boolean

}



export const useUiStore = defineStore('ui', () => {

  const manageMode = ref(false)

  const selectedIds = ref<Set<string>>(new Set())

  const settingsOpen = ref(false)

  const toast = ref<{ message: string; type?: string } | null>(null)



  const nonStandardOpen = ref(false)

  const nonStandardReason = ref('')

  const nonStandardRemuxable = ref(false)

  let nonStandardResolver: ((choice: 'remux' | 'external' | 'cancel') => void) | null = null



  const albumPickerOpen = ref(false)

  const albumPickerIds = ref<string[]>([])



  const thumbFailedOpen = ref(false)

  const thumbProgressExpanded = ref(false)

  const thumbPickerOpen = ref(false)
  const thumbPickerVideoId = ref<string | null>(null)
  const thumbPickerSubtitle = ref('')
  const thumbPickerCandidates = ref<ThumbCandidate[]>([])
  const thumbPickerVersion = ref('')
  let thumbPickerResolver: ((picked: boolean) => void) | null = null

  const folderMoveOpen = ref(false)
  const folderMovePayload = ref<{
    mode: 'folder' | 'videos'
    category?: string
    path?: string
    folderType?: 'subdir' | 'cat'
    videoIds?: string[]
  } | null>(null)

  // ── 视频属性面板（右键"属性"）──
  const videoPropsOpen = ref(false)
  const videoPropsId = ref<string | null>(null)

  function openVideoProps(videoId: string) {
    videoPropsId.value = videoId
    videoPropsOpen.value = true
    lockModalScroll(true)
  }

  function closeVideoProps() {
    videoPropsOpen.value = false
    videoPropsId.value = null
    lockModalScroll(false)
  }

  // ── 通用确认对话框（替代原生 confirm，风格与 UI 一致）──
  const confirmDialog = ref<{ title: string; message: string } | null>(null)
  let confirmResolver: ((ok: boolean) => void) | null = null



  const contextMenu = ref<{

    x: number

    y: number

    items: ContextMenuItem[]

    targetId?: string

    targetType?: 'video' | 'album' | 'folder'

    payload?: Record<string, unknown>

  } | null>(null)



  const selectedCount = computed(() => selectedIds.value.size)



  function toggleSelect(id: string) {

    const next = new Set(selectedIds.value)

    if (next.has(id)) {
      next.delete(id)
      // 取消最后一个选中：退出批量模式，恢复默认浏览状态
      // （否则 manageMode 残留 → body.manage-mode class 不删、卡片点击被拦截为勾选）
      if (next.size === 0) manageMode.value = false
    } else {
      next.add(id)
      manageMode.value = true
    }

    selectedIds.value = next

  }



  function selectAll(ids: string[]) {

    selectedIds.value = new Set(ids)

  }



  function clearSelection(exitBatch = false) {

    selectedIds.value = new Set()

    if (exitBatch) manageMode.value = false

  }



  function showToast(message: string, type = 'info') {

    toast.value = { message, type }

    setTimeout(() => {

      if (toast.value?.message === message) toast.value = null

    }, 3000)

  }



  function showNonStandardDialog(opts: { reason?: string; remuxable?: boolean }) {

    return new Promise<'remux' | 'external' | 'cancel'>((resolve) => {

      nonStandardReason.value = opts.reason || t('other.fragmentedNoDirect')

      nonStandardRemuxable.value = !!opts.remuxable

      nonStandardOpen.value = true

      nonStandardResolver = resolve

    })

  }



  function resolveNonStandard(choice: 'remux' | 'external' | 'cancel') {

    nonStandardOpen.value = false

    if (nonStandardResolver) {

      nonStandardResolver(choice)

      nonStandardResolver = null

    }

  }



  function openAlbumPicker(ids: string[]) {

    albumPickerIds.value = ids

    albumPickerOpen.value = true

  }



  function closeAlbumPicker() {

    albumPickerOpen.value = false

    albumPickerIds.value = []

  }

  // 标签编辑器（右键 → 编辑标签）
  const tagEditorOpen = ref(false)
  const tagEditorId = ref<string | null>(null)

  function openTagEditor(videoId: string) {
    tagEditorId.value = videoId
    tagEditorOpen.value = true
  }

  function closeTagEditor() {
    tagEditorOpen.value = false
    tagEditorId.value = null
  }

  function lockModalScroll(lock: boolean) {
    document.documentElement.classList.toggle('lg-modal-open', lock)
  }

  function showThumbPicker(data: {
    videoId: string
    subtitle?: string
    candidates: ThumbCandidate[]
    version: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      thumbPickerVideoId.value = data.videoId
      thumbPickerSubtitle.value = data.subtitle || ''
      thumbPickerCandidates.value = data.candidates
      thumbPickerVersion.value = data.version
      thumbPickerOpen.value = true
      thumbPickerResolver = resolve
      lockModalScroll(true)
    })
  }

  function closeThumbPicker(picked = false) {
    thumbPickerOpen.value = false
    thumbPickerVideoId.value = null
    thumbPickerSubtitle.value = ''
    thumbPickerCandidates.value = []
    thumbPickerVersion.value = ''
    lockModalScroll(false)
    if (thumbPickerResolver) {
      thumbPickerResolver(picked)
      thumbPickerResolver = null
    }
  }

  function openFolderMove(payload: NonNullable<typeof folderMovePayload.value>) {
    folderMovePayload.value = payload
    folderMoveOpen.value = true
  }

  function closeFolderMove() {
    folderMoveOpen.value = false
    folderMovePayload.value = null
  }



  function showContextMenu(

    e: MouseEvent,

    items: ContextMenuItem[],

    meta: { targetId?: string; targetType?: 'video' | 'album' | 'folder'; payload?: Record<string, unknown> },

  ) {

    e.preventDefault()

    contextMenu.value = {

      x: e.clientX,

      y: e.clientY,

      items,

      ...meta,

    }

  }



  function hideContextMenu() {

    contextMenu.value = null

  }



  function showConfirm(message: string, title = t('other.confirmOp')): Promise<boolean> {
    confirmDialog.value = { title, message }
    lockModalScroll(true)
    return new Promise((resolve) => {
      confirmResolver = resolve
    })
  }

  function resolveConfirm(ok: boolean) {
    confirmDialog.value = null
    lockModalScroll(false)
    if (confirmResolver) {
      confirmResolver(ok)
      confirmResolver = null
    }
  }



  return {

    manageMode,

    selectedIds,

    settingsOpen,

    toast,

    nonStandardOpen,

    nonStandardReason,

    nonStandardRemuxable,

    albumPickerOpen,

    albumPickerIds,
    tagEditorOpen,
    tagEditorId,
    openTagEditor,
    closeTagEditor,

    thumbFailedOpen,

    thumbProgressExpanded,

    thumbPickerOpen,

    thumbPickerVideoId,
    thumbPickerSubtitle,
    thumbPickerCandidates,
    thumbPickerVersion,

    folderMoveOpen,

    folderMovePayload,

    videoPropsOpen,
    videoPropsId,

    confirmDialog,

    contextMenu,

    selectedCount,

    toggleSelect,

    selectAll,

    clearSelection,

    showToast,

    showNonStandardDialog,

    resolveNonStandard,

    openAlbumPicker,

    closeAlbumPicker,
    showThumbPicker,
    closeThumbPicker,
    openFolderMove,
    closeFolderMove,

    openVideoProps,
    closeVideoProps,

    showConfirm,
    resolveConfirm,

    showContextMenu,

    hideContextMenu,

  }

})

