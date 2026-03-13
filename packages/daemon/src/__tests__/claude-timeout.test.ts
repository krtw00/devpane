import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import type { ChildProcess } from "node:child_process"

vi.mock("../config.js", () => ({
  config: {
    PM_TIMEOUT_MS: 100,
  },
}))

function createFakeProc(): ChildProcess & { _emit: (event: string, ...args: unknown[]) => void } {
  const proc = new EventEmitter() as ChildProcess & { _emit: (event: string, ...args: unknown[]) => void }
  proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"]
  proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"]
  proc.stdin = { end: vi.fn() } as unknown as ChildProcess["stdin"]
  proc.pid = 99999
  proc.killed = false
  proc.kill = vi.fn(() => {
    proc.killed = true
    setTimeout(() => proc._emit("close", null, "SIGTERM"), 0)
    return true
  })
  proc._emit = proc.emit.bind(proc)
  return proc
}

let fakeProc: ReturnType<typeof createFakeProc>

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => fakeProc),
}))

describe("spawnClaude timeout flag", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("rejects with 'timeout' in message when killed by timeout", async () => {
    const { spawnClaude } = await import("../claude.js")

    const promise = spawnClaude(["--print", "hello"], "/tmp", 100)

    // Advance past timeout
    vi.advanceTimersByTime(150)
    // Let microtasks (setTimeout 0 in kill mock) flush
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).rejects.toThrow(/timeout/i)
    // Should NOT contain '?' — the message must be definitive
    await expect(promise).rejects.not.toThrow("timeout?")
  })

  it("rejects without 'timeout' when killed by external signal", async () => {
    const { spawnClaude } = await import("../claude.js")

    // Override kill to not auto-emit close (we control it manually)
    fakeProc.kill = vi.fn(() => true)

    const promise = spawnClaude(["--print", "hello"], "/tmp", 60_000)

    // Simulate external SIGTERM before timeout fires
    fakeProc._emit("close", null, "SIGTERM")

    const err = await promise.catch((e: unknown) => e) as Error
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/signal/i)
    expect((err as Error).message).not.toMatch(/timeout/i)
  })

  it("resolves normally when process exits with code 0", async () => {
    const { spawnClaude } = await import("../claude.js")

    // Override kill to not auto-emit
    fakeProc.kill = vi.fn(() => true)

    const promise = spawnClaude(["--print", "hello"], "/tmp", 60_000)

    fakeProc.stdout!.push("output data")
    fakeProc._emit("close", 0, null)

    await expect(promise).resolves.toBe("output data")
  })
})
