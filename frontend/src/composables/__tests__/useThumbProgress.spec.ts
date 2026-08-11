import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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
import {
  useThumbProgress,
  refresh,
  lastCompleted,
  incomingFlash,
  notifyIncoming,
} from '@/composables/useThumbProgress'

const mockThumb = vi.mocked(getThumbStatus)
const mockDuration = vi.mocked(getDurationStatus)
const mockRemux = vi.mocked(getGlobalRemuxStatus)

const idleThumb = {
  total: 3, ready: 3, missing: 0, generating: 0, queue_size: 0,
  failed: 0, paused: false, idle_scan: false,
}
const idleDuration = { remaining: 0, queued: 0, probing: 0, pending: 0, cached: 3 }
const idleRemux = { active: false, running: [], queued: 0 }

beforeEach(async () => {
  setActivePinia(createPinia())
  // 重置跨测试共享的模块级完成状态：prevAnyBusy 归 false、清掉残留的完成闪示与轮询 timer
  mockThumb.mockReset().mockResolvedValue(idleThumb)
  mockDuration.mockReset().mockResolvedValue(idleDuration)
  mockRemux.mockReset().mockResolvedValue(idleRemux)
  await refresh()
  lastCompleted.value = null
  // 清掉 beforeEach 自身的调用计数，避免干扰各测试的 toHaveBeenCalledTimes 断言
  mockThumb.mockClear()
  mockDuration.mockClear()
  mockRemux.mockClear()
})

describe('useThumbProgress', () => {
  it('refresh 一次性拉取三个状态端点并落库', async () => {
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    expect(mockThumb).toHaveBeenCalledTimes(1)
    expect(mockDuration).toHaveBeenCalledTimes(1)
    expect(mockRemux).toHaveBeenCalledTimes(1)
    // 全部空闲：不触发完成闪示（prevAnyBusy=false）
    expect(lastCompleted.value).toBeNull()
  })

  it('忙碌时自维持 1.5s 轮询；空闲后自动停止', async () => {
    vi.useFakeTimers()
    // 第一轮：缩略图生成中 → busy → 应安排轮询
    mockThumb.mockResolvedValue({ ...idleThumb, ready: 1, generating: 2 })
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    expect(mockThumb).toHaveBeenCalledTimes(1)
    // 推进 1.5s：轮询自动触发下一次 refresh
    await vi.advanceTimersByTimeAsync(1500)
    expect(mockThumb).toHaveBeenCalledTimes(2)
    // 变空闲：轮询停止（推进再久也不再调用）
    mockThumb.mockResolvedValue(idleThumb)
    await refresh()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockThumb).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('failed>0 / paused 不再视为忙碌（否则任务条被钉死、完成闪示永不触发）', async () => {
    vi.useFakeTimers()
    mockThumb.mockResolvedValue({
      ...idleThumb, ready: 3, generating: 0, queue_size: 0,
      failed: 2, paused: true,
    })
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    // 无忙碌任务 → 不安排轮询（推进 3s 无新调用）
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockThumb).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('steps：repair 阶段时「修复」为当前步、其余 pending', async () => {
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue({
      active: true,
      running: [{ library_id: 'l', video_id: 'v', progress_pct: 50, title: 'x' }],
      queued: 0,
    })
    await refresh()
    const tp = useThumbProgress()
    expect(tp.stage.value).toBe('repair')
    expect(tp.steps.value.map((s) => s.state)).toEqual(['current', 'pending', 'pending'])
    expect(tp.remuxBusy.value).toBe(true)
  })

  it('steps：duration 阶段时「修复、缩略图」已完成、「时长」进行中', async () => {
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue({ ...idleDuration, remaining: 5, probing: 1, cached: 1 })
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    const tp = useThumbProgress()
    expect(tp.stage.value).toBe('duration')
    expect(tp.steps.value.map((s) => s.state)).toEqual(['done', 'done', 'current'])
  })

  it('steps：全空闲时三步骤均视为完成', async () => {
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    const tp = useThumbProgress()
    expect(tp.stage.value).toBe('idle')
    expect(tp.steps.value.map((s) => s.state)).toEqual(['done', 'done', 'done'])
  })

  it('detectCompletion：忙碌 → 全空闲 记录完成闪示，5s 后自动清除', async () => {
    vi.useFakeTimers()
    // 忙碌（时长剩余 1 个）
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue({ ...idleDuration, remaining: 1, probing: 1 })
    mockRemux.mockResolvedValue(idleRemux)
    await refresh()
    expect(lastCompleted.value).toBeNull()
    // 全部完成
    mockDuration.mockResolvedValue(idleDuration)
    await refresh()
    expect(lastCompleted.value).not.toBeNull()
    // 5s 后清除
    await vi.advanceTimersByTimeAsync(5000)
    expect(lastCompleted.value).toBeNull()
    vi.useRealTimers()
  })

  it('notifyIncoming 触发 5s 「新影片」闪示', () => {
    vi.useFakeTimers()
    notifyIncoming()
    expect(incomingFlash.value).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(incomingFlash.value).toBe(false)
    vi.useRealTimers()
  })

  it('stagePercent：repair 阶段取 remux 进度百分比', async () => {
    mockThumb.mockResolvedValue(idleThumb)
    mockDuration.mockResolvedValue(idleDuration)
    mockRemux.mockResolvedValue({
      active: true,
      running: [{ library_id: 'l', video_id: 'v', progress_pct: 42.5, title: 'x' }],
      queued: 0,
    })
    await refresh()
    const tp = useThumbProgress()
    expect(tp.stagePercent.value).toBeCloseTo(42.5)
  })
})
