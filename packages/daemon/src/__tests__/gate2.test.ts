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

  it("ignores non-test files mixed into the tester output", () => {
    const content = `describe("x", () => { it("y", () => {}) })\n`
    writeFileSync(join(workdir, "real.test.ts"), content)
    writeFileSync(join(workdir, "009_add_task_execution_logs.sql"), "create table logs(id text);\n")
    const result = runGate2(spec, ["009_add_task_execution_logs.sql", "real.test.ts"], workdir)
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("accepts test() as valid test block", () => {
    const content = `test("works", () => { expect(1).toBe(1) })\n`
    writeFileSync(join(workdir, "t.test.ts"), content)
    const result = runGate2(spec, ["t.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })
})

describe("Gate 2 — invariants check", () => {
  const specWithInvariants: PmOutput = {
    tasks: [{
      title: "add auth",
      description: "implement authentication",
      priority: 80,
      invariants: ["token must expire", "invalid credentials return 401"],
    }],
    reasoning: "security requirement",
  }

  it("passes when all invariants are covered in test file", () => {
    const content = `
describe("auth", () => {
  it("token must expire after TTL", () => {
    expect(isExpired(token)).toBe(true)
  })
  it("invalid credentials return 401", () => {
    expect(res.status).toBe(401)
  })
})
`
    writeFileSync(join(workdir, "auth.test.ts"), content)
    const result = runGate2(specWithInvariants, ["auth.test.ts"], workdir)
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("recycles when invariant keyword is missing from test file", () => {
    const content = `
describe("auth", () => {
  it("logs in successfully", () => {
    expect(res.status).toBe(200)
  })
})
`
    writeFileSync(join(workdir, "auth.test.ts"), content)
    const result = runGate2(specWithInvariants, ["auth.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons.some(r => r.includes("token must expire"))).toBe(true)
    expect(result.reasons.some(r => r.includes("invalid credentials return 401"))).toBe(true)
  })

  it("recycles when only some invariants are covered", () => {
    const content = `
describe("auth", () => {
  it("token must expire", () => {
    expect(isExpired(token)).toBe(true)
  })
})
`
    writeFileSync(join(workdir, "auth.test.ts"), content)
    const result = runGate2(specWithInvariants, ["auth.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons.some(r => r.includes("invalid credentials return 401"))).toBe(true)
    expect(result.reasons.every(r => !r.includes("token must expire"))).toBe(true)
  })

  it("passes when spec has no invariants", () => {
    const noInvariants: PmOutput = {
      tasks: [{ title: "refactor", description: "cleanup", priority: 30 }],
      reasoning: "tech debt",
    }
    const content = `describe("x", () => { it("y", () => {}) })\n`
    writeFileSync(join(workdir, "clean.test.ts"), content)
    const result = runGate2(noInvariants, ["clean.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })

  it("passes when invariants array is empty", () => {
    const emptyInvariants: PmOutput = {
      tasks: [{ title: "refactor", description: "cleanup", priority: 30, invariants: [] }],
      reasoning: "tech debt",
    }
    const content = `describe("x", () => { it("y", () => {}) })\n`
    writeFileSync(join(workdir, "clean.test.ts"), content)
    const result = runGate2(emptyInvariants, ["clean.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })

  it("checks invariants across all test files", () => {
    const content1 = `
describe("auth", () => {
  it("token must expire", () => {})
})
`
    const content2 = `
describe("errors", () => {
  it("invalid credentials return 401", () => {})
})
`
    writeFileSync(join(workdir, "auth.test.ts"), content1)
    writeFileSync(join(workdir, "error.test.ts"), content2)
    const result = runGate2(specWithInvariants, ["auth.test.ts", "error.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })

  it("matches invariants case-insensitively", () => {
    const content = `
describe("auth", () => {
  it("Token Must Expire after TTL", () => {})
  it("Invalid Credentials Return 401", () => {})
})
`
    writeFileSync(join(workdir, "auth.test.ts"), content)
    const result = runGate2(specWithInvariants, ["auth.test.ts"], workdir)
    expect(result.verdict).toBe("go")
  })

  it("aggregates invariants from multiple tasks", () => {
    const multiTask: PmOutput = {
      tasks: [
        { title: "auth", description: "auth", priority: 80, invariants: ["token must expire"] },
        { title: "api", description: "api", priority: 60, invariants: ["rate limit enforced"] },
      ],
      reasoning: "multi-task",
    }
    const content = `
describe("all", () => {
  it("token must expire", () => {})
})
`
    writeFileSync(join(workdir, "all.test.ts"), content)
    const result = runGate2(multiTask, ["all.test.ts"], workdir)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons.some(r => r.includes("rate limit enforced"))).toBe(true)
  })
})
