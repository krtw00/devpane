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
    TESTER_TIMEOUT_MS: 5_000,
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

describe("tester stderr accumulation", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("logs accumulated stderr via appendLog on normal exit", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-1")

    // Emit stderr data
    fakeProc.stderr!.emit("data", Buffer.from("warning: something\n"))
    fakeProc.stderr!.emit("data", Buffer.from("error: failed\n"))

    // Process exits normally
    fakeProc._emit("close", 1)
    const result = await promise

    expect(result.exit_code).toBe(1)

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    expect(stderrCall![2]).toContain("warning: something")
    expect(stderrCall![2]).toContain("error: failed")
  })

  it("does not log stderr if no stderr output was produced", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-2")

    // Process exits without any stderr
    fakeProc._emit("close", 0)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeUndefined()
  })

  it("includes stderr in timeout log", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-3")

    // Emit stderr
    fakeProc.stderr!.emit("data", Buffer.from("debug info\n"))

    // Trigger timeout
    vi.advanceTimersByTime(5_000 + 30_000)

    fakeProc._emit("close", 143)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    // Should have both the timeout log and the stderr log
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("debug info"))
    expect(stderrCall).toBeDefined()
  })

  it("truncates stderr buffer at 10KB", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-4")

    // Emit more than 10KB of stderr data
    const largeChunk = "x".repeat(6_000)
    fakeProc.stderr!.emit("data", Buffer.from(largeChunk))
    fakeProc.stderr!.emit("data", Buffer.from(largeChunk))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    // The logged stderr content should be at most ~10KB
    const loggedStderr = stderrCall![2]
    expect(loggedStderr.length).toBeLessThanOrEqual(10_240 + 50) // 10KB + prefix overhead
  })

  it("uses taskId in stderr appendLog call", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const taskId = "task-stderr-id"
    const promise = runTester(spec, "/tmp/worktree", taskId)

    fakeProc.stderr!.emit("data", Buffer.from("some error\n"))
    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()
    expect(stderrCall![0]).toBe(taskId)
    expect(stderrCall![1]).toBe("tester")
  })
})
