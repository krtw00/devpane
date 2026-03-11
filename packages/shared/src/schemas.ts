import { z } from "zod/v4"

// --- PM Output Schema (Contract: PMの出力を検証) ---

export const PmTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.number().int().min(0).max(100),
})

export const PmOutputSchema = z.object({
  tasks: z.array(PmTaskSchema).min(1).max(10),
  reasoning: z.string(),
})

// --- Structured Failure (構造化失敗記録) ---

export const RootCause = z.enum([
  "spec_ambiguity",
  "test_gap",
  "scope_creep",
  "api_misuse",
  "env_issue",
  "regression",
  "timeout",
  "unknown",
])

export const PipelineStage = z.enum([
  "pm",
  "gate1",
  "tester",
  "gate2",
  "worker",
  "gate3",
])

export const StructuredFailureSchema = z.object({
  task_id: z.string(),
  stage: PipelineStage,
  root_cause: RootCause,
  why_chain: z.array(z.string()).min(1).max(5),
  gates_passed: z.array(PipelineStage),
  severity: z.enum(["transient", "process_gap", "critical"]),
})

// --- Gate 3 Verdict ---

export const Gate3VerdictSchema = z.enum(["go", "recycle", "kill"])

// --- Improvement (自己改善) ---

export const ImprovementTargetSchema = z.enum([
  "gate1",
  "gate2",
  "gate3",
  "pm_template",
  "worker_instruction",
  "spc_threshold",
])

export const ImprovementActionSchema = z.object({
  target: ImprovementTargetSchema,
  action: z.enum(["add_check", "remove_check", "adjust_threshold", "add_field", "add_constraint"]),
  description: z.string(),
  detail: z.string().optional(),
})

export const WhyWhyAnalysisSchema = z.object({
  analysis: z.object({
    top_failure: RootCause,
    frequency: z.string(),
    why_chain: z.array(z.string()).min(1).max(5),
  }),
  improvements: z.array(ImprovementActionSchema).min(1).max(5),
})

export const ImprovementVerdictSchema = z.enum(["effective", "ineffective", "harmful"])

// --- Typed Agent Events ---

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task.created"), taskId: z.string(), by: z.enum(["pm", "human"]) }),
  z.object({ type: z.literal("task.started"), taskId: z.string(), workerId: z.string() }),
  z.object({ type: z.literal("task.completed"), taskId: z.string(), costUsd: z.number() }),
  z.object({ type: z.literal("task.failed"), taskId: z.string(), rootCause: RootCause }),
  z.object({ type: z.literal("gate.passed"), taskId: z.string(), gate: PipelineStage }),
  z.object({ type: z.literal("gate.rejected"), taskId: z.string(), gate: PipelineStage, verdict: z.enum(["kill", "recycle"]), reason: z.string() }),
  z.object({ type: z.literal("worker.rate_limited"), backoffSec: z.number() }),
  z.object({ type: z.literal("pm.invoked"), reason: z.enum(["queue_empty", "scheduled"]) }),
  z.object({ type: z.literal("pm.failed"), error: z.string(), consecutiveCount: z.number() }),
  z.object({ type: z.literal("improvement.applied"), improvementId: z.string(), target: z.string() }),
  z.object({ type: z.literal("improvement.reverted"), improvementId: z.string(), reason: z.string() }),
  z.object({ type: z.literal("pr.created"), taskId: z.string(), url: z.string() }),
  z.object({ type: z.literal("spc.alert"), metric: z.string(), value: z.number(), ucl: z.number() }),
])

// --- Tester Spec (構造化仕様: functions[].invariants) ---

export const FunctionSpecSchema = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  invariants: z.array(z.string().min(1)).min(1),
})

export const TesterSpecSchema = z.object({
  functions: z.array(FunctionSpecSchema).min(1),
})

export const TesterOutputSchema = z.object({
  testFiles: z.array(z.string()),
  testCount: z.number().int().min(0),
})

// --- Type exports ---

export type FunctionSpec = z.infer<typeof FunctionSpecSchema>
export type TesterSpec = z.infer<typeof TesterSpecSchema>
export type TesterOutput = z.infer<typeof TesterOutputSchema>
export type PmTask = z.infer<typeof PmTaskSchema>
export type PmOutputValidated = z.infer<typeof PmOutputSchema>
export type RootCauseType = z.infer<typeof RootCause>
export type PipelineStageType = z.infer<typeof PipelineStage>
export type StructuredFailure = z.infer<typeof StructuredFailureSchema>
export type Gate3Verdict = z.infer<typeof Gate3VerdictSchema>
export type ImprovementAction = z.infer<typeof ImprovementActionSchema>
export type WhyWhyAnalysis = z.infer<typeof WhyWhyAnalysisSchema>
export type ImprovementVerdict = z.infer<typeof ImprovementVerdictSchema>
export type AgentEvent = z.infer<typeof AgentEventSchema>
