import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// formatDuration 関数のテスト（TasksView.vue に実装されているものと同じロジック）
function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return '0s'
  
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  
  if (minutes === 0) {
    return `${seconds}s`
  } else if (seconds === 0) {
    return `${minutes}m`
  } else {
    return `${minutes}m${seconds}s`
  }
}

describe('TasksView - 実行時間表示', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formatDurationメソッドがミリ秒を分・秒に正しく変換する', () => {
    // Test formatDuration method
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(500)).toBe('0s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(59000)).toBe('59s')
    expect(formatDuration(60000)).toBe('1m')
    expect(formatDuration(61000)).toBe('1m1s')
    expect(formatDuration(125000)).toBe('2m5s')
    expect(formatDuration(3600000)).toBe('60m')
    expect(formatDuration(3930000)).toBe('65m30s')
  })

  it('formatDurationメソッドが異常値を正しく処理する', () => {
    expect(formatDuration(-1000)).toBe('')
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
  })

  it('様々な実行時間が正しくフォーマットされる', () => {
    // Test various durations
    expect(formatDuration(30000)).toBe('30s') // 30秒
    expect(formatDuration(180000)).toBe('3m') // 3分
    expect(formatDuration(90000)).toBe('1m30s') // 1分30秒
    expect(formatDuration(135000)).toBe('2m15s') // 2分15秒
  })
})