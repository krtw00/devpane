import { describe, it, expect, vi } from "vitest"

// index.ts の shutdown() が killAllTesters を呼び出すことを検証する。
// 直接 shutdown() を呼ぶのではなく、ソースコードの静的検査で担保する。

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

describe("shutdown includes killAllTesters", () => {
  it("index.ts imports killAllTesters from tester.js", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const { fileURLToPath } = await import("node:url")

    const indexPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "index.ts",
    )
    const source = fs.readFileSync(indexPath, "utf-8")

    expect(source).toMatch(/import\s*\{[^}]*killAllTesters[^}]*\}\s*from\s*["']\.\/tester/)
  })

  it("shutdown() calls killAllTesters", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const { fileURLToPath } = await import("node:url")

    const indexPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "index.ts",
    )
    const source = fs.readFileSync(indexPath, "utf-8")

    // shutdown 関数の本体を抽出して killAllTesters 呼び出しを確認
    const shutdownMatch = source.match(/async\s+function\s+shutdown\s*\(\)\s*\{([\s\S]*?)\n\}/)
    expect(shutdownMatch).not.toBeNull()

    const shutdownBody = shutdownMatch![1]
    expect(shutdownBody).toContain("killAllTesters()")
  })
})
