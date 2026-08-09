<script setup lang="ts">

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { VueDraggable } from 'vue-draggable-plus'

import FolderTreeNode from './FolderTreeNode.vue'

import { deleteFolder, renameFolder, reorderCategories, reorderFolders, setCategorySortMode } from '@/api/files'

import { t } from '@/i18n'

import { useGalleryStore } from '@/stores/gallery'
import { useBrowseNavigation } from '@/composables/useBrowseNavigation'
import { useUiStore } from '@/stores/ui'



const gallery = useGalleryStore()

const ui = useUiStore()
const { selectCategory, selectFolder } = useBrowseNavigation()



const totalCount = computed(() => gallery.categories.reduce((s, c) => s + c.count, 0))

// ── 分类/文件夹搜索过滤 ──
const sidebarQuery = ref('')

const filteredCategories = computed(() => {
  const q = sidebarQuery.value.trim().toLowerCase()
  if (!q) return gallery.categories
  return gallery.categories.filter((c) => c.name.toLowerCase().includes(q))
})

// 输入搜索时自动展开匹配分类并加载其文件夹树（否则树数据未加载，子文件夹无法参与过滤）
watch(sidebarQuery, (q) => {
  const query = q.trim().toLowerCase()
  if (!query) return
  for (const cat of gallery.categories) {
    if (cat.name.toLowerCase().includes(query)) {
      gallery.expandedCategories.add(cat.name)
      if (cat.has_subfolders) void gallery.loadFolderTree(cat.name)
    }
  }
})



const sortOptions = computed(() => [

  { value: 'custom', label: t('other.custom') },

  { value: 'name_asc', label: t('other.nameAsc') },

  { value: 'name_desc', label: t('other.nameDesc') },

  { value: 'count_desc', label: t('other.countDesc') },

  { value: 'count_asc', label: t('other.countAsc') },

])



async function onCategoryClick(cat: { name: string; has_subfolders?: boolean }) {
  if (cat.has_subfolders) {
    gallery.toggleCategoryExpanded(cat.name)
    if (gallery.expandedCategories.has(cat.name)) {
      await gallery.loadFolderTree(cat.name)
    }
  }
  await selectCategory(cat.name)
}



function folderTree(cat: string) {

  return gallery.folderTrees[cat]?.folders || []

}



async function onSortModeChange(e: Event) {

  const mode = (e.target as HTMLSelectElement).value

  await setCategorySortMode(mode)

  gallery.categorySortMode = mode

  await gallery.loadCategories()

}



// ── 分类拖拽排序（vue-draggable-plus/Sortable）：handle 把手触发，仅 custom 模式可用 ──
async function onCategoryDragEnd() {
  const order = gallery.categories.map((c) => c.name)
  await reorderCategories(order)
  await gallery.loadCategories()
}

// ── 文件夹拖拽排序：FolderTreeNode 各层/分类根层提交该层路径顺序 ──
async function onFolderReorder(category: string, parent: string, paths: string[]) {
  if (!paths.length) return
  await reorderFolders(category, { [parent]: paths })
  gallery.clearFolderCaches()
  if (gallery.category) await gallery.loadFolderTree(gallery.category)
}

function onRootFolderDragEnd(category: string, roots: { path: string }[]) {
  if (roots.length > 1) void onFolderReorder(category, '', roots.map((n) => n.path))
}



function onFolderContext(e: MouseEvent, category: string, path: string) {
  e.stopPropagation()
  ui.showContextMenu(
    e,
    [
      { label: t('menu.open'), action: 'folder-open' },
      { label: t('menu.rename'), action: 'folder-rename' },
      { label: t('menu.move'), action: 'folder-move' },
      { label: t('menu.delete'), action: 'folder-delete', danger: true },
    ],
    { targetType: 'folder', payload: { category, path, folderType: 'subdir' } },
  )
}

function onCategoryContext(e: MouseEvent, catName: string) {
  e.stopPropagation()
  ui.showContextMenu(
    e,
    [
      { label: t('menu.rename'), action: 'folder-rename' },
      { label: t('menu.move'), action: 'folder-move' },
      { label: t('menu.delete'), action: 'folder-delete', danger: true },
    ],
    { targetType: 'folder', payload: { category: catName, path: catName, folderType: 'cat' } },
  )
}



async function onContextAction(ev: Event) {

  const detail = (ev as CustomEvent).detail as {
    action: string
    targetType?: string
    payload?: { category?: string; path?: string; folderType?: 'subdir' | 'cat' }
  }

  if (detail.targetType !== 'folder' || !detail.payload?.category || !detail.payload.path) return

  const { category, path, folderType = 'subdir' } = detail.payload

  if (detail.action === 'folder-open') {
    if (folderType !== 'subdir') return
    await selectFolder(category, path)

  } else if (detail.action === 'folder-rename') {

    const newName = prompt(t('folder.renamePrompt'), path.split('/').pop() || '')

    if (newName) {

      await renameFolder(category, path, newName, folderType)

      gallery.clearFolderCaches()

      await gallery.loadCategories()

      if (gallery.category) await gallery.loadFolderTree(gallery.category)

      await gallery.loadVideos()

      ui.showToast(t('menu.renamed'))

    }

  } else if (detail.action === 'folder-move') {
    ui.openFolderMove({ mode: 'folder', category, path, folderType })
  } else if (detail.action === 'folder-delete') {

    const ok = await ui.showConfirm(t('other.folderDeleteConfirm'), t('other.folderDeleteTitle', { path }))
    if (!ok) return

    await deleteFolder(category, path, folderType)

    gallery.clearFolderCaches()

    if (gallery.folder === path) gallery.setFolder(null)

    await gallery.loadCategories()

    await gallery.loadVideos()

    ui.showToast(t('other.folderDeleted'))

  }

}



onMounted(() => {

  document.addEventListener('lg-context-action', onContextAction)

})



onUnmounted(() => {

  document.removeEventListener('lg-context-action', onContextAction)

})

</script>



<template>

  <aside class="browse-sidebar flex w-60 shrink-0 flex-col border-r border-[var(--lg-border)] bg-[var(--lg-bg-sidebar)]">

    <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-3 py-2">

      <span class="text-sm font-medium">{{ t('sidebar.title') }}</span>

      <select

        class="rounded border border-[var(--lg-border)] bg-transparent px-1 py-0.5 text-[10px]"

        :value="gallery.categorySortMode"

        @change="onSortModeChange"

      >

        <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>

      </select>

    </div>

    <div class="border-b border-[var(--lg-border)] px-2 py-1.5">

      <input

        v-model="sidebarQuery"

        type="search"

        :placeholder="t('sidebar.filterPlaceholder')"

        class="w-full rounded border border-[var(--lg-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--lg-accent)]"

      />

    </div>

      <!-- @vue-ignore -->
      <VueDraggable
        :list="gallery.categories"
        :handle="'.cat-drag-handle'"
        :disabled="gallery.categorySortMode !== 'custom' || !!sidebarQuery.trim()"
        :animation="150"
        ghost-class="cat-drag-ghost"
        class="min-h-0 flex-1 overflow-y-auto p-2"
        data-testid="category-list"
        @end="onCategoryDragEnd"
      >

        <button

          class="mb-1 flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm transition lg-hover"
          :class="{ 'lg-active': !gallery.category }"

          @click="selectCategory(null)"

        >

          <span>{{ t('common.all') }}</span>

          <span class="text-xs text-[var(--lg-text-muted)]">{{ totalCount }}</span>

        </button>



        <div

          v-for="cat in filteredCategories"

          :key="cat.name"

          class="mb-1"

        >

        <button

          data-testid="category-item"

          class="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm transition lg-hover"
          :class="{ 'lg-active': gallery.category === cat.name && !gallery.folder }"

          @click="onCategoryClick(cat)"
          @contextmenu.prevent="onCategoryContext($event, cat.name)"

        >

          <span class="flex min-w-0 items-center gap-1">

            <span

              v-if="cat.has_subfolders"

              class="inline-block w-3 text-[10px] transition"

              :class="{ 'rotate-90': gallery.expandedCategories.has(cat.name) }"

            >▶</span>
            <span v-else class="w-3" />

            <span
              v-if="!sidebarQuery.trim()"
              class="px-0.5 text-[10px] text-[var(--lg-text-muted)]"
              :class="{ 'cat-drag-handle cursor-grab': gallery.categorySortMode === 'custom' }"
            >⠿</span>
            <span v-else class="w-3" />

            <span class="truncate">{{ cat.name }}</span>

          </span>

          <span class="ml-2 text-xs text-[var(--lg-text-muted)]">{{ cat.count }}</span>

        </button>



        <div

          v-if="cat.has_subfolders && gallery.expandedCategories.has(cat.name) && folderTree(cat.name).length"

          class="ml-2 border-l border-[var(--lg-border)] pl-1"

        >

          <!-- @vue-ignore -->
          <VueDraggable
            :list="folderTree(cat.name)"
            :handle="'.folder-drag-handle'"
            :disabled="!!sidebarQuery.trim()"
            :animation="150"
            ghost-class="folder-drag-ghost"
            @end="onRootFolderDragEnd(cat.name, folderTree(cat.name))"
          >
            <FolderTreeNode

              v-for="node in folderTree(cat.name)"

              :key="node.path"

              :node="node"

              :category="cat.name"

              :depth="0"

              :filter-query="sidebarQuery.trim()"

              @select="selectFolder"

              @contextmenu="onFolderContext"

              @reorder="onFolderReorder"

            />
          </VueDraggable>

        </div>

      </div>

    </VueDraggable>

  </aside>

</template>

