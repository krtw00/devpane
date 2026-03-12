import Database from "better-sqlite3"
import { ulid } from "ulid"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, TaskLog, TaskStatus, TaskCreator } from "@devpane/shared"
import type { AgentEvent } from "@devpane/shared/schemas"
import { config } from "./config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database
let stmts: ReturnType<typeof prepareStatements>

function prepareStatements(db: Database.Database) {
  return {
    createTask: db.prepare(`
      INSERT INTO tasks (id, title, description, constraints, status, priority, parent_id, created_by, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `),
    getNextPending: db.prepare(`
      SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1
    `),
    getTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
    getAllTasks: db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`),
    getTasksByStatus: db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC`),
    getRecentDone: db.prepare(`SELECT * FROM tasks WHERE status = 'done' ORDER BY finished_at DESC LIMIT ?`),
    getAllDoneTitles: db.prepare(`SELECT title FROM tasks WHERE status = 'done' ORDER BY finished_at DESC`),
    getFailedTasks: db.prepare(`SELECT * FROM tasks WHERE status = 'failed' ORDER BY finished_at DESC`),
    startTask: db.prepare(`UPDATE tasks SET status = 'running', started_at = ?, assigned_to = ? WHERE id = ?`),
    finishTask: db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ? WHERE id = ?`),
    revertToPending: db.prepare(`UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL WHERE id = ?`),
    requeueTask: db.prepare(`UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL, finished_at = NULL, result = NULL, retry_count = retry_count + 1 WHERE id = ?`),
    getRetryCount: db.prepare(`SELECT retry_count FROM tasks WHERE id = ?`),
    updateTaskCost: db.prepare(`UPDATE tasks SET cost_usd = ?, tokens_used = ? WHERE id = ?`),
    appendLog: db.prepare(`
      INSERT INTO task_logs (id, task_id, agent, message, timestamp) VALUES (?, ?, ?, ?, ?)
    `),
    getTaskLogs: db.prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC`),
    insertAgentEvent: db.prepare(`INSERT INTO agent_events (id, type, payload, timestamp) VALUES (?, ?, ?, ?)`),
    getAgentEvents: db.prepare(`SELECT * FROM agent_events ORDER BY timestamp DESC LIMIT ?`),
    getAgentEventsByType: db.prepare(`SELECT * FROM agent_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`),
  }
}

export function getDb(): Database.Database {
  if (!db) {
    initDb(config.DB_PATH)
  }
  return db
}

function migrate(db: Database.Database, migrationsDir?: string): void {
  const dir = migrationsDir ?? join(__dirname, "migrations")

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version     INTEGER PRIMARY KEY,
      filename    TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    )
  `)

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_versions").all() as { version: number }[])
      .map((r) => r.version),
  )

  const files = readdirSync(dir)
    .filter((f: string) => /^\d{3}_.+\.sql$/.test(f))
    .sort()

  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10)
    if (applied.has(version)) continue

    const sql = readFileSync(join(dir, file), "utf-8")
    db.exec(sql)
    db.prepare("INSERT INTO schema_versions (version, filename, applied_at) VALUES (?, ?, ?)").run(
      version,
      file,
      new Date().toISOString(),
    )
  }
}

export function initDb(dbPath: string, migrationsDir?: string): Database.Database {
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  migrate(db, migrationsDir)

  stmts = prepareStatements(db)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
  }
}

export function createTask(
  title: string,
  description: string,
  createdBy: TaskCreator,
  priority = 0,
  parentId: string | null = null,
  constraints: string[] | null = null,
): Task {
  const id = ulid()
  const now = new Date().toISOString()
  const constraintsJson = constraints ? JSON.stringify(constraints) : null
  getDb()
  stmts.createTask.run(id, title, description, constraintsJson, priority, parentId, createdBy, now)
  return stmts.getTask.get(id) as Task
}

export function getNextPending(): Task | undefined {
  getDb()
  return stmts.getNextPending.get() as Task | undefined
}

export function getTask(id: string): Task | undefined {
  getDb()
  return stmts.getTask.get(id) as Task | undefined
}

export function getAllTasks(): Task[] {
  getDb()
  return stmts.getAllTasks.all() as Task[]
}

export function getTasksByStatus(status: TaskStatus): Task[] {
  getDb()
  return stmts.getTasksByStatus.all(status) as Task[]
}

export function getRecentDone(limit = 5): Task[] {
  getDb()
  return stmts.getRecentDone.all(limit) as Task[]
}

export function getAllDoneTitles(): string[] {
  getDb()
  return (stmts.getAllDoneTitles.all() as { title: string }[]).map(r => r.title)
}

export function getFailedTasks(): Task[] {
  getDb()
  return stmts.getFailedTasks.all() as Task[]
}

export function startTask(id: string, assignedTo: string): void {
  const now = new Date().toISOString()
  getDb()
  stmts.startTask.run(now, assignedTo, id)
}

export function finishTask(id: string, status: "done" | "failed", result: string | null): void {
  const now = new Date().toISOString()
  getDb()
  stmts.finishTask.run(status, now, result, id)
}

export function revertToPending(id: string): void {
  getDb()
  stmts.revertToPending.run(id)
}

export function requeueTask(id: string): void {
  getDb()
  stmts.requeueTask.run(id)
}

export function getRetryCount(id: string): number {
  getDb()
  const row = stmts.getRetryCount.get(id) as { retry_count: number } | undefined
  return row?.retry_count ?? 0
}

export function updateTaskCost(id: string, costUsd: number, tokensUsed: number): void {
  getDb()
  stmts.updateTaskCost.run(costUsd, tokensUsed, id)
}

export function appendLog(taskId: string, agent: string, message: string): void {
  const id = ulid()
  const now = new Date().toISOString()
  getDb()
  stmts.appendLog.run(id, taskId, agent, message, now)
}

export function getTaskLogs(taskId: string): TaskLog[] {
  getDb()
  return stmts.getTaskLogs.all(taskId) as TaskLog[]
}

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

type StoredAgentEvent = { id: string; type: string; payload: string; timestamp: string }

export function insertAgentEvent(type: AgentEvent["type"], payload: AgentEvent): void {
  const id = ulid()
  const now = new Date().toISOString()
  getDb()
  stmts.insertAgentEvent.run(id, type, JSON.stringify(payload), now)
}

export function getAgentEvents(opts: { type?: AgentEvent["type"]; limit?: number } = {}): AgentEvent[] {
  const limit = opts.limit ?? 100
  getDb()
  const rows = opts.type
    ? stmts.getAgentEventsByType.all(opts.type, limit) as StoredAgentEvent[]
    : stmts.getAgentEvents.all(limit) as StoredAgentEvent[]
  return rows.map(r => JSON.parse(r.payload) as AgentEvent)
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
