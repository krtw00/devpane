import Database from "better-sqlite3"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "../config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database

function migrate(db: Database.Database, migrationsDir?: string): void {
  const dir = migrationsDir ?? join(__dirname, "..", "migrations")

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

export function getDb(): Database.Database {
  if (!db) {
    initDb(config.DB_PATH)
  }
  return db
}

export function initDb(dbPath: string, migrationsDir?: string): Database.Database {
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  migrate(db, migrationsDir)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
  }
}
