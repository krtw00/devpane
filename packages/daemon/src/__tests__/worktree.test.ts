import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { countOpenPrs, hasOpenPr, resetOpenPrCountCacheForTests } from "../worktree.js"
import { execFileSync } from "node:child_process"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

describe("worktree JSON.parse error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetOpenPrCountCacheForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("handles invalid JSON in hasOpenPr gracefully", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("invalid json" as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
    // Should not throw, should handle gracefully
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[worktree] JSON.parse failed in hasOpenPr:')
    )
  })

  it("handles invalid JSON in countOpenPrs gracefully", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("invalid json" as any)

    const result = countOpenPrs()
    expect(result).toBeNull()
    // Should not throw, should handle gracefully
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[worktree] JSON.parse failed in countOpenPrs:')
    )
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
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[worktree] using cached open PR count: 2')
    )
  })

  it("parses valid JSON correctly in hasOpenPr", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify([{ number: 1 }]) as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("parses valid JSON correctly in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }]) as any)

    const result = countOpenPrs()
    expect(result).toBe(3)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("handles empty array JSON in hasOpenPr", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify([]) as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("handles empty array JSON in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify([]) as any)

    const result = countOpenPrs()
    expect(result).toBe(0)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("handles malformed JSON (not an array) in hasOpenPr", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify({ not: "an array" }) as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("handles malformed JSON (not an array) in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue(JSON.stringify({ not: "an array" }) as any)

    const result = countOpenPrs()
    expect(result).toBe(0)
    expect(console.warn).not.toHaveBeenCalled()
  })
})