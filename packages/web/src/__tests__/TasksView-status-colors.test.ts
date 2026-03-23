import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TasksView.vue のタスク一覧にステータスバッジを追加するテスト
 * 仕様: 各タスクのステータスを表示する小さなバッジを追加
 * ステータスは 'pending', 'running', 'done', 'failed' の4種類
 * それぞれ異なる色（灰色、青色、緑色、赤色）の小さな円またはバッジとして表示
 */
describe('TasksView status colors implementation', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('pendingステータスに灰色が使用されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // .s-pending クラスが定義されているか
      const hasPendingClass = styleContent.includes('.s-pending')
      expect(hasPendingClass).toBe(true)
      
      if (hasPendingClass) {
        // 灰色に関連する色が使用されているか
        const pendingStyleMatch = styleContent.match(/\.s-pending\s*\{[^}]*\}/)
        expect(pendingStyleMatch).toBeDefined()
        
        if (pendingStyleMatch) {
          const pendingStyle = pendingStyleMatch[0]
          // 灰色のバリエーションをチェック
          const hasGrayColor = pendingStyle.includes('#808080') || 
                              pendingStyle.includes('gray') ||
                              pendingStyle.includes('grey') ||
                              pendingStyle.includes('#6c757d') ||
                              pendingStyle.includes('#6b7280') ||
                              pendingStyle.includes('#9ca3af') ||
                              pendingStyle.includes('#a1a1aa') ||
                              pendingStyle.includes('#8b949e') || // 現在のテーマの灰色
                              pendingStyle.includes('#484f58') || // 現在のテーマの暗い灰色
                              pendingStyle.includes('#6e7681')    // suppressedで使用されている灰色
          expect(hasGrayColor).toBe(true)
        }
      }
    }
  })

  it('runningステータスに青色が使用されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // .s-running クラスが定義されているか
      const hasRunningClass = styleContent.includes('.s-running')
      expect(hasRunningClass).toBe(true)
      
      if (hasRunningClass) {
        // 青色に関連する色が使用されているか
        const runningStyleMatch = styleContent.match(/\.s-running\s*\{[^}]*\}/)
        expect(runningStyleMatch).toBeDefined()
        
        if (runningStyleMatch) {
          const runningStyle = runningStyleMatch[0]
          // 青色のバリエーションをチェック
          const hasBlueColor = runningStyle.includes('#007bff') || 
                              runningStyle.includes('blue') ||
                              runningStyle.includes('#3b82f6') ||
                              runningStyle.includes('#2563eb') ||
                              runningStyle.includes('#1d4ed8') ||
                              runningStyle.includes('#1e40af') ||
                              runningStyle.includes('#58a6ff') || // 現在のテーマの青色
                              runningStyle.includes('#1f6feb')    // GitHubの青色
          expect(hasBlueColor).toBe(true)
        }
      }
    }
  })

  it('doneステータスに緑色が使用されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // .s-done クラスが定義されているか
      const hasDoneClass = styleContent.includes('.s-done')
      expect(hasDoneClass).toBe(true)
      
      if (hasDoneClass) {
        // 緑色に関連する色が使用されているか
        const doneStyleMatch = styleContent.match(/\.s-done\s*\{[^}]*\}/)
        expect(doneStyleMatch).toBeDefined()
        
        if (doneStyleMatch) {
          const doneStyle = doneStyleMatch[0]
          // 緑色のバリエーションをチェック
          const hasGreenColor = doneStyle.includes('#28a745') || 
                               doneStyle.includes('green') ||
                               doneStyle.includes('#22c55e') ||
                               doneStyle.includes('#16a34a') ||
                               doneStyle.includes('#15803d') ||
                               doneStyle.includes('#238636') || // 現在の実装の緑色
                               doneStyle.includes('#2ea043') || // 現在のテーマの明るい緑色
                               doneStyle.includes('#3fb950')    // 現在のテーマの緑色
          expect(hasGreenColor).toBe(true)
        }
      }
    }
  })

  it('failedステータスに赤色が使用されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // .s-failed クラスが定義されているか
      const hasFailedClass = styleContent.includes('.s-failed')
      expect(hasFailedClass).toBe(true)
      
      if (hasFailedClass) {
        // 赤色に関連する色が使用されているか
        const failedStyleMatch = styleContent.match(/\.s-failed\s*\{[^}]*\}/)
        expect(failedStyleMatch).toBeDefined()
        
        if (failedStyleMatch) {
          const failedStyle = failedStyleMatch[0]
          // 赤色のバリエーションをチェック
          const hasRedColor = failedStyle.includes('#dc3545') || 
                             failedStyle.includes('red') ||
                             failedStyle.includes('#ef4444') ||
                             failedStyle.includes('#dc2626') ||
                             failedStyle.includes('#b91c1c') ||
                             failedStyle.includes('#f85149') || // 現在の実装の赤色
                             failedStyle.includes('#da3633')    // GitHubの赤色
          expect(hasRedColor).toBe(true)
        }
      }
    }
  })

  it('ステータスバッジはタスクタイトルの左側に視覚的に表示される', () => {
    // タスク行のテンプレート部分を取得
    const taskRowMatch = template.match(/<div[^>]*v-for="task in filteredTasks"[^>]*>[\s\S]*?<\/div>/)
    expect(taskRowMatch).toBeDefined()
    
    if (taskRowMatch) {
      const taskRowContent = taskRowMatch[0]
      
      // ステータスに基づくクラスバインディングがあるか
      const hasStatusClass = taskRowContent.includes(':class="`s-${task.status}`"')
      expect(hasStatusClass).toBe(true)
      
      // status-badge 要素があるか
      const hasStatusBadge = taskRowContent.includes('status-badge')
      expect(hasStatusBadge).toBe(true)
      
      // badge-${status} クラスバインディングがあるか
      const hasBadgeClassBinding = taskRowContent.includes('`badge-${task.status}`')
      expect(hasBadgeClassBinding).toBe(true)
    }
  })

  it('ステータスバッジは小さな円またはバッジとして実装されている', () => {
    // スタイルセクションを取得
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // status-badge クラスが小さな円として定義されているか
      const statusBadgeMatch = styleContent.match(/\.status-badge\s*\{[^}]*\}/)
      expect(statusBadgeMatch).toBeDefined()
      
      if (statusBadgeMatch) {
        const statusBadgeStyle = statusBadgeMatch[0]
        // 小さな円のスタイルがあるか
        const isSmallCircle = statusBadgeStyle.includes('width:') &&
                             statusBadgeStyle.includes('height:') &&
                             statusBadgeStyle.includes('border-radius:')
        expect(isSmallCircle).toBe(true)
      }
      
      // 各ステータスの色クラスが定義されているか
      const statusColors = ['badge-pending', 'badge-running', 'badge-done', 'badge-failed']
      
      statusColors.forEach(badgeClass => {
        expect(styleContent.includes(badgeClass)).toBe(true)
        
        const badgeStyleMatch = styleContent.match(new RegExp(`\\.${badgeClass}\\s*\\{[^}]*\\}`))
        expect(badgeStyleMatch).toBeDefined()
        
        if (badgeStyleMatch) {
          const badgeStyle = badgeStyleMatch[0]
          // 背景色が設定されているか
          const hasBackgroundColor = badgeStyle.includes('background-color:') ||
                                    badgeStyle.includes('background:')
          expect(hasBackgroundColor).toBe(true)
        }
      })
    }
  })
})