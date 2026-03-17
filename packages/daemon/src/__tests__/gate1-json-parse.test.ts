import { describe, it, expect, vi, beforeEach } from "vitest"
import { runGate1 } from "../gate1.js"
import { initDb, closeDb } from "../db.js"
import type { Task } from "@devpane/shared"

const mockCallLlm = vi.fn()
vi.mock("../llm-bridge.js", () => ({
  callLlm: (...args: unknown[]) => mockCallLlm(...args),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../discord.js", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-json-parse",
    title: "JSON抽出テスト用タスク",
    description: "テスト機能を実装する。具体的にはXXXを追加してYYYを修正する。",
    constraints: null,
    status: "pending",
    priority: 5,
    parent_id: null,
    assigned_to: null,
    created_by: "pm",
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    cost_usd: 0,
    tokens_used: 0,
    retry_count: 0,
    ...overrides,
  }
}

describe("Gate1 JSON parse", () => {
  beforeEach(() => {
    closeDb()
    initDb(":memory:")
    mockCallLlm.mockReset()
  })

  it("正常なJSONを正しくパースする", async () => {
    mockCallLlm.mockResolvedValue({
      text: '{"verdict": "go", "reason": "タスクは有用です"}',
      cost_usd: 0,
      tokens_used: 0,
    })

    const result = await runGate1(makeTask())
    expect(result.verdict).toBe("go")
  })

  it("複数JSONブロックがある場合、最初のオブジェクトのみを抽出する", async () => {
    mockCallLlm.mockResolvedValue({
      text: '{"verdict": "go", "reason": "ok"} some text {"extra": "data"}',
      cost_usd: 0,
      tokens_used: 0,
    })

    const result = await runGate1(makeTask())
    expect(result.verdict).toBe("go")
  })

  it("パース不能な出力で recycle を返す", async () => {
    mockCallLlm.mockResolvedValue({
      text: "no json here at all",
      cost_usd: 0,
      tokens_used: 0,
    })

    const result = await runGate1(makeTask())
    expect(result.verdict).toBe("recycle")
    expect(result.reasons[0]).toMatch(/not parseable/)
  })
})
