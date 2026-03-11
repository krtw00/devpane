import { describe, it, expect } from "vitest"
import { isRateLimitError } from "../scheduler.js"

describe("isRateLimitError", () => {
  it("detects rate limit messages", () => {
    expect(isRateLimitError("Error: rate limit exceeded")).toBe(true)
    expect(isRateLimitError("429 Too Many Requests")).toBe(true)
    expect(isRateLimitError("Rate-limit reached, please wait")).toBe(true)
    expect(isRateLimitError("API quota exceeded")).toBe(true)
    expect(isRateLimitError("Server overloaded, try again later")).toBe(true)
  })

  it("does not match normal errors", () => {
    expect(isRateLimitError("SyntaxError: unexpected token")).toBe(false)
    expect(isRateLimitError("command not found: claude")).toBe(false)
    expect(isRateLimitError("ENOENT: no such file")).toBe(false)
  })
})
