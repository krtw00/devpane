import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "../../../../")

function readRoot(name: string): string {
  return readFileSync(resolve(ROOT, name), "utf-8")
}

describe("Dockerfile", () => {
  const content = readRoot("Dockerfile")

  it("exists at project root", () => {
    expect(existsSync(resolve(ROOT, "Dockerfile"))).toBe(true)
  })

  it("uses multi-stage build with build and runtime stages", () => {
    expect(content).toMatch(/^FROM\s+node:\d+-slim\s+AS\s+build/m)
    expect(content).toMatch(/^FROM\s+node:\d+-slim\s+AS\s+runtime/m)
  })

  it("runs pnpm install --frozen-lockfile in build stage", () => {
    expect(content).toContain("pnpm install --frozen-lockfile")
  })

  it("runs pnpm build in build stage", () => {
    expect(content).toMatch(/^RUN\s+pnpm\s+build$/m)
  })

  it("copies daemon dist from builder to runtime", () => {
    expect(content).toMatch(/COPY\s+--from=build.*packages\/daemon\/dist/)
  })

  it("copies web dist from builder to runtime", () => {
    expect(content).toMatch(/COPY\s+--from=build.*packages\/web\/dist/)
  })

  it("installs production dependencies only in runtime stage", () => {
    // After the runtime FROM, there should be --prod install
    const runtimeSection = content.split(/^FROM.*AS\s+runtime/m)[1]
    expect(runtimeSection).toBeDefined()
    expect(runtimeSection).toMatch(/pnpm install\s+--frozen-lockfile\s+--prod/)
  })

  it("exposes port 3001", () => {
    expect(content).toMatch(/^EXPOSE\s+3001$/m)
  })

  it("sets CMD to run daemon index.js", () => {
    expect(content).toContain('CMD ["node", "packages/daemon/dist/index.js"]')
  })
})

describe("docker-compose.yml", () => {
  const content = readRoot("docker-compose.yml")

  it("exists at project root", () => {
    expect(existsSync(resolve(ROOT, "docker-compose.yml"))).toBe(true)
  })

  it("defines devpane service", () => {
    expect(content).toMatch(/^\s*devpane:/m)
  })

  it("builds from current directory", () => {
    expect(content).toMatch(/build:\s*\./)
  })

  it("maps port 3001:3001", () => {
    expect(content).toContain("3001:3001")
  })

  it("mounts a volume for database persistence", () => {
    // DB should be persisted via volume (either direct db file or data directory)
    expect(content).toMatch(/volumes:/m)
    expect(content).toMatch(/devpane\.db|\.\/data:/)
  })
})

describe(".dockerignore", () => {
  it("exists at project root", () => {
    expect(existsSync(resolve(ROOT, ".dockerignore"))).toBe(true)
  })

  it("ignores node_modules", () => {
    const content = readRoot(".dockerignore")
    expect(content).toMatch(/^node_modules/m)
  })

  it("ignores .git", () => {
    const content = readRoot(".dockerignore")
    expect(content).toMatch(/^\.git$/m)
  })

  it("ignores dist directories", () => {
    const content = readRoot(".dockerignore")
    expect(content).toMatch(/dist/m)
  })

  it("ignores database files", () => {
    const content = readRoot(".dockerignore")
    expect(content).toMatch(/\*\.db/m)
  })
})
