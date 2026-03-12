import type { Task } from "@devpane/shared"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Tester: タスク仕様からテスト基準を生成（ルールベース）
// Worker実行前に、成果物が満たすべき基準を定義する

export type TestCriterion = {
  id: string
  description: string
  check: "file_exists" | "build_passes" | "tests_pass" | "no_lint_errors" | "has_changes"
}

export type TesterResult = {
  criteria: TestCriterion[]
}

let criterionCounter = 0

function nextId(): string {
  return `tc-${++criterionCounter}`
}

export function runTester(task: Task): TesterResult {
  const criteria: TestCriterion[] = []

  // 基本基準: すべてのタスクに適用
  criteria.push({
    id: nextId(),
    description: "ビルドが通ること",
    check: "build_passes",
  })

  criteria.push({
    id: nextId(),
    description: "既存テストが通ること",
    check: "tests_pass",
  })

  criteria.push({
    id: nextId(),
    description: "lint エラーがないこと",
    check: "no_lint_errors",
  })

  criteria.push({
    id: nextId(),
    description: "ファイル変更があること",
    check: "has_changes",
  })

  // タスク固有基準: descriptionからファイルパスが推測できる場合
  const fileRefs = task.description.match(/[\w/.-]+\.(ts|js|vue|json|css|html)/g)
  if (fileRefs) {
    for (const ref of [...new Set(fileRefs)]) {
      criteria.push({
        id: nextId(),
        description: `${ref} が変更または作成されること`,
        check: "file_exists",
      })
    }
  }

  emit({ type: "gate.passed", taskId: task.id, gate: "tester" })
  appendLog(task.id, "tester", `[generated] ${criteria.length} criteria`)

  return { criteria }
}
