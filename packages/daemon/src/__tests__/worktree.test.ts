import { describe, it, expect, vi, beforeEach } from "vitest"

// モック設定
vi.mock("../config.js", () => ({
  config: {
    PROJECT_ROOT: "/fake/project",
    BASE_BRANCH: "main",
    BRANCH_PREFIX: "devpane",
    PR_MERGE_STRATEGY: "squash",
  },
}))

const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const existsSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
}))

describe("worktree JSON.parse error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // デフォルトのモック設定
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git") return ""
      if (cmd === "gh") return "[]" // デフォルトで空のJSON配列を返す
      return ""
    })
    existsSyncMock.mockReturnValue(false)
    readdirSyncMock.mockReturnValue([])
  })

  // hasOpenPrは内部関数なのでエクスポートされていない
  // 代わりに、hasOpenPrを使用する関数を通じて間接的にテストする
  describe("pruneWorktrees function (uses hasOpenPr internally)", () => {
    it("should handle JSON.parse error in hasOpenPr when checking for open PRs", async () => {
      const { pruneWorktrees } = await import("../worktree.js")
      
      // WORKTREE_DIRが存在するようにする
      existsSyncMock.mockImplementation((path: string) => {
        if (path.includes(".worktrees")) return true
        return false
      })
      
      // ブランチリストを返す
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch" && args.includes("--list")) {
          return "  devpane/task-test\n"
        }
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return "invalid json" // 無効なJSON - hasOpenPrが呼ばれる
        }
        return ""
      })

      // コンソール出力を監視
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      pruneWorktrees()
      
      // JSON.parseエラーがログに出力されることを確認
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] Failed to parse JSON output for hasOpenPr'),
        expect.any(String)
      )
      
      consoleWarnSpy.mockRestore()
    })
  })

  describe("countOpenPrs function", () => {
    beforeEach(async () => {
      // countOpenPrsのテスト用にlastKnownOpenPrsをリセット
      const { resetOpenPrCountCacheForTests } = await import("../worktree.js")
      resetOpenPrCountCacheForTests()
    })

    it("should handle JSON.parse error and return null", async () => {
      const { countOpenPrs } = await import("../worktree.js")
      
      // JSON.parseが失敗するように無効なJSONを返す
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return "invalid json" // 無効なJSON
        }
        return ""
      })

      const result = countOpenPrs()
      
      expect(result).toBe(null)
      // エラーがコンソールに出力されることを確認
    })

    it("should return count when JSON.parse succeeds", async () => {
      const { countOpenPrs } = await import("../worktree.js")
      
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return '[{"number": 123}, {"number": 456}]' // 2つのPR
        }
        return ""
      })

      const result = countOpenPrs()
      
      expect(result).toBe(2)
    })

    it("should return 0 when JSON.parse succeeds but array is empty", async () => {
      const { countOpenPrs } = await import("../worktree.js")
      
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return '[]' // 空の配列
        }
        return ""
      })

      const result = countOpenPrs()
      
      expect(result).toBe(0)
    })

    it("should use cached value when JSON.parse fails but cache is valid", async () => {
      const { countOpenPrs } = await import("../worktree.js")
      
      // 最初の呼び出し：成功してキャッシュを設定
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return '[{"number": 123}]' // 1つのPR
        }
        return ""
      })

      const firstResult = countOpenPrs()
      expect(firstResult).toBe(1)
      
      // 2回目の呼び出し：JSON.parseが失敗するが、キャッシュが有効
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return "invalid json" // 無効なJSON
        }
        return ""
      })

      // 時間を進めないのでキャッシュは有効
      const secondResult = countOpenPrs()
      expect(secondResult).toBe(1) // キャッシュされた値
    })

    it("should return null when JSON.parse fails and cache is expired", async () => {
      // フェイクタイマーを使用
      vi.useFakeTimers()
      
      const { countOpenPrs } = await import("../worktree.js")
      
      // 最初の呼び出し：成功してキャッシュを設定
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return '[{"number": 123}]' // 1つのPR
        }
        return ""
      })

      const firstResult = countOpenPrs()
      expect(firstResult).toBe(1)
      
      // 2回目の呼び出し：JSON.parseが失敗し、キャッシュが期限切れ
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "pr" && args.includes("--json")) {
          return "invalid json" // 無効なJSON
        }
        return ""
      })

      // 時間を進めてキャッシュを期限切れにする
      vi.advanceTimersByTime(6 * 60 * 1000) // 6分（キャッシュTTLは5分）
      
      const secondResult = countOpenPrs()
      expect(secondResult).toBe(null) // キャッシュが期限切れなのでnull
      
      vi.useRealTimers()
    })
  })
})

describe("executeInWorktree function", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(true) // ワークツリーが存在するように
  })

  it("should handle JSON.parse error and return error object", async () => {
    const { executeInWorktree } = await import("../worktree.js")
    
    // コマンドは成功するが、無効なJSONを返す
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "test-command") {
        return "invalid json" // 無効なJSON
      }
      return ""
    })

    const result = executeInWorktree("test-task", "test-command", ["arg1", "arg2"])
    
    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to parse JSON output')
  })

  it("should return parsed JSON when command succeeds with valid JSON", async () => {
    const { executeInWorktree } = await import("../worktree.js")
    
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "test-command") {
        return '{"key": "value", "number": 123}' // 有効なJSON
      }
      return ""
    })

    const result = executeInWorktree("test-task", "test-command", ["arg1", "arg2"])
    
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ key: "value", number: 123 })
    }
  })

  it("should handle command execution failure", async () => {
    const { executeInWorktree } = await import("../worktree.js")
    
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "test-command") {
        throw new Error("Command failed")
      }
      return ""
    })

    const result = executeInWorktree("test-task", "test-command", ["arg1", "arg2"])
    
    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to execute command')
  })

  it("should execute command in correct worktree directory", async () => {
    const { executeInWorktree } = await import("../worktree.js")
    
    let capturedCwd: string | undefined
    execFileSyncMock.mockImplementation((cmd: string, args: string[], options: any) => {
      if (cmd === "test-command") {
        capturedCwd = options?.cwd
        return '{"success": true}'
      }
      return ""
    })

    executeInWorktree("test-task-123", "test-command", ["arg1"])
    
    // 正しいワークツリーパスで実行されたことを確認
    expect(capturedCwd).toBe("/fake/project/.worktrees/task-test-task-123")
  })
})