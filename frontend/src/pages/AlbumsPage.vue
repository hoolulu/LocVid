<script setup lang="ts">

import { onMounted, onUnmounted, ref } from 'vue'

import { useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'

import { thumbUrl } from '@/api/client'

import { useAlbumStore } from '@/stores/album'

import { useGalleryPlay } from '@/composables/useGalleryPlay'

import { getVideos } from '@/api'

import { useGalleryStore } from '@/stores/gallery'

import { useLibraryStore } from '@/stores/library'

import { useSettingsStore } from '@/stores/settings'

import { useUiStore } from '@/stores/ui'

import CategorySidebar from '@/components/layout/CategorySidebar.vue'



const router = useRouter()

const album = useAlbumStore()

const gallery = useGalleryStore()

const library = useLibraryStore()

const ui = useUiStore()

const { onPlay } = useGalleryPlay()

const settings = useSettingsStore()



const showForm = ref(false)

const editingId = ref<string | null>(null)

const formName = ref('')

const formDesc = ref('')



onMounted(async () => {

  if (!library.activeLibraryId) await library.loadLibraries()

  // 侧栏全局显示：确保分类已加载（幂等，避免重复请求）
  if (!gallery.categories.length) await gallery.loadCategories()

  await album.loadAlbums()

  document.addEventListener('lg-context-action', onContextAction)

})



onUnmounted(() => {

  document.removeEventListener('lg-context-action', onContextAction)

})



function openCreate() {

  editingId.value = null

  formName.value = ''

  formDesc.value = ''

  showForm.value = true

}



function openEdit(a: { id: string; name: string; description?: string }) {

  editingId.value = a.id

  formName.value = a.name

  formDesc.value = a.description || ''

  showForm.value = true

}



async function saveForm() {

  if (!formName.value.trim()) return

  if (editingId.value) {

    await album.editAlbum(editingId.value, { name: formName.value.trim(), description: formDesc.value.trim() })

  } else {

    await album.addAlbum(formName.value.trim(), formDesc.value.trim())

  }

  showForm.value = false

}



function openAlbum(id: string) {

  router.push(`/albums/${id}`)

}



function onAlbumContext(e: MouseEvent, a: { id: string; name: string }) {

  ui.showContextMenu(

    e,

    [

      { label: '打开', action: 'open' },

      { label: '编辑', action: 'edit' },

      { label: '播放全部', action: 'play-all' },

      { label: '删除', action: 'delete', danger: true },

    ],

    { targetId: a.id, targetType: 'album', payload: { name: a.name } },

  )

}



async function onContextAction(ev: Event) {

  const detail = (ev as CustomEvent).detail as {

    action: string

    targetId?: string

    targetType?: string

  }

  if (detail.targetType !== 'album' || !detail.targetId) return

  const id = detail.targetId

  if (detail.action === 'open') openAlbum(id)

  else if (detail.action === 'edit') {

    const a = album.albums.find((x) => x.id === id)

    if (a) openEdit(a)

  } else if (detail.action === 'play-all') {

    // 全量播放：page_size=0 后端返回专辑全部视频，避免大专辑只播第一页前 40 个
    const data = await getVideos({ album_id: id, page_size: 0, sort: 'page' })
    if (!data.items.length) return
    gallery.viewMode = 'album-detail'

    gallery.albumId = id

    gallery.page = 1

    await gallery.loadVideos()

    router.push(`/albums/${id}`)
    await onPlay(data.items[0].id, data.items)

  } else if (detail.action === 'delete') {
    const ok = await ui.showConfirm(`确定删除专辑「${id}」？专辑内视频文件不会被删除。`, '删除专辑')
    if (ok) await album.removeAlbum(id)
  }

}

</script>



<template>

  <div class="flex h-full min-h-0 flex-col">

    <AppHeader />

    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'youtube'" />
      <main class="flex-1 overflow-y-auto p-4">

      <div class="mb-4 flex items-center justify-between">

        <h2 class="text-lg font-medium">我的专辑</h2>

        <button

          class="rounded bg-[var(--lg-accent)] px-3 py-1.5 text-sm text-[var(--lg-text-on-accent)]"

          @click="openCreate"

        >

          新建专辑

        </button>

      </div>



      <div v-if="showForm" class="mb-4 rounded border border-[var(--lg-border)] p-4">

        <input v-model="formName" placeholder="专辑名称" class="mb-2 w-full rounded border border-[var(--lg-border)] bg-transparent px-3 py-2 text-sm" />

        <textarea v-model="formDesc" placeholder="描述（可选）" class="mb-2 w-full rounded border border-[var(--lg-border)] bg-transparent px-3 py-2 text-sm" rows="2" />

        <div class="flex gap-2">

          <button class="rounded bg-[var(--lg-accent)] px-3 py-1 text-sm text-[var(--lg-text-on-accent)]" @click="saveForm">

            {{ editingId ? '保存' : '创建' }}

          </button>

          <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="showForm = false">取消</button>

        </div>

      </div>



      <div v-if="!album.albums.length" class="flex flex-col items-center justify-center gap-2 py-20 text-sm text-[var(--lg-text-muted)]">
        <span class="text-3xl opacity-60">▣</span>
        <span>还没有专辑</span>
        <span>点击右上角「新建专辑」，在视频上右键选择「加入专辑」</span>
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">

        <button

          v-for="a in album.albums"

          :key="a.id"

          class="overflow-hidden rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] text-left transition hover:ring-1 hover:ring-[var(--lg-accent)]"

          @click="openAlbum(a.id)"

          @contextmenu="onAlbumContext($event, a)"

        >

          <div class="aspect-square bg-black/30">

            <img

              v-if="a.cover_video_id"

              :src="thumbUrl(a.cover_video_id)"

              class="h-full w-full object-cover"

            />

          </div>

          <div class="p-3">

            <h3 class="truncate text-sm font-medium">{{ a.name }}</h3>

            <p class="text-xs text-[var(--lg-text-muted)]">{{ a.video_count }} 个视频</p>

          </div>

        </button>

      </div>

    </main>
    </div>

  </div>

</template>

