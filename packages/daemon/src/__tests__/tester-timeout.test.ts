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
    TESTER_TIMEOUT_MS: 5_000, // short timeout for tests
  },
}))

// Create a fake ChildProcess that we can control
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

const spec = {
  tasks: [{ title: "t", description: "d", priority: 1 }],
  reasoning: "r",
}

describe("tester timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("logs timeout message via appendLog when idle timeout fires", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree")

    // Advance past idle timeout (WORKER_TIMEOUT_MS + idleCheck interval)
    vi.advanceTimersByTime(5_000 + 30_000)

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM")
    expect(appendLog).toHaveBeenCalledWith(
      expect.any(String),
      "tester",
      expect.stringContaining("timeout"),
    )

    fakeProc._emit("close", 143)
    await promise
  })

  it("emits task.failed event with rootCause 'timeout' on timeout", async () => {
    const { emit } = await import("../events.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "test-task-1")

    // Advance past idle timeout
    vi.advanceTimersByTime(5_000 + 30_000)

    // Simulate process closing after timeout
    fakeProc._emit("close", 143)
    await promise

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.failed",
        rootCause: "timeout",
      }),
    )
  })

  it("emits task.failed with the correct taskId (not hardcoded 'tester')", async () => {
    const { emit } = await import("../events.js")
    const { runTester } = await import("../tester.js")

    const taskId = "task-abc-123"
    const promise = runTester(spec, "/tmp/worktree", taskId)

    // Advance past idle timeout
    vi.advanceTimersByTime(5_000 + 30_000)

    // Simulate process closing after timeout
    fakeProc._emit("close", 143)
    await promise

    expect(emit).toHaveBeenCalledWith({
      type: "task.failed",
      taskId,
      rootCause: "timeout",
    })
  })

  it("sends SIGKILL after 5s if SIGTERM did not kill the process", async () => {
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree")

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
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree")

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

  it("clears SIGKILL interval when process closes", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree")

    // Advance past idle timeout to trigger SIGTERM
    vi.advanceTimersByTime(5_000 + 30_000)

    // Process closes before SIGKILL fires
    fakeProc._emit("close", 143)
    await promise

    // Both idleCheck and sigkillCheck intervals should be cleared
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
