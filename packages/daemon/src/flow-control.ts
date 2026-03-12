import { execFileSync } from "node:child_process"
import { getDb } from "./db.js"
import { emit } from "./events.js"

const WIP_LIMIT = 5
const CONSECUTIVE_FAILURE_LIMIT = 3
const WIP_WAIT_SEC = 60

export type FlowHalt = { halted: true; reason: string; waitMs: number } | { halted: false }

export function checkWipLimit(): FlowHalt {
  let count: number
  try {
    const out = execFileSync("gh", ["pr", "list", "--state=open", "--json", "number", "--jq", "length"], {
      encoding: "utf-8",
      timeout: 15_000,
    }).trim()
    count = parseInt(out, 10)
    if (Number.isNaN(count)) return { halted: false }
  } catch {
    // gh CLI unavailable or failed — skip check
    return { halted: false }
  }

  if (count >= WIP_LIMIT) {
    const detail = `open PRs: ${count} (limit: ${WIP_LIMIT})`
    console.error(`[flow-control] WIP limit reached — ${detail}`)
    emit({ type: "scheduler.stopped", reason: "wip_limit", detail })
    return { halted: true, reason: detail, waitMs: WIP_WAIT_SEC * 1000 }
  }

  return { halted: false }
}

export function checkConsecutiveFailures(): FlowHalt {
  const db = getDb()
  const rows = db.prepare(
    `SELECT status FROM tasks WHERE status IN ('done', 'failed') ORDER BY finished_at DESC LIMIT ?`,
  ).all(CONSECUTIVE_FAILURE_LIMIT) as { status: string }[]

  if (rows.length < CONSECUTIVE_FAILURE_LIMIT) return { halted: false }

  const allFailed = rows.every(r => r.status === "failed")
  if (!allFailed) return { halted: false }

  const detail = `${CONSECUTIVE_FAILURE_LIMIT} consecutive task failures`
  console.error(`[flow-control] jidoka triggered — ${detail}`)
  emit({ type: "scheduler.stopped", reason: "consecutive_failures", detail })
  return { halted: true, reason: detail, waitMs: WIP_WAIT_SEC * 1000 }
}
