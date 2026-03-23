import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TasksView.vue の実行時間表示の条件付きレンダリングテスト
 * TDD: 実装前はFAILする。
 */
describe('TasksView execution time conditional rendering', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('実行時間が計算可能な場合（started_atとfinished_atがある場合）に「X分Y秒」形式で表示される', () => {
    // テンプレート内で formatExecutionTime 関数が呼び出されていることを確認
    const hasFormatExecutionTimeCall = template.includes('formatExecutionTime(task)')
    
    expect(hasFormatExecutionTimeCall).toBe(true)
    
    // 実行時間表示用の要素が存在することを確認
    const hasExecutionTimeElement = template.includes('execution-time')
    
    expect(hasExecutionTimeElement).toBe(true)
  })

  it('実行時間が計算不可能な場合（started_atまたはfinished_atがない場合）に「-」を表示する', () => {
    const scriptContent = template.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    
    // formatExecutionTime 関数内で「-」を返す条件分岐があることを確認
    const hasDashReturn = 
      scriptContent.includes('return \'-\'') ||
      scriptContent.includes('return "-"') ||
      (scriptContent.includes('!task.started_at') && scriptContent.includes('!task.finished_at'))
    
    expect(hasDashReturn).toBe(true)
  })
})