import { describe, it, expect } from "vitest"
import * as events from "../events.js"

describe("events.ts dead code removal", () => {
  it("should not export queryEventsSince", () => {
    expect("queryEventsSince" in events).toBe(false)
  })

  it("should still export emit", () => {
    expect(typeof events.emit).toBe("function")
  })

  it("should still export safeEmit", () => {
    expect(typeof events.safeEmit).toBe("function")
  })

  it("should still export queryEventsByType", () => {
    expect(typeof events.queryEventsByType).toBe("function")
  })

  it("should still export queryRecentEvents", () => {
    expect(typeof events.queryRecentEvents).toBe("function")
  })

  it("should still export queryEventsByTaskId", () => {
    expect(typeof events.queryEventsByTaskId).toBe("function")
  })

  it("should not export StoredEvent type at runtime", () => {
    // StoredEvent is a type-only export, so it shouldn't exist at runtime regardless,
    // but queryEventsSince (which used it) should be removed
    const exportedNames = Object.keys(events)
    expect(exportedNames).not.toContain("queryEventsSince")
    expect(exportedNames).not.toContain("StoredEvent")
  })

  it("should have exactly the expected public API", () => {
    const exportedFunctions = Object.keys(events).sort()
    expect(exportedFunctions).toEqual([
      "emit",
      "queryEventsByTaskId",
      "queryEventsByType",
      "queryRecentEvents",
      "safeEmit",
    ])
  })
})
