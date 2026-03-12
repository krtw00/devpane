import { emit } from "./events.js"

export type CbState = "closed" | "open" | "half-open"

const BACKOFFS = [60, 120, 300, 600]

let state: CbState = "closed"
let failures = 0
let openedAt = 0
let currentBackoff = BACKOFFS[0]

function transition(to: CbState): void {
  if (state === to) return
  emit({ type: "cb.state_change", from: state, to })
  state = to
}

export function getState(): CbState {
  return state
}

export function getBackoffSec(): number {
  return currentBackoff
}

export function trip(): void {
  failures++
  const idx = Math.min(failures - 1, BACKOFFS.length - 1)
  currentBackoff = BACKOFFS[idx]
  openedAt = Date.now()
  transition("open")
  emit({ type: "cb.tripped", backoffSec: currentBackoff, consecutiveFailures: failures })
}

export function canProceed(): boolean {
  if (state === "closed") return true

  const elapsed = (Date.now() - openedAt) / 1000
  if (elapsed >= currentBackoff) {
    transition("half-open")
    return true
  }

  return false
}

export function remainingMs(): number {
  if (state === "closed") return 0
  const elapsed = Date.now() - openedAt
  return Math.max(0, currentBackoff * 1000 - elapsed)
}

export function recordSuccess(): void {
  if (failures > 0 || state !== "closed") {
    failures = 0
    currentBackoff = BACKOFFS[0]
    transition("closed")
  }
}

export function reset(): void {
  state = "closed"
  failures = 0
  openedAt = 0
  currentBackoff = BACKOFFS[0]
}
