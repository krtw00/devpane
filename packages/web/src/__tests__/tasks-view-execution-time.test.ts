import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TasksView.vue の実行時間表示機能を検証するテスト
 * TDD: 実装前はFAILする。
 */
describe('TasksView execution time display', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('実行時間を計算する computed プロパティが存在する', () => {
    // computed プロパティとして executionTime または formatExecutionTime が定義されていることを確認
    const scriptContent = template.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    
    // 実行時間を計算する関数またはcomputedプロパティの定義を確認
    // 例: formatExecutionTime, executionTime, calculateDuration など
    const hasExecutionTimeFunction = 
      scriptContent.includes('formatExecutionTime') ||
      scriptContent.includes('executionTime') ||
      scriptContent.includes('calculateDuration') ||
      scriptContent.includes('executionDuration')
    
    expect(hasExecutionTimeFunction).toBe(true)
  })

  it('実行時間が「X分Y秒」形式で表示される列が存在する', () => {
    // テンプレート内に実行時間を表示する要素があることを確認
    // 例: <span class="execution-time">, <td class="execution-time"> など
    const hasExecutionTimeColumn = 
      template.includes('execution-time') ||
      template.includes('executionTime') ||
      template.includes('実行時間') ||
      template.includes('duration')
    
    expect(hasExecutionTimeColumn).toBe(true)
  })

  it('実行時間列が右揃えのスタイルを持つ', () => {
    // CSS内に実行時間列の右揃えスタイルがあることを確認
    const styleContent = template.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || ''
    
    const hasRightAlignStyle = 
      styleContent.includes('.execution-time') && 
      (styleContent.includes('text-align: right') || 
       styleContent.includes('text-align:right') ||
       styleContent.includes('justify-content: flex-end'))
    
    expect(hasRightAlignStyle).toBe(true)
  })

  it('データがない場合は「-」を表示するロジックが存在する', () => {
    const scriptContent = template.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    
    // 「-」を表示する条件分岐があることを確認
    const hasDashFallback = 
      scriptContent.includes('"-"') ||
      scriptContent.includes("'-'") ||
      scriptContent.includes('finished_at') && scriptContent.includes('started_at') && 
      (scriptContent.includes('||') || scriptContent.includes('??') || scriptContent.includes('if'))
    
    expect(hasDashFallback).toBe(true)
  })

  it('finished_at と started_at の差分を計算するロジックが存在する', () => {
    const scriptContent = template.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    
    // finished_at と started_at の差分計算があることを確認
    const hasDurationCalculation = 
      (scriptContent.includes('finished_at') && scriptContent.includes('started_at')) &&
      (scriptContent.includes('getTime()') || 
       scriptContent.includes('Date') ||
       scriptContent.includes('diff') ||
       scriptContent.includes('duration'))
    
    expect(hasDurationCalculation).toBe(true)
  })
})