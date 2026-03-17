import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { initDb, closeDb, getDb } from "../db.js"
import { createBackup, listBackups, pruneBackups } from "../backup.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("backup utilities", () => {
  let workdir: string
  let dbPath: string
  let backupDir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "devpane-backup-test-"))
    dbPath = join(workdir, "devpane.db")
    backupDir = join(workdir, "backups")
    initDb(dbPath, migrationsDir)
  })

  afterEach(() => {
    closeDb()
    rmSync(workdir, { recursive: true, force: true })
  })

  it("creates a backup with VACUUM INTO", () => {
    const db = getDb()
    db.exec("CREATE TABLE backup_test (id INTEGER PRIMARY KEY, value TEXT)")
    db.prepare("INSERT INTO backup_test (value) VALUES (?)").run("hello-backup")

    const backupPath = createBackup(dbPath, backupDir)

    expect(backupPath).toMatch(/devpane-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/)
    const backupDb = new Database(backupPath, { readonly: true })
    const row = backupDb.prepare("SELECT value FROM backup_test LIMIT 1").get() as { value: string }
    backupDb.close()

    expect(row.value).toBe("hello-backup")
  })

  it("prunes old backups and keeps newest N", () => {
    mkdirSync(backupDir, { recursive: true })
    const files = [
      "devpane-backup-2026-03-10T00-00-00.db",
      "devpane-backup-2026-03-11T00-00-00.db",
      "devpane-backup-2026-03-12T00-00-00.db",
      "devpane-backup-2026-03-13T00-00-00.db",
    ]
    for (const file of files) {
      writeFileSync(join(backupDir, file), file)
    }

    pruneBackups(backupDir, 2)

    const remaining = listBackups(backupDir).map((b) => basename(b.path))
    expect(remaining).toEqual([
      "devpane-backup-2026-03-13T00-00-00.db",
      "devpane-backup-2026-03-12T00-00-00.db",
    ])
  })

  it("lists backups sorted newest first", () => {
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(join(backupDir, "devpane-backup-2026-03-11T12-00-00.db"), "a")
    writeFileSync(join(backupDir, "devpane-backup-2026-03-13T12-00-00.db"), "bbb")
    writeFileSync(join(backupDir, "devpane-backup-2026-03-12T12-00-00.db"), "cc")

    const backups = listBackups(backupDir)

    expect(backups.map((b) => basename(b.path))).toEqual([
      "devpane-backup-2026-03-13T12-00-00.db",
      "devpane-backup-2026-03-12T12-00-00.db",
      "devpane-backup-2026-03-11T12-00-00.db",
    ])
    expect(backups[0].size).toBe(3)
  })
})
