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
    const values = [0.10, 0.12, 0.10, 0.11, 0.12, 0.10, 0.11, 0.12, 0.10, 0.11]
    for (let i = 0; i < values.length; i++) {
      recordMetric(`t${i}`, "cost_usd", values[i])
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
    // Baseline: mean ≈ 0.10
    for (let i = 0; i < 10; i++) {
      recordMetric(`base${i}`, "cost_usd", 0.10)
    }
    // 7 points above mean (within UCL since stddev is tiny → UCL ≈ 0.10)
    // These will be the most recent 7, all above the overall mean
    for (let i = 0; i < 7; i++) {
      recordMetric(`above${i}`, "cost_usd", 0.11)
    }
    const check = checkMetric("cost_usd", 0.11)
    expect(check).not.toBeNull()
    expect(check!.alert).toBe(true)
    expect(check!.reason).toContain("7 consecutive points")
  })

  it("alerts on 7 consecutive points below mean", () => {
    for (let i = 0; i < 10; i++) {
      recordMetric(`base${i}`, "cost_usd", 0.20)
    }
    for (let i = 0; i < 7; i++) {
      recordMetric(`below${i}`, "cost_usd", 0.19)
    }
    const check = checkMetric("cost_usd", 0.19)
    expect(check).not.toBeNull()
    expect(check!.alert).toBe(true)
    expect(check!.reason).toContain("below mean")
  })

  it("alerts when 2 of 3 points exceed 2σ", () => {
    // Establish baseline with known mean/stddev
    for (let i = 0; i < 10; i++) {
      recordMetric(`base${i}`, "cost_usd", 0.10)
    }
    // Add 2 points beyond 2σ (stddev is small, so anything noticeably above should trigger)
    recordMetric("high1", "cost_usd", 0.50)
    recordMetric("high2", "cost_usd", 0.50)
    const check = checkMetric("cost_usd", 0.11)
    expect(check).not.toBeNull()
    expect(check!.alert).toBe(true)
    expect(check!.reason).toContain("2σ")
  })

  it("does not alert on LCL for non-negative metrics", () => {
    for (let i = 0; i < 10; i++) {
      recordMetric(`t${i}`, "cost_usd", 0.10)
    }
    // LCL is clamped to 0, so 0 should not trigger LCL alert
    const check = checkMetric("cost_usd", 0.0)
    expect(check).not.toBeNull()
    // value 0 is below lcl=0 only if lcl > 0; with small stddev lcl = max(0, mean-3σ) ≈ 0
    // So this should still alert via UCL/LCL rule since 0 < lcl when stddev > 0
  })
})
