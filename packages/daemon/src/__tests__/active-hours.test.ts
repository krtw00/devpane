import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ActiveHours } from "@devpane/shared"

// parseActiveHours テスト: vi.importActual で config を動的importし環境変数ごとに検証
describe("parseActiveHours", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("未設定なら null を返す（24時間稼働）", async () => {
    delete process.env.ACTIVE_HOURS
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toBeNull()
  })

  it("'22-08' を { start: 22, end: 8 } にパースする", async () => {
    vi.stubEnv("ACTIVE_HOURS", "22-08")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toEqual({ start: 22, end: 8 })
  })

  it("'09-17' を { start: 9, end: 17 } にパースする", async () => {
    vi.stubEnv("ACTIVE_HOURS", "09-17")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toEqual({ start: 9, end: 17 })
  })

  it("'00-23' を { start: 0, end: 23 } にパースする", async () => {
    vi.stubEnv("ACTIVE_HOURS", "00-23")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toEqual({ start: 0, end: 23 })
  })

  it("不正な形式は null にフォールバックする", async () => {
    vi.stubEnv("ACTIVE_HOURS", "invalid")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toBeNull()
  })

  it("範囲外の時刻（25-08）は null にフォールバックする", async () => {
    vi.stubEnv("ACTIVE_HOURS", "25-08")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.ACTIVE_HOURS).toBeNull()
  })
})

// isWithinActiveHours テスト: vi.useFakeTimers で Date.now() をモック
// scheduler.js の副作用importを回避するためモックを設定
vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn(), canProceed: vi.fn(() => true), getState: vi.fn(() => "closed"), getBackoffSec: vi.fn(() => 1) },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>()
  return { ...actual, appendLog: vi.fn() }
})

describe("isWithinActiveHours", () => {
  let isWithinActiveHours: (hours: ActiveHours | null) => boolean

  beforeEach(async () => {
    vi.useFakeTimers()
    const mod = await import("../scheduler.js")
    isWithinActiveHours = mod.isWithinActiveHours
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("null なら常に true（24時間稼働）", () => {
    expect(isWithinActiveHours(null)).toBe(true)
  })

  // 日跨ぎケース: 22-08（22時〜翌8時）
  it("日跨ぎ（22-08）: 23時は時間内", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 23, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(true)
  })

  it("日跨ぎ（22-08）: 3時は時間内", () => {
    vi.setSystemTime(new Date(2026, 2, 14, 3, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(true)
  })

  it("日跨ぎ（22-08）: 22時ちょうどは時間内", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 22, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(true)
  })

  it("日跨ぎ（22-08）: 8時ちょうどは時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 14, 8, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(false)
  })

  it("日跨ぎ（22-08）: 12時は時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(false)
  })

  it("日跨ぎ（22-08）: 21時は時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 21, 0, 0))
    expect(isWithinActiveHours({ start: 22, end: 8 })).toBe(false)
  })

  // 日跨ぎなしケース: 09-17（9時〜17時）
  it("日跨ぎなし（09-17）: 12時は時間内", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0))
    expect(isWithinActiveHours({ start: 9, end: 17 })).toBe(true)
  })

  it("日跨ぎなし（09-17）: 9時ちょうどは時間内", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 9, 0, 0))
    expect(isWithinActiveHours({ start: 9, end: 17 })).toBe(true)
  })

  it("日跨ぎなし（09-17）: 17時ちょうどは時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 17, 0, 0))
    expect(isWithinActiveHours({ start: 9, end: 17 })).toBe(false)
  })

  it("日跨ぎなし（09-17）: 20時は時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 20, 0, 0))
    expect(isWithinActiveHours({ start: 9, end: 17 })).toBe(false)
  })

  it("同一時刻（00-00）は常に時間外", () => {
    vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0))
    expect(isWithinActiveHours({ start: 0, end: 0 })).toBe(false)
  })
})
