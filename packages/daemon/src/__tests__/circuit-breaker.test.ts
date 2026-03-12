import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

import { CircuitBreaker } from "../circuit-breaker.js"
import { emit } from "../events.js"

describe("CircuitBreaker", () => {
  let now: number
  let cb: CircuitBreaker

  beforeEach(() => {
    vi.clearAllMocks()
    now = 0
    cb = new CircuitBreaker(3, 300, 3600, () => now)
  })

  it("starts in closed state", () => {
    expect(cb.getState()).toBe("closed")
    expect(cb.canProceed()).toBe(true)
  })

  it("stays closed on fewer failures than threshold", () => {
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe("closed")
    expect(cb.canProceed()).toBe(true)
  })

  it("transitions to open after N consecutive failures", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe("open")
    expect(cb.canProceed()).toBe(false)
  })

  it("emits worker.rate_limited on state transition", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(emit).toHaveBeenCalledWith({ type: "worker.rate_limited", backoffSec: 300 })
  })

  it("transitions from open to half-open after backoff elapsed", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe("open")

    // advance time past backoff
    now = 300 * 1000
    expect(cb.getState()).toBe("half-open")
    expect(cb.canProceed()).toBe(true)
  })

  it("half-open → closed on success", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    now = 300 * 1000

    cb.canProceed() // triggers half-open
    cb.recordSuccess()
    expect(cb.getState()).toBe("closed")
    expect(cb.canProceed()).toBe(true)
  })

  it("half-open → open on failure with doubled backoff", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    now = 300 * 1000

    cb.canProceed() // triggers half-open
    cb.recordFailure()
    expect(cb.getState()).toBe("open")
    expect(cb.getBackoffSec()).toBe(600)
  })

  it("caps backoff at maxBackoff", () => {
    // open → half-open → fail (600s) → half-open → fail (1200s) → half-open → fail (2400→capped 3600s)
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure() // open, backoff=300

    now = 300 * 1000
    cb.canProceed()
    cb.recordFailure() // open, backoff=600

    now += 600 * 1000
    cb.canProceed()
    cb.recordFailure() // open, backoff=1200

    now += 1200 * 1000
    cb.canProceed()
    cb.recordFailure() // open, backoff=2400

    now += 2400 * 1000
    cb.canProceed()
    cb.recordFailure() // open, backoff=3600 (capped)

    expect(cb.getBackoffSec()).toBe(3600)
  })

  it("resets backoff on success", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure() // open, backoff=300

    now = 300 * 1000
    cb.canProceed()
    cb.recordFailure() // open, backoff=600

    now += 600 * 1000
    cb.canProceed()
    cb.recordSuccess() // closed, backoff reset

    expect(cb.getState()).toBe("closed")
    expect(cb.getBackoffSec()).toBe(300)
  })

  it("success in closed state resets failure count", () => {
    cb.recordFailure()
    cb.recordFailure()
    cb.recordSuccess()
    cb.recordFailure()
    cb.recordFailure()
    // only 2 failures after reset, should still be closed
    expect(cb.getState()).toBe("closed")
  })
})
