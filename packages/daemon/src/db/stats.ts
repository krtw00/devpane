import { getDb } from "./core.js"

export function getPipelineStats() {
  const d = getDb()

  const recentGate3 = d.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE json_extract(payload, '$.verdict') = 'go') AS pass_count,
      COUNT(*) AS total
    FROM agent_events
    WHERE type IN ('gate.passed', 'gate.rejected')
    ORDER BY timestamp DESC LIMIT 20
  `).get() as { pass_count: number; total: number }

  const avgExec = d.prepare(`
    SELECT COALESCE(AVG(
      (julianday(finished_at) - julianday(started_at)) * 86400
    ), 0) AS avg_sec
    FROM (
      SELECT started_at, finished_at FROM tasks
      WHERE status IN ('done', 'failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 20
    )
  `).get() as { avg_sec: number }

  const recentStatuses = d.prepare(`
    SELECT status FROM tasks
    WHERE status IN ('done', 'failed') AND finished_at IS NOT NULL
    ORDER BY finished_at DESC LIMIT 100
  `).all() as { status: string }[]

  let consecutive_failures = 0
  for (const row of recentStatuses) {
    if (row.status === 'failed') consecutive_failures++
    else break
  }

  const tasksToday = d.prepare(`
    SELECT COUNT(*) AS cnt FROM tasks
    WHERE status = 'done' AND finished_at >= date('now')
  `).get() as { cnt: number }

  const activeImprovements = d.prepare(`
    SELECT COUNT(*) AS cnt FROM improvements WHERE status = 'active'
  `).get() as { cnt: number }

  const total = recentGate3.total || 1
  return {
    gate3_pass_rate: recentGate3.pass_count / total,
    avg_execution_time: Math.round(avgExec.avg_sec),
    consecutive_failures,
    tasks_today: tasksToday.cnt,
    active_improvements: activeImprovements.cnt,
  }
}

export function getCostStats() {
  const d = getDb()

  const total = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS total_cost,
           COUNT(*) AS total_tasks,
           COALESCE(AVG(cost_usd), 0) AS avg_cost
    FROM tasks WHERE cost_usd IS NOT NULL
  `).get() as { total_cost: number; total_tasks: number; avg_cost: number }

  const cost24h = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS cost
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > datetime('now', '-1 day')
  `).get() as { cost: number }

  const cost7d = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS cost
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > datetime('now', '-7 days')
  `).get() as { cost: number }

  const daily = d.prepare(`
    SELECT date(finished_at) AS date, SUM(cost_usd) AS cost, COUNT(*) AS tasks
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > datetime('now', '-30 days')
    GROUP BY date(finished_at) ORDER BY date ASC
  `).all() as { date: string; cost: number; tasks: number }[]

  return {
    total_cost: total.total_cost,
    total_tasks: total.total_tasks,
    avg_cost: total.avg_cost,
    cost_24h: cost24h.cost,
    cost_7d: cost7d.cost,
    daily,
  }
}
