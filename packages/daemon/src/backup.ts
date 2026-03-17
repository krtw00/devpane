import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { getDb } from "./db.js"

const BACKUP_FILE_RE = /^devpane-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.db$/

type BackupEntryWithSortKey = {
  path: string
  size: number
  created: string
  createdMs: number
}

function formatBackupTimestamp(date: Date): string {
  // YYYY-MM-DDTHH-mm-ss
  return date.toISOString().slice(0, 19).replaceAll(":", "-")
}

function toSqliteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function parseBackupFilenameToEpochMs(filename: string): number | null {
  const match = filename.match(BACKUP_FILE_RE)
  if (!match) return null
  const [, yyyy, mm, dd, hh, mi, ss] = match
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? null : parsed
}

function readBackupEntries(backupDir: string): BackupEntryWithSortKey[] {
  if (!existsSync(backupDir)) return []

  const entries: BackupEntryWithSortKey[] = []

  for (const file of readdirSync(backupDir, { withFileTypes: true })) {
    if (!file.isFile()) continue
    if (!BACKUP_FILE_RE.test(file.name)) continue

    const fullPath = join(backupDir, file.name)
    const stats = statSync(fullPath)
    const parsedMs = parseBackupFilenameToEpochMs(file.name)
    const createdMs = parsedMs ?? stats.birthtimeMs ?? stats.mtimeMs

    entries.push({
      path: fullPath,
      size: stats.size,
      created: new Date(createdMs).toISOString(),
      createdMs,
    })
  }

  entries.sort((a, b) => b.createdMs - a.createdMs)
  return entries
}

export function createBackup(dbPath: string, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true })

  const db = getDb()
  const mainDb = db.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>
  const main = mainDb.find((entry) => entry.name === "main")
  if (main?.file && resolve(main.file) !== resolve(dbPath)) {
    throw new Error(`connected database mismatch: expected ${resolve(dbPath)}, got ${resolve(main.file)}`)
  }

  const filename = `devpane-backup-${formatBackupTimestamp(new Date())}.db`
  const backupPath = resolve(join(backupDir, filename))

  rmSync(backupPath, { force: true })
  db.exec(`VACUUM INTO ${toSqliteStringLiteral(backupPath)}`)

  return backupPath
}

export function pruneBackups(backupDir: string, keepCount = 7): void {
  const keep = Math.max(0, Math.floor(keepCount))
  const backups = readBackupEntries(backupDir)
  for (const backup of backups.slice(keep)) {
    rmSync(backup.path, { force: true })
  }
}

export function listBackups(backupDir: string): { path: string; size: number; created: string }[] {
  return readBackupEntries(backupDir).map(({ path, size, created }) => ({ path, size, created }))
}
