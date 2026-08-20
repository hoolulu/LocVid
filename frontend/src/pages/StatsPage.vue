<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import CategorySidebar from '@/components/layout/CategorySidebar.vue'
import { getStats } from '@/api'
import { t } from '@/i18n'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { formatDuration, formatSize } from '@/utils/format'
import type { StatsResponse } from '@/types'

const library = useLibraryStore()
const settings = useSettingsStore()
const stats = ref<StatsResponse | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  if (!library.activeLibraryId) await library.loadLibraries()
  await load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await getStats()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function maxCategoryCount() {
  if (!stats.value?.categories.length) return 1
  return Math.max(1, ...stats.value.categories.map((c) => c.count))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'classic'" />
      <main class="min-h-0 flex-1 overflow-y-auto p-6">
        <div class="mb-5 flex shrink-0 items-center gap-3">
          <h2 class="text-lg font-medium">{{ t('stats.title') }}</h2>
          <span class="text-sm text-[var(--lg-text-muted)]">{{ t('stats.subtitle') }}</span>
        </div>

        <div v-if="loading" class="text-sm text-[var(--lg-text-muted)]">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="error" class="text-sm text-red-400">{{ error }}</div>

        <template v-else-if="stats">
          <!-- 总量卡片 -->
          <div class="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div class="rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] p-4">
              <div class="text-xs uppercase tracking-wider text-[var(--lg-text-muted)]">
                {{ t('stats.totalVideos') }}
              </div>
              <div class="mt-1 text-2xl font-medium">{{ stats.total_videos }}</div>
            </div>
            <div class="rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] p-4">
              <div class="text-xs uppercase tracking-wider text-[var(--lg-text-muted)]">
                {{ t('stats.totalSize') }}
              </div>
              <div class="mt-1 text-2xl font-medium">{{ formatSize(stats.total_size) }}</div>
            </div>
            <div class="rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] p-4">
              <div class="text-xs uppercase tracking-wider text-[var(--lg-text-muted)]">
                {{ t('stats.totalDuration') }}
              </div>
              <div class="mt-1 text-2xl font-medium">
                {{ stats.total_duration_sec ? formatDuration(stats.total_duration_sec) : '—' }}
              </div>
              <div v-if="stats.duration_known < stats.total_videos" class="mt-1 text-xs text-[var(--lg-text-muted)]">
                {{ t('stats.durationPartial', { known: stats.duration_known, total: stats.total_videos }) }}
              </div>
            </div>
            <div class="rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] p-4">
              <div class="text-xs uppercase tracking-wider text-[var(--lg-text-muted)]">
                {{ t('stats.favorites') }}
              </div>
              <div class="mt-1 text-2xl font-medium">{{ stats.favorites_count }}</div>
            </div>
          </div>

          <div class="grid gap-6 lg:grid-cols-2">
            <!-- 分类分布 -->
            <section class="rounded-lg border border-[var(--lg-border)] p-4">
              <h3 class="mb-3 text-sm font-medium">{{ t('stats.categories') }}</h3>
              <div v-if="!stats.categories.length" class="text-sm text-[var(--lg-text-muted)]">
                {{ t('stats.empty') }}
              </div>
              <div v-else class="space-y-2">
                <div v-for="cat in stats.categories" :key="cat.name" class="flex items-center gap-3">
                  <span class="w-40 shrink-0 truncate text-sm" :title="cat.name">{{ cat.name }}</span>
                  <div class="h-2 flex-1 overflow-hidden rounded bg-[var(--lg-bg-secondary)]">
                    <div
                      class="h-full rounded bg-[var(--lg-accent)]"
                      :style="{ width: `${(cat.count / maxCategoryCount()) * 100}%` }"
                    />
                  </div>
                  <span class="w-12 shrink-0 text-right text-xs text-[var(--lg-text-muted)]">{{ cat.count }}</span>
                </div>
              </div>
            </section>

            <!-- 播放 Top -->
            <section class="rounded-lg border border-[var(--lg-border)] p-4">
              <h3 class="mb-3 text-sm font-medium">{{ t('stats.topPlayed') }}</h3>
              <div v-if="!stats.top_played.length" class="text-sm text-[var(--lg-text-muted)]">
                {{ t('stats.empty') }}
              </div>
              <ol v-else class="space-y-1">
                <li
                  v-for="(item, i) in stats.top_played"
                  :key="item.id"
                  class="flex items-center gap-3 text-sm"
                >
                  <span class="w-5 shrink-0 text-right text-xs text-[var(--lg-text-muted)]">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate" :title="item.title">{{ item.title }}</span>
                  <span class="shrink-0 text-xs text-[var(--lg-text-muted)]">
                    {{ t('stats.playCount', { n: item.play_count }) }}
                  </span>
                </li>
              </ol>
            </section>
          </div>

          <!-- 标签分布 -->
          <section class="mt-6 rounded-lg border border-[var(--lg-border)] p-4">
            <h3 class="mb-3 text-sm font-medium">{{ t('stats.tags') }}</h3>
            <div v-if="!stats.tags.length" class="text-sm text-[var(--lg-text-muted)]">
              {{ t('stats.empty') }}
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <span
                v-for="tagInfo in stats.tags"
                :key="tagInfo.tag"
                class="rounded-full border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-3 py-1 text-xs"
              >
                {{ tagInfo.tag }}
                <span class="ml-1 text-[var(--lg-text-muted)]">{{ tagInfo.count }}</span>
              </span>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>
