import { describe, it, expect, vi, beforeEach } from "vitest"
import { countOpenPrs, hasOpenPr, resetOpenPrCountCacheForTests } from "../worktree.js"
import { execFileSync } from "node:child_process"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

describe("worktree JSON.parse error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetOpenPrCountCacheForTests()
  })

  it("handles invalid JSON in hasOpenPr gracefully", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("invalid json" as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
    // Should not throw, should handle gracefully
  })

  it("handles invalid JSON in countOpenPrs gracefully", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("invalid json" as any)

    const result = countOpenPrs()
    expect(result).toBeNull()
    // Should not throw, should handle gracefully
  })

  it("returns cached value when JSON.parse fails in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    
    // First call returns valid JSON to set cache
    mockExecFileSync.mockReturnValueOnce(JSON.stringify([{ number: 1 }, { number: 2 }]) as any)
    const firstResult = countOpenPrs()
    expect(firstResult).toBe(2)

    // Second call returns invalid JSON, should use cache
    mockExecFileSync.mockReturnValueOnce("invalid json" as any)
    const secondResult = countOpenPrs()
    expect(secondResult).toBe(2) // Should return cached value
  })
})