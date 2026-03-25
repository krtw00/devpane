import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TaskDetail.vue の実行時間表示を検証する。
 * TDD: 実装前はFAILする。
 */
describe('TaskDetail execution time display', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TaskDetail.vue'),
    'utf-8',
  )

  it('facts-grid に Execution time: の表示が追加されている', () => {
    // テンプレート全体に Execution time: が含まれていることを確認
    expect(template).toContain('Execution time:')
  })

  it('execution_time_ms が存在する場合は X ms 形式で表示する', () => {
    // execution_time_ms の条件付き表示を確認
    // 期待されるパターン: {{ facts.execution_time_ms }} ms または類似の形式
    expect(template).toMatch(/execution_time_ms/)
    expect(template).toMatch(/ms/)
  })

  it('execution_time_ms が存在しない場合は N/A と表示する', () => {
    // N/A の表示があることを確認
    expect(template).toContain('N/A')
  })

  it('既存の facts 表示を壊さない', () => {
    // 既存の facts 表示がすべて含まれていることを確認
    expect(template).toContain('exit:')
    expect(template).toContain('files:')
    expect(template).toContain('tests:')
    expect(template).toContain('branch:')
    expect(template).toContain('commit:')
  })

  it('実行時間表示は facts-grid 内に配置されている', () => {
    // 正規表現で facts-grid の内容を抽出（複数のdivを含む）
    const factsGridMatch = template.match(/<div class="facts-grid">([\s\S]*?)<\/div>\s*<div v-if="facts\.diff_stats"/)
    expect(factsGridMatch).toBeTruthy()
    
    if (factsGridMatch) {
      const factsGridContent = factsGridMatch[0]
      // facts-grid 内に Execution time: が含まれていることを確認
      expect(factsGridContent).toContain('Execution time:')
    }
  })

  it('実行時間表示のフォーマットが正しい', () => {
    // 実行時間表示のテンプレート部分を確認
    expect(template).toContain('{{ facts.execution_time_ms !== undefined ? facts.execution_time_ms + \' ms\' : \'N/A\' }}')
  })
})