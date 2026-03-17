import { Hono } from "hono"
import { config } from "../config.js"
import { createBackup, listBackups, pruneBackups } from "../backup.js"

export const backupApi = new Hono()

backupApi.get("/", (c) => {
  try {
    return c.json(listBackups(config.BACKUP_DIR))
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

backupApi.post("/", (c) => {
  try {
    const path = createBackup(config.DB_PATH, config.BACKUP_DIR)
    pruneBackups(config.BACKUP_DIR, config.BACKUP_KEEP_COUNT)
    return c.json({ path }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
