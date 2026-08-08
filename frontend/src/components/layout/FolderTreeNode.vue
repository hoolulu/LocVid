<script setup lang="ts">
import { computed } from 'vue'
import type { FolderNode } from '@/types'
import { VueDraggable } from 'vue-draggable-plus'
import { useGalleryStore } from '@/stores/gallery'
import FolderTreeNode from './FolderTreeNode.vue'

const props = defineProps<{
  node: FolderNode
  category: string
  depth: number
  filterQuery?: string
}>()

const emit = defineEmits<{
  select: [category: string, path: string]
  contextmenu: [event: MouseEvent, category: string, path: string]
  reorder: [category: string, parent: string, paths: string[]]
}>()

const gallery = useGalleryStore()

function onSelect(category: string, path: string) {
  emit('select', category, path)
}

// 本层拖拽排序结束：提交该层（parent=本节点路径）子文件夹的新顺序
function onDragEnd() {
  const children = props.node.children
  if (!children || children.length < 2) return
  emit('reorder', props.category, props.node.path, children.map((c) => c.path))
}

// ── 搜索过滤：节点名匹配 或 子树内任意节点匹配 → 显示；过滤时强制展开子树 ──
function subtreeMatches(n: FolderNode, q: string): boolean {
  if (n.name.toLowerCase().includes(q)) return true
  return (n.children || []).some((c) => subtreeMatches(c, q))
}

const filterActive = computed(() => !!props.filterQuery?.trim())
const query = computed(() => props.filterQuery?.trim().toLowerCase() || '')

const visible = computed(() => {
  if (!filterActive.value) return true
  return subtreeMatches(props.node, query.value)
})

const showChildren = computed(() => {
  const has = (props.node.children?.length ?? 0) > 0
  if (!has) return false
  if (filterActive.value) return visible.value
  return gallery.expandedFolders.has(props.node.path)
})
</script>

<template>
  <div v-if="visible">
    <button
      class="flex w-full items-center gap-1 rounded py-1.5 text-left text-xs transition lg-hover"
      :class="{ 'lg-active': gallery.folder === node.path }"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      @click="onSelect(category, node.path)"
      @contextmenu.prevent="emit('contextmenu', $event, category, node.path)"
    >
      <span
        v-if="node.children?.length"
        class="inline-block w-3 text-[10px] transition"
        :class="{ 'rotate-90': showChildren }"
        @click.stop="gallery.toggleFolderExpanded(node.path)"
      >▶</span>
      <span v-else class="w-3" />
      <span v-if="!filterActive" class="folder-drag-handle cursor-grab px-0.5 text-[10px] text-[var(--lg-text-muted)]">⠿</span>
      <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
      <span class="text-[var(--lg-text-muted)]">{{ node.total }}</span>
    </button>
    <VueDraggable
      v-if="showChildren"
      :list="node.children"
      :handle="'.folder-drag-handle'"
      :disabled="filterActive"
      animation="150"
      ghost-class="folder-drag-ghost"
      @end="onDragEnd"
    >
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :category="category"
        :depth="depth + 1"
        :filter-query="filterQuery"
        @select="onSelect"
        @contextmenu="(e, c, p) => emit('contextmenu', e, c, p)"
        @reorder="(c, p, paths) => emit('reorder', c, p, paths)"
      />
    </VueDraggable>
  </div>
</template>
