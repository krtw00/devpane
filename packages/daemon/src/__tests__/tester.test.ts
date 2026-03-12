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

  describe("tool_use event file_path extraction", () => {
    it("extracts test file path from Write tool_use via input_json_delta", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/auth.test.ts",',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '"content": "import { describe } from \\"vitest\\""}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toContain("/work/src/__tests__/auth.test.ts")
    })

    it("extracts test file path from Edit tool_use via input_json_delta", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Edit" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/utils.test.ts",',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toContain("/work/src/__tests__/utils.test.ts")
    })

    it("ignores non-test file paths from tool_use events", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/utils.ts",',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toEqual([])
    })

    it("extracts multiple test files from sequential tool_use events", () => {
      const lines = [
        // First Write
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/first.test.ts"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
        // Second Write
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/second.test.ts"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toContain("/work/src/__tests__/first.test.ts")
      expect(files).toContain("/work/src/__tests__/second.test.ts")
      expect(files).toHaveLength(2)
    })

    it("deduplicates paths from tool_use and result events", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "src/__tests__/dup.test.ts"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
        JSON.stringify({
          type: "result",
          result: "Created src/__tests__/dup.test.ts",
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toEqual(["src/__tests__/dup.test.ts"])
    })

    it("assembles file_path from fragmented input_json_delta chunks", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: 'path": "/work/src/__tests__/frag.test.ts"',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: ', "content": "test code"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toContain("/work/src/__tests__/frag.test.ts")
    })

    it("ignores tool_use events for non Write/Edit tools", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Read" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/read.test.ts"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toEqual([])
    })

    it("tool_use extraction works even when result text has no file paths", () => {
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "Write" },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path": "/work/src/__tests__/solo.test.ts", "content": "code"}',
            },
          },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
        JSON.stringify({
          type: "result",
          result: "Done. All tests generated successfully.",
        }),
      ].join("\n")

      const files = parseTesterOutput(lines)
      expect(files).toContain("/work/src/__tests__/solo.test.ts")
      expect(files).toHaveLength(1)
    })
  })
})
