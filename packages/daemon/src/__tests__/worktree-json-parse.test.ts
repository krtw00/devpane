import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { countOpenPrs, hasOpenPr, resetOpenPrCountCacheForTests } from "../worktree.js"
import { execFileSync } from "node:child_process"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

describe("worktree.ts JSON.parse error handling improvements", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetOpenPrCountCacheForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("hasOpenPr function", () => {
    it("should handle invalid JSON gracefully without throwing", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("invalid json { malformed" as any)

      // Should not throw
      expect(() => hasOpenPr("test-branch")).not.toThrow()
      
      const result = hasOpenPr("test-branch")
      expect(result).toBe(false)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] JSON.parse failed in hasOpenPr:')
      )
    })

    it("should handle empty string JSON gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("" as any)

      const result = hasOpenPr("test-branch")
      expect(result).toBe(false)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] JSON.parse failed in hasOpenPr:')
      )
    })

    it("should handle null JSON gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("null" as any)

      const result = hasOpenPr("test-branch")
      expect(result).toBe(false)
      expect(console.warn).not.toHaveBeenCalled()
    })

    it("should parse valid JSON array correctly", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue(JSON.stringify([{ number: 123 }, { number: 456 }]) as any)

      const result = hasOpenPr("test-branch")
      expect(result).toBe(true)
      expect(console.warn).not.toHaveBeenCalled()
    })

    it("should handle non-array JSON objects gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue(JSON.stringify({ error: "something went wrong" }) as any)

      const result = hasOpenPr("test-branch")
      expect(result).toBe(false)
      expect(console.warn).not.toHaveBeenCalled()
    })
  })

  describe("countOpenPrs function", () => {
    it("should handle invalid JSON gracefully without throwing", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("invalid json { malformed" as any)

      // Should not throw
      expect(() => countOpenPrs()).not.toThrow()
      
      const result = countOpenPrs()
      expect(result).toBeNull()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] JSON.parse failed in countOpenPrs:')
      )
    })

    it("should handle empty string JSON gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("" as any)

      const result = countOpenPrs()
      expect(result).toBeNull()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] JSON.parse failed in countOpenPrs:')
      )
    })

    it("should handle null JSON gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("null" as any)

      const result = countOpenPrs()
      expect(result).toBe(0)
      expect(console.warn).not.toHaveBeenCalled()
    })

    it("should parse valid JSON array correctly", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue(JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }]) as any)

      const result = countOpenPrs()
      expect(result).toBe(3)
      expect(console.warn).not.toHaveBeenCalled()
    })

    it("should handle non-array JSON objects gracefully", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue(JSON.stringify({ count: 5, items: [] }) as any)

      const result = countOpenPrs()
      expect(result).toBe(0)
      expect(console.warn).not.toHaveBeenCalled()
    })

    it("should use cached value when JSON.parse fails and cache is valid", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      
      // First call: valid JSON to set cache
      mockExecFileSync.mockReturnValueOnce(JSON.stringify([{ number: 1 }, { number: 2 }]) as any)
      const firstResult = countOpenPrs()
      expect(firstResult).toBe(2)

      // Second call: invalid JSON, should use cache
      mockExecFileSync.mockReturnValueOnce("invalid json" as any)
      const secondResult = countOpenPrs()
      expect(secondResult).toBe(2)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[worktree] using cached open PR count: 2')
      )
    })

    it("should return null when JSON.parse fails and cache is expired", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      
      // First call: valid JSON to set cache
      mockExecFileSync.mockReturnValueOnce(JSON.stringify([{ number: 1 }]) as any)
      const firstResult = countOpenPrs()
      expect(firstResult).toBe(1)

      // Manually expire the cache by modifying the timestamp
      resetOpenPrCountCacheForTests()
      
      // Second call: invalid JSON, cache is null
      mockExecFileSync.mockReturnValueOnce("invalid json" as any)
      const secondResult = countOpenPrs()
      expect(secondResult).toBeNull()
    })

    it("should handle execFileSync throwing an error", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockImplementation(() => {
        throw new Error("Command failed")
      })

      const result = countOpenPrs()
      expect(result).toBeNull()
      expect(console.warn).toHaveBeenCalledWith(
        '[worktree] countOpenPrs failed:',
        expect.any(Error)
      )
    })

    it("should log appropriate error messages for different JSON parse errors", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      
      // Test with various invalid JSON strings
      const invalidJsonCases = [
        "invalid json",
        "{ malformed json",
        "[unclosed array",
        "undefined",
        "NaN",
      ]

      for (const invalidJson of invalidJsonCases) {
        vi.clearAllMocks()
        mockExecFileSync.mockReturnValue(invalidJson as any)
        
        const result = countOpenPrs()
        expect(result).toBeNull()
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('[worktree] JSON.parse failed in countOpenPrs:')
        )
      }
    })
  })

  describe("error logging", () => {
    it("should log JSON.parse errors with proper error messages", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("invalid json" as any)

      hasOpenPr("test-branch")
      
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^\[worktree\] JSON\.parse failed in hasOpenPr: .+/)
      )
    })

    it("should include the actual parse error message in logs", () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      mockExecFileSync.mockReturnValue("{ invalid json }" as any)

      countOpenPrs()
      
      const warnCalls = vi.mocked(console.warn).mock.calls
      const hasParseErrorLog = warnCalls.some(call => {
        if (typeof call[0] === 'string') {
          return call[0].includes('[worktree] JSON.parse failed in countOpenPrs:')
        }
        return false
      })
      expect(hasParseErrorLog).toBe(true)
    })
  })
})