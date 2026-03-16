import { describe, it, expect } from "vitest"
import { parseConstraints } from "../scheduler-plugins.js"

describe("parseConstraints (shared from scheduler-plugins)", () => {
  it("returns empty array for null", () => {
    expect(parseConstraints(null)).toEqual([])
  })

  it("returns empty array for empty string", () => {
    expect(parseConstraints("")).toEqual([])
  })

  it("parses valid JSON string array", () => {
    expect(parseConstraints('["a","b","c"]')).toEqual(["a", "b", "c"])
  })

  it("filters out non-string elements", () => {
    expect(parseConstraints('[1,"valid",true,null,"also valid"]')).toEqual([
      "valid",
      "also valid",
    ])
  })

  it("returns empty array for malformed JSON", () => {
    expect(parseConstraints("{not json")).toEqual([])
  })

  it("returns empty array for non-array JSON", () => {
    expect(parseConstraints('{"key":"value"}')).toEqual([])
  })

  it("returns empty array for JSON string (not array)", () => {
    expect(parseConstraints('"just a string"')).toEqual([])
  })
})
