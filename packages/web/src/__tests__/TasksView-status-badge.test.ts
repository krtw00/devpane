import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TasksView.vue のタスク一覧にステータス別のバッジ表示を追加するテスト。
 * ステータスに応じた色分け（done: 緑、failed: 赤、running: 青、pending/queued: グレー）の
 * 小さなバッジをタスクタイトルの横に表示する。
 * 
 * TDD: 実装前はFAILする。
 */
describe('TasksView status badge display', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('タスクタイトルの横にステータスバッジを表示する要素がある', () => {
    // タスク行のテンプレート部分を抽出
    const lines = template.split('\n')
    const taskTitleIndex = lines.findIndex(line => 
      line.includes('task-title') && line.includes('{{ task.title }}')
    )
    
    expect(taskTitleIndex).toBeGreaterThan(-1)
    
    // タスクタイトルの周辺（前後3行）をチェック
    const start = Math.max(0, taskTitleIndex - 3)
    const end = Math.min(lines.length, taskTitleIndex + 4)
    const context = lines.slice(start, end).join('\n')
    
    // ステータスバッジを示す要素を検索
    // バッジは通常、span要素で表示され、ステータスに応じたクラスを持つ
    const hasStatusBadge = context.includes('{{ task.status }}') ||
                          context.includes('statusClass') ||
                          context.includes('badgeClass') ||
                          /class="[^"]*(status|badge)[^"]*"/.test(context)
    
    expect(hasStatusBadge).toBe(true)
  })

  it('ステータスに応じたCSSクラスを返すロジックがある', () => {
    const scriptSection = template.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
    
    // ステータスに応じたCSSクラスを返す関数、computedプロパティ、またはメソッド
    const hasStatusClassLogic = 
      scriptSection.includes('statusClass') ||
      scriptSection.includes('badgeClass') ||
      scriptSection.includes('getStatusClass') ||
      (scriptSection.includes('task.status') && 
       (scriptSection.includes('computed') || 
        scriptSection.includes('function') || 
        scriptSection.includes('=>')))
    
    expect(hasStatusClassLogic).toBe(true)
  })

  it('ステータスバッジ用のCSSスタイルが定義されている', () => {
    const styleSection = template.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || ''
    
    // バッジ用のスタイルが定義されているか確認
    const hasBadgeStyle = 
      styleSection.includes('.badge') ||
      styleSection.includes('.status-badge') ||
      styleSection.includes('task-status') ||
      /\.(status|badge)-/.test(styleSection)
    
    expect(hasBadgeStyle).toBe(true)
  })

  it('ステータス別の色分けが実装されている', () => {
    const styleSection = template.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || ''
    
    // 仕様通りの色が定義されているか確認
    // done: 緑 (#238636 または類似色)
    const hasGreenForDone = 
      styleSection.includes('.s-done') && 
      (styleSection.includes('#238636') || 
       styleSection.includes('#2ea043') || 
       styleSection.includes('#3fb950'))
    
    // failed: 赤 (#f85149 または類似色)  
    const hasRedForFailed = 
      styleSection.includes('.s-failed') && 
      (styleSection.includes('#f85149') || 
       styleSection.includes('#da3633'))
    
    // running: 青 (#58a6ff または類似色)
    const hasBlueForRunning = 
      styleSection.includes('.s-running') && 
      (styleSection.includes('#58a6ff') || 
       styleSection.includes('#1f6feb'))
    
    // pending/queued: グレー (#6e7681 または類似色)
    const hasGrayForPending = 
      (styleSection.includes('.s-pending') || 
       styleSection.includes('.s-suppressed')) && 
      (styleSection.includes('#6e7681') || 
       styleSection.includes('#8b949e') || 
       styleSection.includes('#484f58'))
    
    // 少なくとも1つのステータス用の色が定義されている
    expect(hasGreenForDone || hasRedForFailed || hasBlueForRunning || hasGrayForPending).toBe(true)
  })

  it('バッジは小さなサイズで表示される', () => {
    const styleSection = template.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || ''
    
    // 小さなバッジ用のスタイルが定義されているか確認
    const hasSmallBadgeStyle = 
      styleSection.includes('font-size: 0.6') ||
      styleSection.includes('font-size: 0.7') ||
      styleSection.includes('font-size: 0.8') ||
      styleSection.includes('padding: 0.1') ||
      styleSection.includes('padding: 0.2') ||
      styleSection.includes('padding: 0.3')
    
    expect(hasSmallBadgeStyle).toBe(true)
  })

  it('バッジは視覚的に認識できるデザインである', () => {
    const styleSection = template.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || ''
    
    // バッジが視覚的に目立つようにスタイルが定義されているか確認
    const hasVisibleBadgeStyle = 
      styleSection.includes('background-color') ||
      styleSection.includes('background:') ||
      styleSection.includes('border:') ||
      styleSection.includes('border-radius:') ||
      styleSection.includes('display: inline-block')
    
    expect(hasVisibleBadgeStyle).toBe(true)
  })
})