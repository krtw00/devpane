import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import type { ChildProcess } from "node:child_process"

// Mock dependencies
vi.mock("../db.js", () => ({
  appendLog: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    WORKER_TIMEOUT_MS: 5_000, // short timeout for tests
  },
}))

// Create a fake ChildProcess that we can control
function createFakeProc(): ChildProcess & { _emit: (event: string, ...args: unknown[]) => void } {
  const proc = new EventEmitter() as ChildProcess & { _emit: (event: string, ...args: unknown[]) => void }
  proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"]
  proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"]
  proc.pid = 12345
  proc.killed = false
  proc.kill = vi.fn((signal?: string) => {
    if (signal === "SIGKILL" || signal === "SIGTERM") {
      // Default: SIGTERM doesn't kill, SIGKILL does
    }
    return true
  })
  proc._emit = proc.emit.bind(proc)
  return proc
}

let fakeProc: ReturnType<typeof createFakeProc>

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => fakeProc),
}))

describe("worker timeout SIGKILL fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("sends SIGKILL after 5s if SIGTERM did not kill the process", async () => {
    const { runWorker } = await import("../worker.js")

    const task = { id: "task-001", title: "t", description: "d", status: "running" as const, created_by: "pm" as const, created_at: "", updated_at: "" }
    const promise = runWorker(task, "/tmp/worktree")

    // Advance past idle timeout to trigger SIGTERM
    vi.advanceTimersByTime(5_000 + 30_000)

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM")

    // Process is still alive (killed remains false)
    ;(fakeProc as { killed: boolean }).killed = false

    // Advance 5s for SIGKILL fallback
    vi.advanceTimersByTime(5_000)

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL")

    // Simulate process finally closing
    fakeProc._emit("close", 137)
    const result = await promise

    expect(result.exit_code).toBe(137)
  })

  it("does not send SIGKILL if SIGTERM successfully killed the process", async () => {
    const { runWorker } = await import("../worker.js")

    const task = { id: "task-002", title: "t", description: "d", status: "running" as const, created_by: "pm" as const, created_at: "", updated_at: "" }
    const promise = runWorker(task, "/tmp/worktree")

    // Advance past idle timeout to trigger SIGTERM
    vi.advanceTimersByTime(5_000 + 30_000)

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM")

    // Process died from SIGTERM
    ;(fakeProc as { killed: boolean }).killed = true
    fakeProc._emit("close", 143)
    const result = await promise

    // SIGKILL should never have been called
    expect(fakeProc.kill).not.toHaveBeenCalledWith("SIGKILL")
    expect(result.exit_code).toBe(143)
  })

  it("emits a task.failed event with rootCause 'timeout' on timeout", async () => {
    const { emit } = await import("../events.js")
    const { runWorker } = await import("../worker.js")

    const task = { id: "task-003", title: "t", description: "d", status: "running" as const, created_by: "pm" as const, created_at: "", updated_at: "" }
    const promise = runWorker(task, "/tmp/worktree")

    // Advance past idle timeout
    vi.advanceTimersByTime(5_000 + 30_000)

    // Simulate process closing after timeout
    fakeProc._emit("close", 143)
    await promise

    expect(emit).toHaveBeenCalledWith({
      type: "task.failed",
      taskId: "task-003",
      rootCause: "timeout",
    })
  })
})
