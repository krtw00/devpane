import { describe, it, expect } from "vitest"
import { parseTesterOutput } from "../tester.js"

describe("parseTesterOutput", () => {
  it("extracts test file paths from result event", () => {
    const lines = [
      JSON.stringify({
        type: "result",
        result: "Created test files: src/__tests__/auth.test.ts and src/__tests__/api.test.ts",
      }),
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toContain("src/__tests__/auth.test.ts")
    expect(files).toContain("src/__tests__/api.test.ts")
    expect(files).toHaveLength(2)
  })

  it("deduplicates test file paths", () => {
    const lines = [
      JSON.stringify({
        type: "result",
        result: "Wrote src/__tests__/foo.test.ts, verified src/__tests__/foo.test.ts passes",
      }),
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toEqual(["src/__tests__/foo.test.ts"])
  })

  it("extracts from non-JSON lines", () => {
    const lines = [
      "Some debug output mentioning src/__tests__/bar.test.ts",
      "not json",
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toContain("src/__tests__/bar.test.ts")
  })

  it("returns empty array when no test files found", () => {
    const lines = [
      JSON.stringify({ type: "result", result: "No tests generated" }),
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toEqual([])
  })

  it("handles empty input", () => {
    expect(parseTesterOutput("")).toEqual([])
  })

  it("ignores stream_event lines without test paths", () => {
    const lines = [
      JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "hello" } } }),
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toEqual([])
  })

  it("extracts paths with nested directories", () => {
    const lines = [
      JSON.stringify({
        type: "result",
        result: "Generated packages/daemon/src/__tests__/deep/nested.test.ts",
      }),
    ].join("\n")

    const files = parseTesterOutput(lines)
    expect(files).toContain("packages/daemon/src/__tests__/deep/nested.test.ts")
  })

})
