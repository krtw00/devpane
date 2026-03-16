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

const STDERR_MAX = 10_240

describe("tester stderr tail retention", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeProc = createFakeProc()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("retains the tail (last STDERR_MAX bytes) when stderr exceeds the limit", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-tail-1")

    // First chunk: fill with 'A' (head data that should be discarded)
    const headChunk = "A".repeat(STDERR_MAX)
    fakeProc.stderr!.emit("data", Buffer.from(headChunk))

    // Second chunk: tail data that should be retained
    const tailMarker = "TAIL_ERROR: the real crash reason\n"
    fakeProc.stderr!.emit("data", Buffer.from(tailMarker))

    fakeProc._emit("close", 1)
    const result = await promise

    expect(result.exit_code).toBe(1)

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()

    const logged = stderrCall![2]
    // Tail marker must be present (it was the last data written)
    expect(logged).toContain(tailMarker.trimEnd())
    // Head-only data must have been discarded
    expect(logged).not.toMatch(/^.*A{100}/)
  })

  it("retains exactly STDERR_MAX characters when data far exceeds the limit", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-tail-2")

    // Send 3x STDERR_MAX of data in multiple chunks
    for (let i = 0; i < 3; i++) {
      const chunk = String(i).repeat(STDERR_MAX)
      fakeProc.stderr!.emit("data", Buffer.from(chunk))
    }

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()

    // Extract the stderr content (strip "[stderr] " prefix)
    const logged = stderrCall![2]
    const stderrContent = logged.replace("[stderr] ", "")
    expect(stderrContent.length).toBeLessThanOrEqual(STDERR_MAX)
  })

  it("keeps the last chunk entirely when a single chunk exceeds the limit", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-tail-3")

    // Single large chunk: head is 'H', tail is 'T'
    const overflow = 500
    const data = "H".repeat(STDERR_MAX) + "T".repeat(overflow)
    fakeProc.stderr!.emit("data", Buffer.from(data))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()

    const logged = stderrCall![2]
    // Must contain the tail 'T' characters
    expect(logged).toContain("T".repeat(overflow))
    // Must end with the tail portion (after prefix)
    expect(logged).toMatch(/T{500}$/)
  })

  it("does not discard new chunks after the buffer is full (no early-exit guard)", async () => {
    const { appendLog } = await import("../db.js")
    const { runTester } = await import("../tester.js")

    const promise = runTester(spec, "/tmp/worktree", "task-tail-4")

    // Fill the buffer to exactly STDERR_MAX
    fakeProc.stderr!.emit("data", Buffer.from("X".repeat(STDERR_MAX)))

    // This chunk must NOT be ignored — it should replace the tail
    const lateChunk = "LATE_ERROR\n"
    fakeProc.stderr!.emit("data", Buffer.from(lateChunk))

    fakeProc._emit("close", 1)
    await promise

    const calls = vi.mocked(appendLog).mock.calls as string[][]
    const stderrCall = calls.find((c: string[]) => String(c[2]).includes("stderr"))
    expect(stderrCall).toBeDefined()

    // The late chunk must be present — this is the key behavioral difference
    // between head-retention (old) and tail-retention (new)
    expect(stderrCall![2]).toContain("LATE_ERROR")
  })
})
