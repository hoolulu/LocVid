import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HeaderProgressBar from '@/components/layout/HeaderProgressBar.vue'
import { refresh, notifyIncoming, lastCompleted, incomingFlash } from '@/composables/useThumbProgress'
import { setLocale } from '@/i18n'

vi.mock('@/api/thumbs', () => ({
  getThumbStatus: vi.fn(),
  getDurationStatus: vi.fn(),
  getGlobalRemuxStatus: vi.fn(),
  pauseThumbs: vi.fn(),
  resumeThumbs: vi.fn(),
}))

import {
  getThumbStatus,
  getDurationStatus,
  getGlobalRemuxStatus,
} from '@/api/thumbs'

const mockThumb = vi.mocked(getThumbStatus)
const mockDuration = vi.mocked(getDurationStatus)
const mockRemux = vi.mocked(getGlobalRemuxStatus)

const idleThumb = {
  total: 3, ready: 3, missing: 0, generating: 0, queue_size: 0,
  failed: 0, paused: false, idle_scan: false, percent: 100,
}
const idleDuration = { remaining: 0, queued: 0, probing: 0, pending: 0, cached: 3 }
const idleRemux = { active: false, running: [], queued: 0 }

// 缩略图处理中：4/7 ready、3 生成中、队列 3
const busyThumb = {
  total: 7, ready: 4, missing: 0, generating: 3, queue_size: 3,
  failed: 0, paused: false, idle_scan: false, percent: 57.1,
}

async function mountWith(api: { thumb?: unknown; duration?: unknown; remux?: unknown }) {
  mockThumb.mockResolvedValue(api.thumb ?? idleThumb)
  mockDuration.mockResolvedValue(api.duration ?? idleDuration)
  mockRemux.mockResolvedValue(api.remux ?? idleRemux)
  const wrapper = mount(HeaderProgressBar, { attachTo: document.body })
  await refresh()
  await flushPromises()
  return wrapper
}

beforeEach(async () => {
  setActivePinia(createPinia())
  setLocale('zh')
  mockThumb.mockReset()
  mockDuration.mockReset()
  mockRemux.mockReset()
  // 重置跨测试共享的模块级完成状态（prevAnyBusy / lastCompleted / incomingFlash / 轮询 timer）
  mockThumb.mockResolvedValue(idleThumb)
  mockDuration.mockResolvedValue(idleDuration)
  mockRemux.mockResolvedValue(idleRemux)
  await refresh()
  lastCompleted.value = null
  incomingFlash.value = false
  document.body.innerHTML = ''
})

describe('HeaderProgressBar', () => {
  it('全空闲：任务条收起（collapsed），主条不渲染', async () => {
    const wrapper = await mountWith({})
    expect(wrapper.find('.progress-bar-collapsed').exists()).toBe(true)
    expect(wrapper.find('.task-pipeline').exists()).toBe(false)
  })

  it('缩略图处理中：单行渲染 stepper + 文本 + 进度条 + 百分比 + 操作', async () => {
    const wrapper = await mountWith({ thumb: busyThumb })
    const bar = wrapper.find('.task-pipeline')
    expect(bar.exists()).toBe(true)
    // 单行容器内同时包含：步骤 stepper、阶段文本、进度轨道、百分比、操作区
    expect(bar.find('.task-steps').exists()).toBe(true)
    expect(bar.find('.task-pipeline-text').exists()).toBe(true)
    expect(bar.find('.task-pipeline-track').exists()).toBe(true)
    expect(bar.find('.task-pct').exists()).toBe(true)
    expect(bar.find('.task-pipeline-actions').exists()).toBe(true)
    // 步骤 stepper：修复✓ / 缩略图（当前）/ 时长
    const steps = bar.find('.task-steps').text()
    expect(steps).toContain('修复')
    expect(steps).toContain('缩略图')
    expect(steps).toContain('时长')
    // 阶段文本与百分比
    expect(bar.text()).toContain('全库 4/7')
    expect(bar.find('.task-pct').text()).toBe('57%')
    // 操作：暂停 + 关闭
    expect(bar.text()).toContain('暂停')
    expect(bar.find('.progress-btn--close').exists()).toBe(true)
  })

  it('修复阶段：步骤当前为「修复」、文本含百分比', async () => {
    const wrapper = await mountWith({
      thumb: idleThumb,
      remux: {
        active: true,
        running: [{ library_id: 'l', video_id: 'v', progress_pct: 42, title: 'HMN-531' }],
        queued: 0,
      },
    })
    const bar = wrapper.find('.task-pipeline')
    expect(bar.exists()).toBe(true)
    expect(wrapper.find('.task-track--remux').exists()).toBe(true)
    const steps = bar.find('.task-steps').text()
    expect(steps).toContain('修复')
    expect(bar.text()).toContain('修复中')
    expect(bar.find('.task-pct').text()).toBe('42%')
  })

  it('时长阶段：步骤「修复、缩略图」已✓、「时长」进行中，进度条为蓝色', async () => {
    const wrapper = await mountWith({
      thumb: idleThumb,
      duration: { ...idleDuration, remaining: 5, probing: 1, cached: 1, percent: 20 },
    })
    const bar = wrapper.find('.task-pipeline')
    expect(bar.exists()).toBe(true)
    expect(wrapper.find('.task-track--duration').exists()).toBe(true)
    const doneSteps = bar.findAll('.task-step--done')
    expect(doneSteps.length).toBe(2)
    expect(doneSteps[0].text()).toContain('修复')
    expect(doneSteps[1].text()).toContain('缩略图')
    expect(bar.find('.task-step--current').text()).toContain('时长')
  })

  it('新影片入库：行内显示「新影片」徽标（不再占第二行）', async () => {
    const wrapper = await mountWith({ thumb: busyThumb })
    notifyIncoming()
    await flushPromises()
    const badge = wrapper.find('.task-badge--incoming')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('新影片')
  })

  it('处理完成：行内显示「完成」徽标', async () => {
    mockThumb.mockResolvedValue(busyThumb)
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue(idleRemux)
    const wrapper = mount(HeaderProgressBar, { attachTo: document.body })
    await refresh()
    await flushPromises()
    // 变为全空闲 → detectCompletion 触发
    mockThumb.mockResolvedValue(idleThumb)
    await refresh()
    await flushPromises()
    const badge = wrapper.find('.task-badge--done')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('完成')
  })

  it('空闲展开：点 chip 后显示缩略图总况详情（单行文本）', async () => {
    const wrapper = await mountWith({})
    // auto 模式全空闲时 toggleBar 切换 manualExpand
    const { useThumbProgress } = await import('@/composables/useThumbProgress')
    const tp = useThumbProgress()
    tp.toggleBar()
    await flushPromises()
    expect(wrapper.find('.task-pipeline--idle').exists()).toBe(true)
    expect(wrapper.find('.task-chip').text()).toContain('缩略图')
  })
})
