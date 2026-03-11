import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { initDb, closeDb, createTask, startTask, finishTask } from "../db.js"
import { updateClaudeMd } from "../claude-md.js"
import type { ObservableFacts } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function makeFacts(overrides: Partial<ObservableFacts> = {}): ObservableFacts {
  return {
    exit_code: 0,
    files_changed: ["src/foo.ts"],
    diff_stats: { additions: 10, deletions: 2 },
    branch: "devpane/task-test",
    commit_hash: "abc123",
    ...overrides,
  }
}

describe("updateClaudeMd", () => {
  let tmpDir: string
  let claudeMdPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-md-test-"))
    claudeMdPath = join(tmpDir, "CLAUDE.md")
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes done, failed, and queue sections", () => {
    writeFileSync(claudeMdPath, "# DevPane\n\nSome intro text.\n\n## 設計方針\n\n- point 1\n", "utf-8")

    const t1 = createTask("Feature A", "desc", "pm", 1)
    startTask(t1.id, "worker-0")
    finishTask(t1.id, "done", JSON.stringify(makeFacts()))

    const t2 = createTask("Feature B", "desc", "pm", 1)
    startTask(t2.id, "worker-0")
    finishTask(t2.id, "failed", JSON.stringify({ ...makeFacts({ exit_code: 1 }), gate3: { reasons: ["tests failed"] } }))

    createTask("Feature C", "desc", "pm", 3)

    updateClaudeMd(claudeMdPath)

    const result = readFileSync(claudeMdPath, "utf-8")
    expect(result).toContain("# DevPane")
    expect(result).toContain("Some intro text.")
    expect(result).toContain("## 設計方針")
    expect(result).toContain("- point 1")

    expect(result).toContain("## 直近の完了タスク")
    expect(result).toContain("Feature A")
    expect(result).toContain("+10/-2")

    expect(result).toContain("## 失敗タスク")
    expect(result).toContain("Feature B")
    expect(result).toContain("tests failed")

    expect(result).toContain("## 現在のキュー")
    expect(result).toContain("Feature C")
    expect(result).toContain("[priority: 3]")
  })

  it("shows なし when no tasks exist", () => {
    writeFileSync(claudeMdPath, "# DevPane\n", "utf-8")

    updateClaudeMd(claudeMdPath)

    const result = readFileSync(claudeMdPath, "utf-8")
    expect(result).toContain("## 直近の完了タスク")
    expect(result).toContain("なし")
    expect(result).toContain("## 失敗タスク")
    expect(result).toContain("## 現在のキュー")
  })

  it("replaces managed sections on repeated calls", () => {
    writeFileSync(claudeMdPath, "# DevPane\n\n## 設計方針\n\n- point\n", "utf-8")

    updateClaudeMd(claudeMdPath)

    const t = createTask("New Feature", "desc", "pm", 1)
    startTask(t.id, "worker-0")
    finishTask(t.id, "done", JSON.stringify(makeFacts()))

    updateClaudeMd(claudeMdPath)

    const result = readFileSync(claudeMdPath, "utf-8")
    const doneCount = (result.match(/## 直近の完了タスク/g) ?? []).length
    const failedCount = (result.match(/## 失敗タスク/g) ?? []).length
    const queueCount = (result.match(/## 現在のキュー/g) ?? []).length
    expect(doneCount).toBe(1)
    expect(failedCount).toBe(1)
    expect(queueCount).toBe(1)

    expect(result).toContain("New Feature")
    expect(result).toContain("## 設計方針")
  })

  it("skips if CLAUDE.md does not exist", () => {
    expect(() => updateClaudeMd(join(tmpDir, "nonexistent.md"))).not.toThrow()
  })
})
