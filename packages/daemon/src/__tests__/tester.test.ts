import { describe, it, expect } from "vitest"
import { parseTesterOutput, extractTesterSpec } from "../tester.js"

describe("parseTesterOutput", () => {
  it("parses direct JSON output", () => {
    const input = JSON.stringify({
      testFiles: ["src/__tests__/foo.test.ts"],
      testCount: 3,
    })
    const result = parseTesterOutput(input)
    expect(result.testFiles).toEqual(["src/__tests__/foo.test.ts"])
    expect(result.testCount).toBe(3)
  })

  it("parses claude CLI wrapped output (result field)", () => {
    const inner = JSON.stringify({
      testFiles: ["src/__tests__/bar.test.ts", "src/__tests__/baz.test.ts"],
      testCount: 7,
    })
    const wrapped = JSON.stringify({ result: inner })
    const result = parseTesterOutput(wrapped)
    expect(result.testFiles).toHaveLength(2)
    expect(result.testCount).toBe(7)
  })

  it("extracts JSON from mixed text output", () => {
    const text = `I generated the tests.\n{"testFiles": ["src/__tests__/utils.test.ts"], "testCount": 5}\nDone.`
    const result = parseTesterOutput(text)
    expect(result.testFiles).toEqual(["src/__tests__/utils.test.ts"])
    expect(result.testCount).toBe(5)
  })

  it("throws on output without JSON", () => {
    expect(() => parseTesterOutput("No JSON here")).toThrow("does not contain valid JSON")
  })

  it("throws on output missing testFiles", () => {
    expect(() => parseTesterOutput('{"testCount": 3}')).toThrow("Tester output validation failed")
  })

  it("throws on negative testCount", () => {
    expect(() => parseTesterOutput('{"testFiles": [], "testCount": -1}')).toThrow("Tester output validation failed")
  })

  it("handles zero tests", () => {
    const input = JSON.stringify({ testFiles: [], testCount: 0 })
    const result = parseTesterOutput(input)
    expect(result.testFiles).toEqual([])
    expect(result.testCount).toBe(0)
  })

  it("handles claude CLI json with nested result containing JSON", () => {
    const inner = '{"testFiles": ["src/__tests__/a.test.ts"], "testCount": 2}'
    const cliOutput = JSON.stringify({
      type: "result",
      subtype: "success",
      result: `Here are the tests:\n${inner}`,
    })
    const result = parseTesterOutput(cliOutput)
    expect(result.testFiles).toHaveLength(1)
    expect(result.testCount).toBe(2)
  })
})

describe("extractTesterSpec", () => {
  it("extracts spec from JSON code block in description", () => {
    const description = [
      "Implement login feature.",
      "",
      "```json",
      '{"functions": [{"name": "login", "file": "src/auth.ts", "invariants": ["returns token on valid credentials", "throws on invalid password"]}]}',
      "```",
    ].join("\n")
    const spec = extractTesterSpec(description)
    expect(spec).not.toBeNull()
    expect(spec!.functions).toHaveLength(1)
    expect(spec!.functions[0].name).toBe("login")
    expect(spec!.functions[0].invariants).toHaveLength(2)
  })

  it("extracts spec from raw JSON string", () => {
    const description = JSON.stringify({
      functions: [
        { name: "add", file: "src/math.ts", invariants: ["returns sum of two numbers"] },
        { name: "subtract", file: "src/math.ts", invariants: ["returns difference"] },
      ],
    })
    const spec = extractTesterSpec(description)
    expect(spec).not.toBeNull()
    expect(spec!.functions).toHaveLength(2)
  })

  it("returns null for non-spec description", () => {
    const spec = extractTesterSpec("Just a plain task description with no JSON spec.")
    expect(spec).toBeNull()
  })

  it("returns null for JSON without functions field", () => {
    const spec = extractTesterSpec('{"tasks": [{"title": "foo"}]}')
    expect(spec).toBeNull()
  })

  it("returns null for invalid invariants (empty array)", () => {
    const spec = extractTesterSpec('{"functions": [{"name": "foo", "file": "bar.ts", "invariants": []}]}')
    expect(spec).toBeNull()
  })

  it("handles multiple functions with multiple invariants", () => {
    const description = JSON.stringify({
      functions: [
        { name: "createUser", file: "src/user.ts", invariants: ["creates a user record", "hashes password", "returns user id"] },
        { name: "deleteUser", file: "src/user.ts", invariants: ["removes user record", "returns true on success"] },
      ],
    })
    const spec = extractTesterSpec(description)
    expect(spec).not.toBeNull()
    expect(spec!.functions).toHaveLength(2)
    expect(spec!.functions[0].invariants).toHaveLength(3)
    expect(spec!.functions[1].invariants).toHaveLength(2)
  })
})
