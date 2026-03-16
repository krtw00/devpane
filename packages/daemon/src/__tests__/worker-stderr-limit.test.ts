import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import type { ChildProcess } from "node:child_process"

vi.mock("../db.js", () => ({
  appendLog: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    WORKER_TIMEOUT_MS: 5_000,
    BUILD_CMD: "pnpm build",
    TEST_CMD: "pnpm test",
  },
}))

function createFakeProc(): ChildProcess & { _emit: (event: string, ...args: unknown[]) => void } {
  const proc = new EventEmitter() as ChildProcess & { _emit: (event: string, ...args: unknown[]) => void }
  proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"]
  proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"]
  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn(() => true)
  proc._emit = proc.emit.bind(proc)
  return proc
}

let fakeProc: ReturnType<typeof createFakeProc>

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => fakeProc),
}))

const task = {
  id: "task-stderr-limit",
  title: "t",
  description: "d",
  status: "running" as const,
  created_by: "pm" as const,
  created_at: "",
  updated_at: "",
}

describe("worker stderr buffer limit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("does not exceed 10KB when large stderr data is emitted", async () => {
    const { appendLog } = await import("../db.js")
    const { runWorker } = await import("../worker.js")

    const promise = runWorker(task, "/tmp/worktree")

    // Emit 12KB of stderr in two chunks (exceeds 10KB limit)
    const chunk = "x".repeat(6_000)
    fakeProc.stderr!.emit("data", Buffer.from(chunk))
    fakeProc.stderr!.emit("data", Buffer.from(chunk))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    // 10KB (10240) + "[stderr] " prefix overhead
    expect(stderrCall![2].length).toBeLessThanOrEqual(10_240 + 50)
  })

  it("retains the latest data when buffer overflows (tail, not head)", async () => {
    const { appendLog } = await import("../db.js")
    const { runWorker } = await import("../worker.js")

    const promise = runWorker({ ...task, id: "task-tail" }, "/tmp/worktree")

    // First chunk: 9KB of 'a'
    fakeProc.stderr!.emit("data", Buffer.from("a".repeat(9_000)))
    // Second chunk: 3KB of 'b' — pushes total over 10KB
    fakeProc.stderr!.emit("data", Buffer.from("b".repeat(3_000)))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    const logged = stderrCall![2]
    // The latest 'b' characters must be fully preserved
    expect(logged).toContain("b".repeat(3_000))
    // The early 'a' characters should be partially truncated
    expect(logged).not.toContain("a".repeat(9_000))
  })

  it("does not truncate when stderr is within limit", async () => {
    const { appendLog } = await import("../db.js")
    const { runWorker } = await import("../worker.js")

    const promise = runWorker({ ...task, id: "task-small" }, "/tmp/worktree")

    const smallData = "small error\n"
    fakeProc.stderr!.emit("data", Buffer.from(smallData))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    expect(stderrCall![2]).toContain("small error")
  })

  it("handles many small chunks accumulating beyond limit", async () => {
    const { appendLog } = await import("../db.js")
    const { runWorker } = await import("../worker.js")

    const promise = runWorker({ ...task, id: "task-many" }, "/tmp/worktree")

    // 200 chunks of 100 bytes = 20KB total
    for (let i = 0; i < 200; i++) {
      fakeProc.stderr!.emit("data", Buffer.from(`line-${String(i).padStart(4, "0")}${"z".repeat(90)}\n`))
    }

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    const logged = stderrCall![2]
    // Buffer content (excluding prefix) should be at most 10KB
    const content = logged.replace("[stderr] ", "")
    expect(content.length).toBeLessThanOrEqual(10_240)
    // Latest lines should be present
    expect(logged).toContain("line-0199")
  })
})
