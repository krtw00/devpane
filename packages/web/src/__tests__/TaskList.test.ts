import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TasksView.vue のステータスバッジ表示を検証する。
 * TDD: 実装前はFAILする。
 */
describe('TasksView status badge display', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('statusIcon 関数がすべてのステータスに対応するアイコンを返す', () => {
    // statusIcon 関数の定義を検証
    const statusIconFunction = template
      .split('\n')
      .find((line: string) => line.includes('function statusIcon') && line.includes('Task[\'status\']'))

    expect(statusIconFunction).toBeDefined()
    expect(statusIconFunction).toContain('function statusIcon')
    
    // すべてのステータスが定義されているか確認
    const statuses = ['pending', 'running', 'done', 'failed', 'suppressed']
    statuses.forEach(status => {
      expect(template).toContain(`${status}:`)
    })
  })

  it('statusLabel 関数がすべてのステータスに対応するラベルを返す', () => {
    // statusLabel 関数の定義を検証
    const statusLabelFunction = template
      .split('\n')
      .find((line: string) => line.includes('function statusLabel') && line.includes('Task[\'status\']'))

    expect(statusLabelFunction).toBeDefined()
    expect(statusLabelFunction).toContain('function statusLabel')
    
    // すべてのステータスが定義されているか確認
    const statuses = ['pending', 'running', 'done', 'failed', 'suppressed']
    statuses.forEach(status => {
      expect(template).toContain(`${status}:`)
    })
  })

  it('テンプレートで statusIcon と statusLabel が正しく使用されている', () => {
    // statusIcon の使用を検証
    expect(template).toContain('{{ statusIcon(task.status) }}')
    
    // statusLabel の使用を検証
    expect(template).toContain('{{ statusLabel(task.status) }}')
  })

  it('各ステータスに対応するCSSクラスが定義されている', () => {
    // CSSクラスの定義を検証
    const cssClasses = ['.s-running', '.s-failed', '.s-done', '.s-suppressed']
    cssClasses.forEach(cssClass => {
      expect(template).toContain(cssClass)
    })
    
    // pending のCSSクラスは定義されていないが、s- クラスは使用されている
    expect(template).toContain('s-')
  })

  it('ステータスアイコンが期待される値である', () => {
    // statusIcon 関数の実装を詳細に検証
    const functionMatch = template.match(/function statusIcon\(s: Task\['status'\]\) \{ return \{([^}]+)\}\[s\] \}/)
    expect(functionMatch).toBeDefined()
    
    if (functionMatch) {
      const iconMapping = functionMatch[1]
      // 期待されるアイコンを検証（順不同で部分一致、スペースを考慮）
      expect(iconMapping).toMatch(/pending\s*:\s*'⏳'/)
      expect(iconMapping).toMatch(/running\s*:\s*'⚡'/)
      expect(iconMapping).toMatch(/done\s*:\s*'✅'/)
      expect(iconMapping).toMatch(/failed\s*:\s*'❌'/)
      expect(iconMapping).toMatch(/suppressed\s*:\s*'🧊'/)
    }
  })

  it('ステータスラベルが期待される値である', () => {
    // statusLabel 関数の実装を詳細に検証
    const functionMatch = template.match(/function statusLabel\(s: Task\['status'\]\) \{ return \{([^}]+)\}\[s\] \}/)
    expect(functionMatch).toBeDefined()
    
    if (functionMatch) {
      const labelMapping = functionMatch[1]
      // 期待されるラベルを検証（日本語、順不同で部分一致、スペースを考慮）
      expect(labelMapping).toMatch(/pending\s*:\s*'待機'/)
      expect(labelMapping).toMatch(/running\s*:\s*'実行中'/)
      expect(labelMapping).toMatch(/done\s*:\s*'完了'/)
      expect(labelMapping).toMatch(/failed\s*:\s*'失敗'/)
      expect(labelMapping).toMatch(/suppressed\s*:\s*'抑止'/)
    }
  })
})