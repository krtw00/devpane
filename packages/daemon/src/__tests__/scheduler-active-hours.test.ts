import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- モック設定 ---

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: vi.fn(() => true),
    getState: vi.fn(() => "closed"),
    getBackoffSec: vi.fn(() => 1),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../db.js", () => ({
  getNextPending: vi.fn(() => null),
  getTasksByStatus: vi.fn(() => []),
  startTask: vi.fn(),
  finishTask: vi.fn(),
  revertToPending: vi.fn(),
  requeueTask: vi.fn(),
  getRetryCount: vi.fn(() => 0),
  appendLog: vi.fn(),
  updateTaskCost: vi.fn(),
  insertAgentEvent: vi.fn(),
  getAgentEvents: vi.fn(() => []),
  getDb: vi.fn(),
}))

vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pullMain: vi.fn(),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(),
}))

vi.mock("../facts.js", () => ({
  collectFacts: vi.fn(),
}))

vi.mock("../gate1.js", () => ({
  runGate1: vi.fn(),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(),
}))

vi.mock("../gate.js", () => ({
  runGate3: vi.fn(),
}))

vi.mock("../tester.js", () => ({
  runTester: vi.fn(),
}))

vi.mock("../pr-agent.js", () => ({
  runPrAgent: vi.fn(),
}))

vi.mock("../scheduler-hooks.js", () => ({
  runHooks: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
}))

vi.mock("../scheduler-plugins.js", () => ({
  EFFECT_MEASURE_THRESHOLD: 5,
  checkEffectMeasurement: vi.fn(),
  resetEffectMeasureCounter: vi.fn(),
  setEffectMeasureCounter: vi.fn(),
  getEffectMeasureCounter: vi.fn(() => 0),
  KAIZEN_THRESHOLD: 10,
  checkKaizenAnalysis: vi.fn(),
  resetKaizenCounter: vi.fn(),
  setKaizenCounter: vi.fn(),
  getKaizenCounter: vi.fn(() => 0),
}))

vi.mock("../discord.js", () => ({
  notify: vi.fn(() => Promise.resolve()),
}))

// config モック: ACTIVE_HOURS をテストごとに差し替え可能にする
const mockConfig = {
  PROJECT_ROOT: "/tmp",
  WORKER_TIMEOUT_MS: 600000,
  PM_TIMEOUT_MS: 300000,
  IDLE_INTERVAL_SEC: 60,
  PM_RETRY_INTERVAL_SEC: 30,
  COOLDOWN_INTERVAL_SEC: 300,
  WORKER_CONCURRENCY: 1,
  DB_PATH: "/tmp/test.db",
  API_PORT: 3001,
  MAX_RETRIES: 2,
  MAX_DIFF_SIZE: 500,
  MAX_OPEN_PRS: 1,
  ACTIVE_HOURS: null as { start: number; end: number } | null,
}

vi.mock("../config.js", () => ({
  config: mockConfig,
}))

/** スケジューラを1ループ分回してから停止するヘルパー。
 *  IDLE_INTERVAL_SEC のスリープも含めて十分タイマーを進める。 */
async function runOneIteration(
  startScheduler: () => Promise<void>,
  stopScheduler: () => Promise<void>,
): Promise<void> {
  const schedulerPromise = startScheduler()
  // callPm → sleep(IDLE_INTERVAL_SEC*1000) を通過するのに十分な時間を進める
  await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
  await stopScheduler()
  // ループ終了の sleep(1000) + dailyReportTimer 解消
  await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
  await schedulerPromise
}

describe("startScheduler: ACTIVE_HOURS統合", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
  })

  afterEach(async () => {
    // 安全にスケジューラを止める
    try {
      const { stopScheduler } = await import("../scheduler.js")
      await stopScheduler()
    } catch { /* ignore */ }
    vi.useRealTimers()
  })

  it("ACTIVE_HOURS未設定なら通常通りタスク取得を試みる", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    mockConfig.ACTIVE_HOURS = null

    await runOneIteration(startScheduler, stopScheduler)

    // ACTIVE_HOURS未設定 → getNextPendingが呼ばれる（タスク取得を試みた）
    expect(getNextPending).toHaveBeenCalled()
  }, 15000)

  it("時間外ではタスク取得をスキップしIDLE_INTERVAL_SEC待機する", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // 09-17 の設定で、現在時刻を20時にする → 時間外
    mockConfig.ACTIVE_HOURS = { start: 9, end: 17 }
    vi.setSystemTime(new Date(2026, 2, 13, 20, 0, 0))

    await runOneIteration(startScheduler, stopScheduler)

    // 時間外 → getNextPendingは呼ばれない
    expect(getNextPending).not.toHaveBeenCalled()
  }, 15000)

  it("時間外ではscheduler.outside_hoursイベントを発行する", async () => {
    const { emit } = await import("../events.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    mockConfig.ACTIVE_HOURS = { start: 9, end: 17 }
    vi.setSystemTime(new Date(2026, 2, 13, 20, 0, 0))

    await runOneIteration(startScheduler, stopScheduler)

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scheduler.outside_hours" }),
    )
  }, 15000)

  it("時間内なら通常通りタスク取得を試みる", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // 09-17 の設定で、現在時刻を12時にする → 時間内
    mockConfig.ACTIVE_HOURS = { start: 9, end: 17 }
    vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0))

    await runOneIteration(startScheduler, stopScheduler)

    // 時間内 → getNextPendingが呼ばれる
    expect(getNextPending).toHaveBeenCalled()
  }, 15000)

  it("日跨ぎ（22-08）: 23時は時間内としてタスク取得を試みる", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    mockConfig.ACTIVE_HOURS = { start: 22, end: 8 }
    vi.setSystemTime(new Date(2026, 2, 13, 23, 0, 0))

    await runOneIteration(startScheduler, stopScheduler)

    expect(getNextPending).toHaveBeenCalled()
  }, 15000)

  it("日跨ぎ（22-08）: 12時は時間外としてスキップする", async () => {
    const { getNextPending } = await import("../db.js")
    const { emit } = await import("../events.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    mockConfig.ACTIVE_HOURS = { start: 22, end: 8 }
    vi.setSystemTime(new Date(2026, 2, 13, 12, 0, 0))

    await runOneIteration(startScheduler, stopScheduler)

    expect(getNextPending).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scheduler.outside_hours" }),
    )
  }, 15000)
})
