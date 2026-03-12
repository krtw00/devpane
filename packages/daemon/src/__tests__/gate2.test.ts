import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runGate2 } from "../gate2.js"
import type { PmOutput } from "@devpane/shared"

const spec: PmOutput = {
  tasks: [{ title: "add feature", description: "implement X", priority: 50 }],
  reasoning: "test reasoning",
}

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "gate2-"))
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe("Gate 2", () => {
  it("passes valid test file", () => {
    const content = `
import { describe, it, expect } from "vitest"

describe("feature", () => {
  it("works", () => {
    expect(true).toBe(true)
  })
})
`
    writeFileSync(join(workdir, "foo.test.ts"), content)
    const result = runGate2(spec, ["foo.test.ts"], workdir)
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("recycles when no test files exist", () => {
    const result = runGate2(spec, ["missing.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContain("no test files found")
  })

  it("recycles when test files list is empty", () => {
    const result = runGate2(spec, [], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContain("no test files found")
  })

  it("recycles when file has no test blocks", () => {
    writeFileSync(join(workdir, "empty.test.ts"), "export const x = 1\n")
    const result = runGate2(spec, ["empty.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons[0]).toContain("no test blocks")
  })

  it("recycles when file has empty import path", () => {
    const content = `import { foo } from ""
describe("x", () => { it("y", () => {}) })
`
    writeFileSync(join(workdir, "bad.test.ts"), content)
    const result = runGate2(spec, ["bad.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons[0]).toContain("empty import path")
  })

  it("recycles when braces are unbalanced", () => {
    const content = `import { describe } from "vitest"
describe("x", () => { it("y", () => {})
`
    writeFileSync(join(workdir, "broken.test.ts"), content)
    const result = runGate2(spec, ["broken.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons.some(r => r.includes("unbalanced braces"))).toBe(true)
  })

  it("checks multiple files independently", () => {
    const good = `describe("a", () => { it("b", () => {}) })\n`
    writeFileSync(join(workdir, "good.test.ts"), good)
    writeFileSync(join(workdir, "bad.test.ts"), "export const x = 1\n")
    const result = runGate2(spec, ["good.test.ts", "bad.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain("bad.test.ts")
  })

  it("skips non-existent files among valid ones", () => {
    const content = `describe("x", () => { it("y", () => {}) })\n`
    writeFileSync(join(workdir, "real.test.ts"), content)
    const result = runGate2(spec, ["real.test.ts", "ghost.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })

  it("accepts test() as valid test block", () => {
    const content = `test("works", () => { expect(1).toBe(1) })\n`
    writeFileSync(join(workdir, "t.test.ts"), content)
    const result = runGate2(spec, ["t.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })
})
