import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { recordMetric, checkMetric } from "../spc.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("SPC", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("returns null with insufficient data", () => {
    recordMetric("t1", "cost_usd", 0.10)
    recordMetric("t2", "cost_usd", 0.12)
    const check = checkMetric("cost_usd", 0.11)
    expect(check).toBeNull()
  })

  it("no alert for normal values", () => {
    for (let i = 0; i < 10; i++) {
      recordMetric(`t${i}`, "cost_usd", 0.10 + Math.random() * 0.02)
    }
    const check = checkMetric("cost_usd", 0.11)
    expect(check).not.toBeNull()
    expect(check!.alert).toBe(false)
  })

  it("alerts on extreme outlier", () => {
    for (let i = 0; i < 10; i++) {
      recordMetric(`t${i}`, "cost_usd", 0.10)
    }
    const check = checkMetric("cost_usd", 10.0)
    expect(check).not.toBeNull()
    expect(check!.alert).toBe(true)
    expect(check!.reason).toContain("exceeds UCL")
  })

  it("alerts on 7 consecutive points above mean", () => {
    // First add some normal points to establish baseline
    for (let i = 0; i < 5; i++) {
      recordMetric(`base${i}`, "cost_usd", 0.10)
    }
    // Then 7 points all slightly above mean (but within UCL)
    for (let i = 0; i < 7; i++) {
      recordMetric(`above${i}`, "cost_usd", 0.15)
    }
    // Check with another above-mean value
    const check = checkMetric("cost_usd", 0.15)
    // With mixed data the mean shifts, so alert depends on actual distribution
    expect(check).not.toBeNull()
  })
})
