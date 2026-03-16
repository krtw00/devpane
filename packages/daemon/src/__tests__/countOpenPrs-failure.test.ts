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

const mockCountOpenPrs = vi.fn<() => number | null>()
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: () => mockCountOpenPrs(),
  pullMain: vi.fn(),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(),
  killAllWorkers: vi.fn(),
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
  buildTesterPrompt: vi.fn(() => "prompt"),
}))

vi.mock("../pr-agent.js", () => ({
  runPrAgent: vi.fn(),
}))

vi.mock("../scheduler-hooks.js", () => ({
  runHooks: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
  cleanupOldLessons: vi.fn(() => 0),
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
  parseConstraints: (raw: string | null) => { if (!raw) return []; try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.filter((s: unknown): s is string => typeof s === "string"); } catch {} return [] },
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
  checkAllMetrics: vi.fn(() => []),
  recordMetric: vi.fn(),
  checkMetric: vi.fn(),
}))

vi.mock("../morning-report.js", () => ({
  sendMorningReport: vi.fn(),
}))

vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(),
}))

vi.mock("../effect-measure.js", () => ({
  measureAllActive: vi.fn(() => []),
}))

vi.mock("../discord.js", () => ({
  notify: vi.fn(() => Promise.resolve()),
}))

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

async function runOneIteration(
  startScheduler: () => Promise<void>,
  stopScheduler: () => Promise<void>,
): Promise<void> {
  const schedulerPromise = startScheduler()
  await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
  await stopScheduler()
  await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
  await schedulerPromise
}

describe("countOpenPrs失敗時のWIP制限（安全側に倒す）", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
  })

  afterEach(async () => {
    try {
      const { stopScheduler } = await import("../scheduler.js")
      await stopScheduler()
    } catch { /* ignore */ }
    vi.useRealTimers()
  })

  it("countOpenPrsがnullを返す（gh CLI失敗）場合、タスク取得をスキップする", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // countOpenPrsがnullを返す = gh CLI失敗 → 安全側に倒してタスク開始しない
    mockCountOpenPrs.mockReturnValue(null)

    await runOneIteration(startScheduler, stopScheduler)

    // countOpenPrs失敗時はgetNextPendingが呼ばれない（タスク取得をスキップ）
    expect(getNextPending).not.toHaveBeenCalled()
  }, 15000)

  it("countOpenPrsが0を返す場合、通常通りタスク取得を試みる", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // countOpenPrsが0を返す = オープンPRなし → タスク実行可
    mockCountOpenPrs.mockReturnValue(0)

    await runOneIteration(startScheduler, stopScheduler)

    // WIP制限内なのでgetNextPendingが呼ばれる
    expect(getNextPending).toHaveBeenCalled()
  }, 15000)

  it("countOpenPrsがMAX_OPEN_PRS以上を返す場合、タスク取得をスキップする", async () => {
    const { getNextPending } = await import("../db.js")
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // countOpenPrsが1を返す = WIP上限到達（MAX_OPEN_PRS=1）
    mockCountOpenPrs.mockReturnValue(1)

    await runOneIteration(startScheduler, stopScheduler)

    // WIP上限到達でgetNextPendingは呼ばれない
    expect(getNextPending).not.toHaveBeenCalled()
  }, 15000)
})
