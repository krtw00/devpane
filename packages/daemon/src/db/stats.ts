import { getDb } from "./core.js"

export function getPipelineStats() {
  const d = getDb()

  const recentGate3 = d.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE type = 'gate.passed') AS pass_count,
      COUNT(*) AS total
    FROM (
      SELECT * FROM agent_events
      WHERE type IN ('gate.passed', 'gate.rejected')
        AND json_extract(payload, '$.gate') = 'gate3'
      ORDER BY timestamp DESC LIMIT 20
    )
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

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const tasksToday = d.prepare(`
    SELECT COUNT(*) AS cnt FROM tasks
    WHERE status = 'done' AND finished_at >= ?
  `).get(startOfToday) as { cnt: number }

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

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const cost24h = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS cost
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > ?
  `).get(oneDayAgo) as { cost: number }

  const cost7d = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS cost
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > ?
  `).get(sevenDaysAgo) as { cost: number }

  const daily = d.prepare(`
    SELECT date(substr(finished_at, 1, 19), 'localtime') AS date,
           SUM(cost_usd) AS cost, COUNT(*) AS tasks
    FROM tasks WHERE cost_usd IS NOT NULL AND finished_at > ?
    GROUP BY date(substr(finished_at, 1, 19), 'localtime') ORDER BY date ASC
  `).all(thirtyDaysAgo) as { date: string; cost: number; tasks: number }[]

  return {
    total_cost: total.total_cost,
    total_tasks: total.total_tasks,
    avg_cost: total.avg_cost,
    cost_24h: cost24h.cost,
    cost_7d: cost7d.cost,
    daily,
  }
}
