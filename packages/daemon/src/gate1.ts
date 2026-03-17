import type { Task } from "@devpane/shared"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getAllDoneTitles, getRetryCount } from "./db.js"
import { recall } from "./memory.js"
import { isDuplicate } from "./pm.js"
import { emit } from "./events.js"
import { appendLog } from "./db.js"
import { config } from "./config.js"
import { callLlm } from "./llm-bridge.js"

export type Gate1Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
}

const GATE1_TIMEOUT_MS = 60000

// Phase 1: ルールベース（高速・無料）
export function runGate1Rules(task: Task): Gate1Result {
  const reasons: string[] = []

  // Rule 0: リトライ上限超過 → Worker実行前にkill
  const retryCount = getRetryCount(task.id)
  if (retryCount >= config.MAX_RETRIES) {
    reasons.push(`max retries exceeded (${retryCount}/${config.MAX_RETRIES})`)
    return { verdict: "kill", reasons }
  }

  if (!task.description || task.description.length < config.MIN_DESCRIPTION_LENGTH) {
    reasons.push(`description too short (${task.description?.length ?? 0} chars, min ${config.MIN_DESCRIPTION_LENGTH})`)
  }

  const doneTitles = getAllDoneTitles()
  if (isDuplicate(task.title, doneTitles)) {
    reasons.push(`duplicate of completed task`)
  }

  const features = recall("feature")
  const featureContents = features.map(m => m.content)
  if (isDuplicate(task.title, featureContents)) {
    reasons.push(`conflicts with existing feature memory`)
  }

  return { verdict: reasons.length > 0 ? "kill" : "go", reasons }
}

// Phase 2: LLM判定（意味的チェック）
function buildGate1Prompt(task: Task): string {
  const doneTitles = getAllDoneTitles()
  const features = recall("feature").map(m => m.content)
  const decisions = recall("decision").map(m => m.content)
  const lessons = recall("lesson").map(m => m.content)

  const claudeMd = (() => {
    try {
      const p = join(config.PROJECT_ROOT, "CLAUDE.md")
      return existsSync(p) ? readFileSync(p, "utf-8") : ""
    } catch { return "" }
  })()

  return [
    "You are a Gate 1 reviewer. Decide whether the following task is worth implementing (go/kill).",
    "",
    "## Criteria",
    "- Does this task actually contribute to improving the project?",
    "- Is it substantially different from already implemented features? (different title but same functionality = duplicate)",
    "- Is the description specific enough for a Worker to implement independently?",
    "- Does it align with the project policy (CLAUDE.md)?",
    "",
    "## Task",
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    "",
    "## Completed Tasks",
    doneTitles.length > 0 ? doneTitles.map(t => `- ${t}`).join("\n") : "(none)",
    "",
    "## Implemented Features (memory)",
    features.length > 0 ? features.map(f => `- ${f}`).join("\n") : "(none)",
    "",
    "## Architecture Decisions",
    decisions.length > 0 ? decisions.map(d => `- ${d}`).join("\n") : "(none)",
    "",
    "## Lessons Learned",
    lessons.length > 0 ? lessons.map(l => `- ${l}`).join("\n") : "(none)",
    "",
    claudeMd ? `## CLAUDE.md\n${claudeMd}\n` : "",
    'Respond with ONLY the following JSON format (no explanation):',
    '{"verdict": "go" | "kill", "reason": "one-sentence reason"}',
  ].join("\n")
}

async function runGate1Llm(task: Task): Promise<Gate1Result> {
  const prompt = buildGate1Prompt(task)

  try {
    const bridgeResult = await callLlm(prompt, config.PROJECT_ROOT, GATE1_TIMEOUT_MS)

    // Parse LLM output (CLI mode: JSON wrapper with result field, API mode: direct text)
    let text: string
    try {
      const json = JSON.parse(bridgeResult.text)
      text = json.result ?? bridgeResult.text
    } catch {
      text = bridgeResult.text
    }

    const match = text.match(/\{[\s\S]*?\}/)
    if (!match) {
      console.error(`[gate1] LLM output not parseable, recycling task. Raw output: ${text.slice(0, 200)}`)
      emit({ type: "gate.llm_fallback", taskId: task.id, gate: "gate1", error: "LLM output not parseable" })
      return { verdict: "recycle", reasons: ["LLM output not parseable"] }
    }

    let parsed: { verdict?: string; reason?: string }
    try {
      parsed = JSON.parse(match[0])
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      console.error(`[gate1] JSON.parse failed: ${parseMsg}. Extracted: ${match[0].slice(0, 200)}`)
      emit({ type: "gate.llm_fallback", taskId: task.id, gate: "gate1", error: `JSON.parse failed: ${parseMsg}` })
      return { verdict: "recycle", reasons: ["LLM output not parseable"] }
    }
    if (parsed.verdict === "kill") {
      return { verdict: "kill", reasons: [parsed.reason ?? "LLM rejected"] }
    }
    return { verdict: "go", reasons: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[gate1] LLM check failed, recycling task: ${msg}`)
    emit({ type: "gate.llm_fallback", taskId: task.id, gate: "gate1", error: msg })
    return { verdict: "recycle", reasons: [`LLM check failed: ${msg}`] }
  }
}

// 統合Gate1: ルール → LLM の2段階
export async function runGate1(task: Task): Promise<Gate1Result> {
  // Phase 1: ルールベース
  const ruleResult = runGate1Rules(task)
  if (ruleResult.verdict === "kill") {
    appendLog(task.id, "gate1", `[kill:rule] ${ruleResult.reasons.join("; ")}`)
    return ruleResult
  }

  // Phase 2: LLM判定
  console.log(`[gate1] running LLM check for task ${task.id}: ${task.title}`)
  const llmResult = await runGate1Llm(task)

  if (llmResult.verdict === "kill") {
    appendLog(task.id, "gate1", `[kill:llm] ${llmResult.reasons.join("; ")}`)
    return llmResult
  }

  if (llmResult.verdict === "recycle") {
    appendLog(task.id, "gate1", `[recycle:llm] ${llmResult.reasons.join("; ")}`)
    return llmResult
  }

  appendLog(task.id, "gate1", "[pass] rule + LLM checks passed")
  return { verdict: "go", reasons: [] }
}
