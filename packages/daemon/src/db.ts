import Database from "better-sqlite3"
import { ulid } from "ulid"
import type { Task, TaskLog, TaskStatus, TaskCreator } from "@devpane/shared"
import { config } from "./config.js"

let db: Database.Database
let stmts: ReturnType<typeof prepareStatements>

function prepareStatements(db: Database.Database) {
  return {
    createTask: db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, parent_id, created_by, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `),
    getNextPending: db.prepare(`
      SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1
    `),
    getTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
    getAllTasks: db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`),
    getTasksByStatus: db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC`),
    getRecentDone: db.prepare(`SELECT * FROM tasks WHERE status = 'done' ORDER BY finished_at DESC LIMIT ?`),
    getFailedTasks: db.prepare(`SELECT * FROM tasks WHERE status = 'failed' ORDER BY finished_at DESC`),
    startTask: db.prepare(`UPDATE tasks SET status = 'running', started_at = ?, assigned_to = ? WHERE id = ?`),
    finishTask: db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ? WHERE id = ?`),
    revertToPending: db.prepare(`UPDATE tasks SET status = 'pending', started_at = NULL, assigned_to = NULL WHERE id = ?`),
    appendLog: db.prepare(`
      INSERT INTO task_logs (id, task_id, agent, message, timestamp) VALUES (?, ?, ?, ?, ?)
    `),
    getTaskLogs: db.prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC`),
  }
}

function getDb(): Database.Database {
  if (!db) {
    initDb(config.DB_PATH)
  }
  return db
}

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      priority    INTEGER DEFAULT 0,
      parent_id   TEXT REFERENCES tasks(id),
      created_by  TEXT NOT NULL,
      assigned_to TEXT,
      created_at  TEXT NOT NULL,
      started_at  TEXT,
      finished_at TEXT,
      result      TEXT
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id        TEXT PRIMARY KEY,
      task_id   TEXT NOT NULL,
      agent     TEXT NOT NULL,
      message   TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
  `)

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
): Task {
  const id = ulid()
  const now = new Date().toISOString()
  getDb()
  stmts.createTask.run(id, title, description, priority, parentId, createdBy, now)
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
