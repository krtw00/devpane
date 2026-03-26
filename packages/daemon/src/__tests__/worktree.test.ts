import { describe, it, expect, vi, beforeEach } from "vitest"
import { countOpenPrs, hasOpenPr, resetOpenPrCountCacheForTests, safeJsonParse } from "../worktree.js"
import { execFileSync } from "node:child_process"

// Import the constant from worktree module
const OPEN_PR_CACHE_TTL_MS = 5 * 60 * 1000

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

  it("handles empty response from gh command in hasOpenPr", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("" as any)

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
  })

  it("handles empty response from gh command in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue("" as any)

    const result = countOpenPrs()
    expect(result).toBeNull()
  })

  it("handles execFileSync throwing error in hasOpenPr", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("Command failed")
    })

    const result = hasOpenPr("test-branch")
    expect(result).toBe(false)
  })

  it("handles execFileSync throwing error in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("Command failed")
    })

    const result = countOpenPrs()
    expect(result).toBeNull()
  })

  it("returns null when cache is expired in countOpenPrs", () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    
    // First call returns valid JSON to set cache
    mockExecFileSync.mockReturnValueOnce(JSON.stringify([{ number: 1 }]) as any)
    const firstResult = countOpenPrs()
    expect(firstResult).toBe(1)

    // Mock Date.now to simulate cache expiration
    const originalDateNow = Date.now
    Date.now = () => originalDateNow() + OPEN_PR_CACHE_TTL_MS + 1000

    try {
      // Second call returns invalid JSON, cache is expired
      mockExecFileSync.mockReturnValueOnce("invalid json" as any)
      const secondResult = countOpenPrs()
      expect(secondResult).toBeNull()
    } finally {
      Date.now = originalDateNow
    }
  })
})

describe("safeJsonParse helper function", () => {
  it("parses valid JSON correctly", () => {
    const validJson = '{"key": "value", "number": 123, "array": [1,2,3]}'
    const result = safeJsonParse(validJson)
    expect(result).toEqual({ key: "value", number: 123, array: [1, 2, 3] })
  })

  it("returns null for invalid JSON", () => {
    const invalidJson = "invalid json"
    const result = safeJsonParse(invalidJson)
    expect(result).toBeNull()
  })

  it("returns default value for invalid JSON when provided", () => {
    const invalidJson = "invalid json"
    const defaultValue = { default: "value" }
    const result = safeJsonParse(invalidJson, defaultValue)
    expect(result).toEqual(defaultValue)
  })

  it("returns default value for null input", () => {
    const nullInput = null
    const defaultValue = { default: "value" }
    const result = safeJsonParse(nullInput, defaultValue)
    expect(result).toEqual(defaultValue)
  })

  it("returns default value for undefined input", () => {
    const undefinedInput = undefined
    const defaultValue = { default: "value" }
    const result = safeJsonParse(undefinedInput, defaultValue)
    expect(result).toEqual(defaultValue)
  })

  it("returns null for empty string input", () => {
    const emptyString = ""
    const result = safeJsonParse(emptyString)
    expect(result).toBeNull()
  })

  it("returns default value for empty string when provided", () => {
    const emptyString = ""
    const defaultValue = { default: "value" }
    const result = safeJsonParse(emptyString, defaultValue)
    expect(result).toEqual(defaultValue)
  })

  it("handles valid JSON array", () => {
    const validJsonArray = '[1, 2, 3, "test"]'
    const result = safeJsonParse(validJsonArray)
    expect(result).toEqual([1, 2, 3, "test"])
  })

  it("handles valid JSON string", () => {
    const validJsonString = '"test string"'
    const result = safeJsonParse(validJsonString)
    expect(result).toBe("test string")
  })

  it("handles valid JSON number", () => {
    const validJsonNumber = "123.45"
    const result = safeJsonParse(validJsonNumber)
    expect(result).toBe(123.45)
  })

  it("handles valid JSON boolean", () => {
    const validJsonBoolean = "true"
    const result = safeJsonParse(validJsonBoolean)
    expect(result).toBe(true)
  })

  it("handles malformed JSON with trailing comma", () => {
    const malformedJson = '{"key": "value",}'
    const result = safeJsonParse(malformedJson)
    expect(result).toBeNull()
  })

  it("handles JSON with reviver function", () => {
    const validJson = '{"date": "2024-01-01", "number": "123"}'
    const reviver = (key: string, value: any) => {
      if (key === "date") return new Date(value)
      if (key === "number") return parseInt(value, 10)
      return value
    }
    const result = safeJsonParse(validJson, null, reviver)
    expect(result).toEqual({ date: new Date("2024-01-01"), number: 123 })
  })

  it("returns default value when reviver throws error", () => {
    const validJson = '{"key": "value"}'
    const reviver = () => {
      throw new Error("Reviver error")
    }
    const defaultValue = { default: "value" }
    const result = safeJsonParse(validJson, defaultValue, reviver)
    expect(result).toEqual(defaultValue)
  })

  it("handles JSON with nested objects", () => {
    const nestedJson = '{"outer": {"inner": {"value": 123}}, "array": [{"id": 1}, {"id": 2}]}'
    const result = safeJsonParse(nestedJson)
    expect(result).toEqual({
      outer: { inner: { value: 123 } },
      array: [{ id: 1 }, { id: 2 }]
    })
  })

  it("handles JSON with special characters", () => {
    const jsonWithSpecialChars = '{"text": "line1\\nline2", "quotes": "He said \\"hello\\"", "unicode": "🎉"}'  
    const result = safeJsonParse(jsonWithSpecialChars)
    expect(result).toEqual({
      text: "line1\nline2",
      quotes: 'He said "hello"',
      unicode: "🎉"
    })
  })

  it("handles JSON null value", () => {
    const jsonWithNull = '{"value": null, "other": "text"}'
    const result = safeJsonParse(jsonWithNull)
    expect(result).toEqual({ value: null, other: "text" })
  })

  it("returns default value for whitespace-only string", () => {
    const whitespace = "   \n\t  "
    const defaultValue = { default: "value" }
    const result = safeJsonParse(whitespace, defaultValue)
    expect(result).toEqual(defaultValue)
  })

  it("handles JSON with date strings", () => {
    const jsonWithDate = '{"date": "2024-01-15T10:30:00.000Z", "name": "test"}'
    const result = safeJsonParse(jsonWithDate)
    expect(result).toEqual({
      date: "2024-01-15T10:30:00.000Z",
      name: "test"
    })
  })
})