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

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
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

const makeTask = (id: string) => ({
  id,
  title: "t",
  description: "d",
  constraints: null,
  status: "running" as const,
  priority: 0,
  parent_id: null,
  created_by: "pm" as const,
  assigned_to: null,
  created_at: "",
  started_at: null,
  finished_at: null,
  result: null,
  cost_usd: 0,
  tokens_used: 0,
  retry_count: 0,
})

describe("worker proc.on('error') resource cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("removes proc from activeProcs on error", async () => {
    const { runWorker, killAllWorkers } = await import("../worker.js")

    const promise = runWorker(makeTask("err-001"), "/tmp/worktree")

    // Emit error on the process
    fakeProc._emit("error", new Error("spawn ENOENT"))

    await expect(promise).rejects.toThrow("spawn ENOENT")

    // After error, killAllWorkers should have nothing to kill
    // (activeProcs should be empty)
    killAllWorkers()
    expect(fakeProc.kill).not.toHaveBeenCalledWith("SIGTERM")
  })

  it("clears idleCheck interval on error", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")
    const { runWorker } = await import("../worker.js")

    const promise = runWorker(makeTask("err-002"), "/tmp/worktree")

    fakeProc._emit("error", new Error("spawn ENOENT"))
    await expect(promise).rejects.toThrow("spawn ENOENT")

    // idleCheck should have been cleared
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it("clears sigkillCheck interval on error after timeout", async () => {
    const { runWorker } = await import("../worker.js")

    const promise = runWorker(makeTask("err-003"), "/tmp/worktree")

    // Trigger idle timeout first to create sigkillCheck
    vi.advanceTimersByTime(5_000 + 30_000)
    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM")

    // Reset kill mock to isolate subsequent calls
    vi.mocked(fakeProc.kill).mockClear()

    // Now emit error
    fakeProc._emit("error", new Error("process error after timeout"))
    await expect(promise).rejects.toThrow("process error after timeout")

    // Advance past sigkillCheck interval (5s polling at 1s)
    // If sigkillCheck was NOT cleared, it would fire and call SIGKILL
    vi.advanceTimersByTime(10_000)

    expect(fakeProc.kill).not.toHaveBeenCalledWith("SIGKILL")
  })

  it("does not leak timers when error fires before any timeout", async () => {
    const { runWorker } = await import("../worker.js")

    const promise = runWorker(makeTask("err-004"), "/tmp/worktree")

    // Error fires immediately
    fakeProc._emit("error", new Error("immediate failure"))
    await expect(promise).rejects.toThrow("immediate failure")

    // Advancing timers should not cause any unhandled operations
    // (no lingering intervals trying to check idle or send SIGKILL)
    vi.advanceTimersByTime(60_000)

    // If timers were leaked, kill would have been called by idleCheck
    expect(fakeProc.kill).not.toHaveBeenCalled()
  })
})

describe("tester proc.on('error') resource cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("removes proc from activeProcs on error", async () => {
    const { runTester, killAllTesters } = await import("../tester.js")

    const spec = {
      reasoning: "test",
      tasks: [{ title: "t", description: "d", priority: 0 }],
    }

    const promise = runTester(spec, "/tmp/worktree")

    fakeProc._emit("error", new Error("spawn ENOENT"))
    await expect(promise).rejects.toThrow("spawn ENOENT")

    // activeProcs should be empty
    killAllTesters()
    expect(fakeProc.kill).not.toHaveBeenCalledWith("SIGTERM")
  })

  it("clears idleCheck interval on error", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")
    const { runTester } = await import("../tester.js")

    const spec = {
      reasoning: "test",
      tasks: [{ title: "t", description: "d", priority: 0 }],
    }

    const promise = runTester(spec, "/tmp/worktree")

    fakeProc._emit("error", new Error("spawn ENOENT"))
    await expect(promise).rejects.toThrow("spawn ENOENT")

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it("does not leak timers when error fires before any timeout", async () => {
    const { runTester } = await import("../tester.js")

    const spec = {
      reasoning: "test",
      tasks: [{ title: "t", description: "d", priority: 0 }],
    }

    const promise = runTester(spec, "/tmp/worktree")

    fakeProc._emit("error", new Error("immediate failure"))
    await expect(promise).rejects.toThrow("immediate failure")

    vi.advanceTimersByTime(60_000)
    expect(fakeProc.kill).not.toHaveBeenCalled()
  })
})
