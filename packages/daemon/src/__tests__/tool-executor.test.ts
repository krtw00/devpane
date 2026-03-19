import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { executeTool, getToolDefinitions } from "../tool-executor.js"

describe("getToolDefinitions", () => {
  it("returns 6 tool definitions", () => {
    const defs = getToolDefinitions()
    expect(defs).toHaveLength(6)
    const names = defs.map((d) => d.function.name)
    expect(names).toContain("read_file")
    expect(names).toContain("edit_file")
    expect(names).toContain("write_file")
    expect(names).toContain("bash")
    expect(names).toContain("glob_files")
    expect(names).toContain("grep_files")
  })
})

describe("executeTool", () => {
  let tmpDir: string

  function setup(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "tool-test-"))
    return tmpDir
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe("read_file", () => {
    it("reads file content", () => {
      const root = setup()
      writeFileSync(join(root, "hello.txt"), "hello world")
      const result = executeTool("read_file", { path: "hello.txt" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output).toBe("hello world")
    })

    it("returns error for nonexistent file", () => {
      const root = setup()
      const result = executeTool("read_file", { path: "nonexistent.txt" }, root)
      expect(result.is_error).toBe(true)
    })

    it("blocks path traversal", () => {
      const root = setup()
      const result = executeTool("read_file", { path: "../../etc/passwd" }, root)
      expect(result.is_error).toBe(true)
      expect(result.output).toContain("path traversal")
    })
  })

  describe("edit_file", () => {
    it("replaces string in file", () => {
      const root = setup()
      writeFileSync(join(root, "file.txt"), "foo bar baz")
      const result = executeTool("edit_file", { path: "file.txt", old_string: "bar", new_string: "qux" }, root)
      expect(result.is_error).toBe(false)
      expect(readFileSync(join(root, "file.txt"), "utf-8")).toBe("foo qux baz")
    })

    it("returns error when old_string not found", () => {
      const root = setup()
      writeFileSync(join(root, "file.txt"), "foo bar baz")
      const result = executeTool("edit_file", { path: "file.txt", old_string: "notfound", new_string: "x" }, root)
      expect(result.is_error).toBe(true)
      expect(result.output).toContain("old_string not found")
    })
  })

  describe("write_file", () => {
    it("writes new file", () => {
      const root = setup()
      const result = executeTool("write_file", { path: "new.txt", content: "new content" }, root)
      expect(result.is_error).toBe(false)
      expect(readFileSync(join(root, "new.txt"), "utf-8")).toBe("new content")
    })

    it("creates parent directories", () => {
      const root = setup()
      const result = executeTool("write_file", { path: "sub/dir/file.txt", content: "nested" }, root)
      expect(result.is_error).toBe(false)
      expect(readFileSync(join(root, "sub/dir/file.txt"), "utf-8")).toBe("nested")
    })
  })

  describe("bash", () => {
    it("executes command and returns stdout", () => {
      const root = setup()
      const result = executeTool("bash", { command: "echo hello" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output.trim()).toBe("hello")
    })

    it("returns is_error=true for non-zero exit", () => {
      const root = setup()
      const result = executeTool("bash", { command: "exit 1" }, root)
      expect(result.is_error).toBe(true)
    })

    it("truncates very long command output", () => {
      const root = setup()
      const result = executeTool("bash", { command: "python3 - <<'PY'\nprint('x' * 15000)\nPY" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output.length).toBeLessThan(13_000)
      expect(result.output).toContain("[output truncated; rerun with a narrower command")
    })
  })

  describe("glob_files", () => {
    it("finds matching files", () => {
      const root = setup()
      mkdirSync(join(root, "src"), { recursive: true })
      writeFileSync(join(root, "src/a.ts"), "")
      writeFileSync(join(root, "src/b.js"), "")
      writeFileSync(join(root, "readme.md"), "")
      const result = executeTool("glob_files", { pattern: "src/*.ts" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output).toContain("src/a.ts")
      expect(result.output).not.toContain("b.js")
    })
  })

  describe("grep_files", () => {
    it("finds matching content", () => {
      const root = setup()
      writeFileSync(join(root, "test.ts"), 'const x = "hello"\n')
      const result = executeTool("grep_files", { pattern: "hello" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output).toContain("hello")
    })

    it("returns no matches message when nothing found", () => {
      const root = setup()
      writeFileSync(join(root, "test.ts"), "const x = 1\n")
      const result = executeTool("grep_files", { pattern: "nonexistent_string_xyz" }, root)
      expect(result.is_error).toBe(false)
      expect(result.output).toContain("No matches")
    })
  })

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const root = setup()
      const result = executeTool("unknown_tool", {}, root)
      expect(result.is_error).toBe(true)
      expect(result.output).toContain("Unknown tool")
    })
  })
})
