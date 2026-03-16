import { config } from "./config.js"
import { emit } from "./events.js"

export type CircuitState = "closed" | "open" | "half-open"

export class CircuitBreaker {
  private state: CircuitState = "closed"
  private failures = 0
  private openedAt = 0
  private currentBackoff: number

  constructor(
    private readonly threshold = config.CB_THRESHOLD,
    private readonly initialBackoff = config.CB_BACKOFF_SEC,
    private readonly maxBackoff = config.CB_MAX_BACKOFF_SEC,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.currentBackoff = initialBackoff
  }

  getState(): CircuitState {
    this.maybeTransition()
    return this.state
  }

  getBackoffSec(): number {
    return this.currentBackoff
  }

  canProceed(): boolean {
    this.maybeTransition()
    if (this.state === "closed") return true
    if (this.state === "half-open") return true
    return false
  }

  recordSuccess(): void {
    if (this.state === "half-open" || this.state === "closed") {
      this.failures = 0
      this.currentBackoff = this.initialBackoff
      if (this.state !== "closed") {
        this.transition("closed")
      }
    }
  }

  recordFailure(): void {
    this.failures++
    if (this.state === "half-open") {
      this.currentBackoff = Math.min(this.currentBackoff * 2, this.maxBackoff)
      this.transition("open")
      return
    }
    if (this.state === "closed" && this.failures >= this.threshold) {
      this.transition("open")
    }
  }

  reset(): void {
    this.state = "closed"
    this.failures = 0
    this.currentBackoff = this.initialBackoff
    this.openedAt = 0
  }

  private maybeTransition(): void {
    if (this.state === "open" && this.clock() >= this.openedAt + this.currentBackoff * 1000) {
      this.transition("half-open")
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state
    this.state = to
    if (to === "open") {
      this.openedAt = this.clock()
    }
    if (to === "open") {
      emit({ type: "worker.rate_limited", backoffSec: this.currentBackoff })
    }
    console.log(`[circuit-breaker] ${from} → ${to} (backoff: ${this.currentBackoff}s)`)
  }
}

export const circuitBreaker = new CircuitBreaker()
