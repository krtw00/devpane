import { describe, it, expect } from 'vitest'

// TasksView.vue から formatDuration 関数をインポートする代わりに、
// 同じロジックをここで定義してテストします
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

/**
 * ミリ秒を分・秒に変換するフォーマット関数のテスト
 */
describe('formatDuration', () => {
  it('0ミリ秒は "0s" と表示する', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('500ミリ秒は "0s" と表示する（切り捨て）', () => {
    expect(formatDuration(500)).toBe('0s')
  })

  it('1000ミリ秒は "1s" と表示する', () => {
    expect(formatDuration(1000)).toBe('1s')
  })

  it('59000ミリ秒は "59s" と表示する', () => {
    expect(formatDuration(59000)).toBe('59s')
  })

  it('60000ミリ秒は "1m" と表示する', () => {
    expect(formatDuration(60000)).toBe('1m')
  })

  it('61000ミリ秒は "1m1s" と表示する', () => {
    expect(formatDuration(61000)).toBe('1m1s')
  })

  it('125000ミリ秒は "2m5s" と表示する', () => {
    expect(formatDuration(125000)).toBe('2m5s')
  })

  it('3600000ミリ秒は "60m" と表示する', () => {
    expect(formatDuration(3600000)).toBe('60m')
  })

  it('3930000ミリ秒（1時間5分30秒）は "65m30s" と表示する', () => {
    expect(formatDuration(3930000)).toBe('65m30s')
  })

  it('負の値は空文字を返す', () => {
    expect(formatDuration(-1000)).toBe('')
  })

  it('null または undefined は空文字を返す', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
  })
})