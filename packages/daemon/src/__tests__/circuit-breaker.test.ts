import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

import { getState, trip, canProceed, remainingMs, recordSuccess, reset, getBackoffSec } from "../circuit-breaker.js"

describe("CircuitBreaker", () => {
  beforeEach(() => {
    reset()
  })

  it("starts in closed state", () => {
    expect(getState()).toBe("closed")
    expect(canProceed()).toBe(true)
    expect(remainingMs()).toBe(0)
  })

  it("transitions to open on trip()", () => {
    trip()
    expect(getState()).toBe("open")
    expect(canProceed()).toBe(false)
    expect(getBackoffSec()).toBe(60)
  })

  it("escalates backoff on consecutive trips", () => {
    trip()
    expect(getBackoffSec()).toBe(60)
    reset()

    trip()
    trip()
    expect(getBackoffSec()).toBe(120)

    trip()
    expect(getBackoffSec()).toBe(300)

    trip()
    expect(getBackoffSec()).toBe(600)

    trip()
    expect(getBackoffSec()).toBe(600) // capped
  })

  it("transitions to half-open after backoff expires", () => {
    vi.useFakeTimers()
    try {
      trip()
      expect(canProceed()).toBe(false)

      vi.advanceTimersByTime(60_000)
      expect(canProceed()).toBe(true)
      expect(getState()).toBe("half-open")
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns to closed on recordSuccess()", () => {
    trip()
    expect(getState()).toBe("open")

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(60_000)
      canProceed() // triggers half-open
      recordSuccess()
      expect(getState()).toBe("closed")
      expect(canProceed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("remainingMs returns correct wait time", () => {
    vi.useFakeTimers()
    try {
      trip()
      expect(remainingMs()).toBe(60_000)

      vi.advanceTimersByTime(30_000)
      expect(remainingMs()).toBe(30_000)

      vi.advanceTimersByTime(30_000)
      expect(remainingMs()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
