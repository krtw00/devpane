import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * TaskList.vue のタスク一覧にステータスバッジを追加するテスト
 * 仕様: 各タスクのステータスを表示する小さなバッジを追加
 * ステータスは 'pending', 'running', 'done', 'failed' の4種類
 * それぞれ異なる色（灰色、青色、緑色、赤色）の小さな円またはバッジとして表示
 * 表示は既存のタスクタイトルの左側に配置
 */
describe('TaskList status badge implementation', () => {
  const template = readFileSync(
    resolve(__dir, '../views/TasksView.vue'),
    'utf-8',
  )

  it('pendingステータスに灰色が使用されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // .badge-pending クラスが定義されているか
      const hasPendingBadge = styleContent.includes('.badge-pending')
      expect(hasPendingBadge).toBe(true)
      
      if (hasPendingBadge) {
        const pendingBadgeMatch = styleContent.match(/\.badge-pending\s*\{[^}]*\}/)
        expect(pendingBadgeMatch).toBeDefined()
        
        if (pendingBadgeMatch) {
          const pendingBadgeStyle = pendingBadgeMatch[0]
          // 灰色のバリエーションをチェック
          const hasGrayColor = pendingBadgeStyle.includes('#8b949e') || // 現在のテーマの灰色
                              pendingBadgeStyle.includes('#6e7681') || // suppressedで使用されている灰色
                              pendingBadgeStyle.includes('#484f58') || // 現在のテーマの暗い灰色
                              pendingBadgeStyle.includes('#808080') || 
                              pendingBadgeStyle.includes('gray') ||
                              pendingBadgeStyle.includes('grey')
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
      
      // .badge-running クラスが定義されているか
      const hasRunningBadge = styleContent.includes('.badge-running')
      expect(hasRunningBadge).toBe(true)
      
      if (hasRunningBadge) {
        const runningBadgeMatch = styleContent.match(/\.badge-running\s*\{[^}]*\}/)
        expect(runningBadgeMatch).toBeDefined()
        
        if (runningBadgeMatch) {
          const runningBadgeStyle = runningBadgeMatch[0]
          // 青色のバリエーションをチェック
          const hasBlueColor = runningBadgeStyle.includes('#58a6ff') || // 現在のテーマの青色
                              runningBadgeStyle.includes('#1f6feb') || // GitHubの青色
                              runningBadgeStyle.includes('#007bff') || 
                              runningBadgeStyle.includes('blue')
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
      
      // .badge-done クラスが定義されているか
      const hasDoneBadge = styleContent.includes('.badge-done')
      expect(hasDoneBadge).toBe(true)
      
      if (hasDoneBadge) {
        const doneBadgeMatch = styleContent.match(/\.badge-done\s*\{[^}]*\}/)
        expect(doneBadgeMatch).toBeDefined()
        
        if (doneBadgeMatch) {
          const doneBadgeStyle = doneBadgeMatch[0]
          // 緑色のバリエーションをチェック
          const hasGreenColor = doneBadgeStyle.includes('#3fb950') || // 現在のテーマの緑色
                               doneBadgeStyle.includes('#2ea043') || // 現在のテーマの明るい緑色
                               doneBadgeStyle.includes('#238636') || // 現在の実装の緑色
                               doneBadgeStyle.includes('#28a745') || 
                               doneBadgeStyle.includes('green')
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
      
      // .badge-failed クラスが定義されているか
      const hasFailedBadge = styleContent.includes('.badge-failed')
      expect(hasFailedBadge).toBe(true)
      
      if (hasFailedBadge) {
        const failedBadgeMatch = styleContent.match(/\.badge-failed\s*\{[^}]*\}/)
        expect(failedBadgeMatch).toBeDefined()
        
        if (failedBadgeMatch) {
          const failedBadgeStyle = failedBadgeMatch[0]
          // 赤色のバリエーションをチェック
          const hasRedColor = failedBadgeStyle.includes('#f85149') || // 現在の実装の赤色
                             failedBadgeStyle.includes('#da3633') || // GitHubの赤色
                             failedBadgeStyle.includes('#dc3545') || 
                             failedBadgeStyle.includes('red')
          expect(hasRedColor).toBe(true)
        }
      }
    }
  })

  it('ステータスバッジは小さな円として実装されている', () => {
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
        
        // 具体的なサイズをチェック（10px程度の小さなサイズ）
        const hasSmallSize = (statusBadgeStyle.includes('width: 10px') || 
                             statusBadgeStyle.includes('width:8px') ||
                             statusBadgeStyle.includes('width: 8px') ||
                             statusBadgeStyle.includes('width:12px') ||
                             statusBadgeStyle.includes('width: 12px')) &&
                            (statusBadgeStyle.includes('height: 10px') || 
                             statusBadgeStyle.includes('height:8px') ||
                             statusBadgeStyle.includes('height: 8px') ||
                             statusBadgeStyle.includes('height:12px') ||
                             statusBadgeStyle.includes('height: 12px'))
        expect(hasSmallSize).toBe(true)
        
        // 円形であることをチェック
        const isCircular = statusBadgeStyle.includes('border-radius: 50%') ||
                          statusBadgeStyle.includes('border-radius:50%') ||
                          statusBadgeStyle.includes('border-radius: 9999px') ||
                          statusBadgeStyle.includes('border-radius:9999px')
        expect(isCircular).toBe(true)
      }
    }
  })

  it('ステータスバッジはタスクタイトルの左側に配置されている', () => {
    // タスク行のテンプレート部分を取得
    const taskRowMatch = template.match(/<div[^>]*v-for="task in filteredTasks"[^>]*>[\s\S]*?<\/div>/)
    expect(taskRowMatch).toBeDefined()
    
    if (taskRowMatch) {
      const taskRowContent = taskRowMatch[0]
      
      // status-badge 要素があるか
      const hasStatusBadge = taskRowContent.includes('status-badge')
      expect(hasStatusBadge).toBe(true)
      
      // badge-${status} クラスバインディングがあるか
      const hasBadgeClassBinding = taskRowContent.includes('`badge-${task.status}`')
      expect(hasBadgeClassBinding).toBe(true)
      
      // タスクタイトル要素があるか
      const hasTaskTitle = taskRowContent.includes('task-title')
      expect(hasTaskTitle).toBe(true)
      
      // status-badge が task-title の前に出現するか（左側に配置）
      const statusBadgeIndex = taskRowContent.indexOf('status-badge')
      const taskTitleIndex = taskRowContent.indexOf('task-title')
      expect(statusBadgeIndex).toBeLessThan(taskTitleIndex)
    }
  })

  it('4つのステータスバッジクラスがすべて定義されている', () => {
    const styleSection = template.match(/<style[^>]*>[\s\S]*?<\/style>/g)
    expect(styleSection).toBeDefined()
    
    if (styleSection) {
      const styleContent = styleSection[0]
      
      // 4つのステータスバッジクラスがすべて存在するか
      const requiredBadges = ['badge-pending', 'badge-running', 'badge-done', 'badge-failed']
      requiredBadges.forEach(badgeClass => {
        expect(styleContent.includes(badgeClass)).toBe(true)
      })
    }
  })
})