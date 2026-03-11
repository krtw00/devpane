import { getTasksByStatus } from "./db.js"

export const WIP_LIMIT = 5
export const JIDOKA_THRESHOLD = 3

export function checkWipLimit(): boolean {
  const running = getTasksByStatus("running")
  return running.length >= WIP_LIMIT
}

export function checkJidoka(consecutiveFailures: number): boolean {
  return consecutiveFailures >= JIDOKA_THRESHOLD
}

export function getRunningCount(): number {
  return getTasksByStatus("running").length
}
