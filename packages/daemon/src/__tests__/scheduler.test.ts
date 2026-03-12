import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isRateLimitError } from "../scheduler.js"
import { runGate2 } from "../gate2.js"
import { buildTesterPrompt } from "../tester.js"
import type { PmOutput } from "@devpane/shared"

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

describe("Tester → Gate 2 pipeline", () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "scheduler-tester-"))
  })

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  const spec: PmOutput = {
    tasks: [{ title: "add auth", description: "implement JWT auth", priority: 50, constraints: ["use HS256", "token expires in 1h"] }],
    reasoning: "security requirement",
  }

  describe("buildTesterPrompt with constraints", () => {
    it("includes constraints in the prompt", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("制約条件")
      expect(prompt).toContain("use HS256")
      expect(prompt).toContain("token expires in 1h")
    })

    it("omits constraints section when none provided", () => {
      const noConstraints: PmOutput = {
        tasks: [{ title: "add feature", description: "do something", priority: 50 }],
        reasoning: "test",
      }
      const prompt = buildTesterPrompt(noConstraints)
      expect(prompt).not.toContain("制約条件")
    })

    it("includes task title and description", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("add auth")
      expect(prompt).toContain("implement JWT auth")
    })

    it("includes design reasoning", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("security requirement")
    })
  })

  describe("Gate 2 validates tester output", () => {
    it("passes when valid test files exist", () => {
      const content = `import { describe, it, expect } from "vitest"\ndescribe("auth", () => { it("works", () => { expect(true).toBe(true) }) })\n`
      writeFileSync(join(workdir, "auth.test.ts"), content)
      const result = runGate2(spec, ["auth.test.ts"], workdir)
      expect(result.verdict).toBe("go")
    })

    it("recycles when tester produces no files", () => {
      const result = runGate2(spec, [], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons).toContain("no test files found")
    })

    it("recycles when test file has no test blocks", () => {
      writeFileSync(join(workdir, "empty.test.ts"), "export const x = 1\n")
      const result = runGate2(spec, ["empty.test.ts"], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons[0]).toContain("no test blocks")
    })

    it("recycles on structural issues (unbalanced braces)", () => {
      const content = `describe("x", () => { it("y", () => {})\n`
      writeFileSync(join(workdir, "bad.test.ts"), content)
      const result = runGate2(spec, ["bad.test.ts"], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons.some(r => r.includes("unbalanced braces"))).toBe(true)
    })
  })
})
