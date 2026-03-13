import { ulid } from "ulid"
import type { Task, TaskLog, TaskStatus, TaskCreator } from "@devpane/shared"
import { getDb } from "./core.js"
import { insertAgentEvent } from "./events.js"

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
  const db = getDb()
  db.prepare(`INSERT INTO tasks (id, title, description, constraints, status, priority, parent_id, created_by, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(id, title, description, constraintsJson, priority, parentId, createdBy, now)
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task
}

export function getNextPending(): Task | undefined {
  return getDb().prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`).get() as Task | undefined
}

export function getTask(id: string): Task | undefined {
  return getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined
}

export function getAllTasks(): Task[] {
  return getDb().prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all() as Task[]
}

export function getTasksByStatus(status: TaskStatus): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC`).all(status) as Task[]
}

export function getRecentDone(limit = 5): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE status = 'done' ORDER BY finished_at DESC LIMIT ?`).all(limit) as Task[]
}

export function getAllDoneTitles(): string[] {
  return (getDb().prepare(`SELECT title FROM tasks WHERE status = 'done' ORDER BY finished_at DESC`).all() as { title: string }[]).map(r => r.title)
}

export function getFailedTasks(): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE status = 'failed' ORDER BY finished_at DESC`).all() as Task[]
}

export function startTask(id: string, assignedTo: string): void {
  getDb().prepare(`UPDATE tasks SET status = 'running', started_at = ?, assigned_to = ? WHERE id = ?`).run(new Date().toISOString(), assignedTo, id)
}

export function finishTask(id: string, status: "done" | "failed", result: string | null): void {
  getDb().prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ? WHERE id = ?`).run(status, new Date().toISOString(), result, id)
}

export function revertToPending(id: string): void {
  getDb().prepare(`UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL WHERE id = ?`).run(id)
}

export function requeueTask(id: string): void {
  getDb().prepare(`UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL, finished_at = NULL, result = NULL, retry_count = retry_count + 1 WHERE id = ?`).run(id)
}

export function getRetryCount(id: string): number {
  const row = getDb().prepare(`SELECT retry_count FROM tasks WHERE id = ?`).get(id) as { retry_count: number } | undefined
  return row?.retry_count ?? 0
}

export function updateTaskCost(id: string, costUsd: number, tokensUsed: number): void {
  getDb().prepare(`UPDATE tasks SET cost_usd = ?, tokens_used = ? WHERE id = ?`).run(costUsd, tokensUsed, id)
}

export function appendLog(taskId: string, agent: string, message: string): void {
  const id = ulid()
  getDb().prepare(`INSERT INTO task_logs (id, task_id, agent, message, timestamp) VALUES (?, ?, ?, ?, ?)`).run(id, taskId, agent, message, new Date().toISOString())
}

export function getTaskLogs(taskId: string): TaskLog[] {
  return getDb().prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC`).all(taskId) as TaskLog[]
}

export function getTasksSince(timestamp: string): Task[] {
  return getDb().prepare(`SELECT * FROM tasks WHERE status IN ('done', 'failed') AND finished_at > ? ORDER BY finished_at ASC`).all(timestamp) as Task[]
}

/**
 * Recover orphaned tasks left in 'running' status after daemon restart.
 * Tasks whose started_at exceeds timeoutMs are requeued (if under maxRetries) or failed.
 * Returns the IDs of recovered tasks.
 */
export function recoverOrphanedTasks(timeoutMs: number, maxRetries: number): string[] {
  const db = getDb()
  const cutoff = new Date(Date.now() - timeoutMs).toISOString()
  const orphans = db.prepare(
    `SELECT * FROM tasks WHERE status = 'running' AND started_at < ?`,
  ).all(cutoff) as Task[]

  for (const task of orphans) {
    if (task.retry_count < maxRetries) {
      db.prepare(
        `UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL, retry_count = retry_count + 1 WHERE id = ?`,
      ).run(task.id)
    } else {
      db.prepare(
        `UPDATE tasks SET status = 'failed', finished_at = ?, result = ? WHERE id = ?`,
      ).run(new Date().toISOString(), "Recovered as failed: daemon restart or timeout exceeded", task.id)
      insertAgentEvent("task.failed", { type: "task.failed", taskId: task.id, rootCause: "timeout" })
    }
  }

  return orphans.map(t => t.id)
}
