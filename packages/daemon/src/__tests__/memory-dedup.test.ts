import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb } from "../db.js"
import { remember, recall } from "../memory.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("remember() deduplication", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("同一category+contentで2回呼んでもレコードは1件", () => {
    remember("lesson", "テスト失敗時はログを確認する")
    remember("lesson", "テスト失敗時はログを確認する")

    const all = recall("lesson")
    expect(all).toHaveLength(1)
  })

  it("異なるcontentでは別レコードが作成される", () => {
    remember("lesson", "教訓A")
    remember("lesson", "教訓B")

    const all = recall("lesson")
    expect(all).toHaveLength(2)
  })

  it("異なるcategoryで同一contentなら別レコードが作成される", () => {
    remember("lesson", "共通の知見")
    remember("decision", "共通の知見")

    const lessons = recall("lesson")
    const decisions = recall("decision")
    expect(lessons).toHaveLength(1)
    expect(decisions).toHaveLength(1)
  })

  it("重複時にupdated_atが更新される", () => {
    const first = remember("lesson", "更新テスト")

    // 時刻を少しずらすためにDateをモック
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 10_000)

    const second = remember("lesson", "更新テスト")

    vi.useRealTimers()

    expect(second.id).toBe(first.id)
    expect(second.updated_at).not.toBe(first.updated_at)
    expect(second.updated_at > first.updated_at).toBe(true)
  })

  it("重複時にidとcreated_atは変わらない", () => {
    const first = remember("lesson", "ID保持テスト")

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 10_000)

    const second = remember("lesson", "ID保持テスト")

    vi.useRealTimers()

    expect(second.id).toBe(first.id)
    expect(second.created_at).toBe(first.created_at)
  })

  it("重複時にsource_task_idは元の値を保持する", () => {
    const first = remember("lesson", "ソースID保持", "task-001")
    const second = remember("lesson", "ソースID保持", "task-002")

    expect(second.id).toBe(first.id)
    expect(second.source_task_id).toBe(first.source_task_id)
  })

  it("DBに実際に1件しか存在しない", () => {
    remember("lesson", "DB確認テスト")
    remember("lesson", "DB確認テスト")
    remember("lesson", "DB確認テスト")

    const db = getDb()
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM memories WHERE category = ? AND content = ?`,
    ).get("lesson", "DB確認テスト") as { cnt: number }
    expect(row.cnt).toBe(1)
  })
})
