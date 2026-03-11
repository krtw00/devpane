import { execFileSync } from "node:child_process"
import { getDb } from "./db.js"
import { emit } from "./events.js"

export type FlowStatus = {
  canProceed: boolean
  reason: "wip_limit" | "jidoka" | "ok"
}

const WIP_LIMIT = Number(process.env.WIP_LIMIT ?? "5")
const JIDOKA_LIMIT = Number(process.env.JIDOKA_LIMIT ?? "3")
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

export function getOpenPrCount(): number {
  try {
    const out = execFileSync("gh", ["pr", "list", "--json", "number", "--state", "open"], {
      encoding: "utf-8",
      timeout: 30_000,
    })
    const prs = JSON.parse(out) as unknown[]
    return prs.length
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[flow-control] gh pr list failed: ${msg}`)
    return 0
  }
}

export function getConsecutiveFailures(): number {
  const db = getDb()
  const rows = db.prepare(`
    SELECT status FROM tasks
    WHERE status IN ('done', 'failed') AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
  `).all() as { status: string }[]

  let count = 0
  for (const row of rows) {
    if (row.status === "failed") {
      count++
    } else {
      break
    }
  }
  return count
}

async function notifyDiscord(message: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.log(`[flow-control] discord notification (no webhook): ${message}`)
    return
  }
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[flow-control] discord webhook failed: ${msg}`)
  }
}

export async function checkFlowControl(): Promise<FlowStatus> {
  // WIP制限: 未マージPR数チェック
  const openPrs = getOpenPrCount()
  if (openPrs >= WIP_LIMIT) {
    emit({ type: "flow.wip_exceeded", openPrs, limit: WIP_LIMIT })
    console.warn(`[flow-control] WIP limit reached: ${openPrs}/${WIP_LIMIT} open PRs`)
    return { canProceed: false, reason: "wip_limit" }
  }

  // ジドウカ: 連続失敗数チェック
  const failures = getConsecutiveFailures()
  if (failures >= JIDOKA_LIMIT) {
    emit({ type: "flow.jidoka_stop", consecutiveFailures: failures, limit: JIDOKA_LIMIT })
    console.error(`[flow-control] Jidoka stop: ${failures} consecutive failures`)
    await notifyDiscord(`🚨 DevPane Jidoka停止: ${failures}件連続失敗（上限${JIDOKA_LIMIT}）`)
    return { canProceed: false, reason: "jidoka" }
  }

  return { canProceed: true, reason: "ok" }
}
