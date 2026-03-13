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

vi.mock("../config.js", () => ({
  config: {
    WORKER_TIMEOUT_MS: 5_000,
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

const spec = {
  tasks: [{ title: "t", description: "d", priority: 1 }],
  reasoning: "r",
}

describe("tester timeout appendLog uses task ID", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("passes taskId (not 'tester') as the first argument to appendLog on timeout", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const taskId = "task-xyz-789"
    const promise = runTester(spec, "/tmp/worktree", taskId)

    // Advance past idle timeout (WORKER_TIMEOUT_MS + idleCheck interval)
    vi.advanceTimersByTime(5_000 + 30_000)

    expect(appendLog).toHaveBeenCalledWith(
      taskId,
      "tester",
      expect.stringContaining("timeout"),
    )

    // First arg must NOT be the hardcoded string 'tester'
    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const timeoutCall = calls.find((c: string[]) => String(c[2]).includes("timeout"))
    expect(timeoutCall).toBeDefined()
    expect(timeoutCall![0]).toBe(taskId)
    expect(timeoutCall![0]).not.toBe("tester")

    fakeProc._emit("close", 143)
    await promise
  })

  it("falls back to a non-empty identifier when taskId is not provided", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree")

    // Advance past idle timeout
    vi.advanceTimersByTime(5_000 + 30_000)

    expect(appendLog).toHaveBeenCalled()
    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const timeoutCall = calls.find((c: string[]) => String(c[2]).includes("timeout"))
    expect(timeoutCall).toBeDefined()
    // First arg should be some string (fallback), not undefined
    expect(typeof timeoutCall![0]).toBe("string")
    expect(timeoutCall![0].length).toBeGreaterThan(0)

    fakeProc._emit("close", 143)
    await promise
  })
})
