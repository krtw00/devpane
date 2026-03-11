import { describe, it, expect } from "vitest"
import { PmOutputSchema, StructuredFailureSchema, AgentEventSchema } from "@devpane/shared/schemas"

describe("Zod Schemas", () => {
  describe("PmOutputSchema", () => {
    it("accepts valid PM output", () => {
      const result = PmOutputSchema.safeParse({
        tasks: [{ title: "Add login", description: "Implement login form", priority: 5 }],
        reasoning: "Login is needed",
      })
      expect(result.success).toBe(true)
    })

    it("rejects empty tasks array", () => {
      const result = PmOutputSchema.safeParse({
        tasks: [],
        reasoning: "No tasks",
      })
      expect(result.success).toBe(false)
    })

    it("rejects task with empty title", () => {
      const result = PmOutputSchema.safeParse({
        tasks: [{ title: "", description: "desc", priority: 0 }],
        reasoning: "reason",
      })
      expect(result.success).toBe(false)
    })

    it("rejects priority > 100", () => {
      const result = PmOutputSchema.safeParse({
        tasks: [{ title: "X", description: "d", priority: 150 }],
        reasoning: "reason",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("StructuredFailureSchema", () => {
    it("accepts valid structured failure", () => {
      const result = StructuredFailureSchema.safeParse({
        task_id: "01ABC",
        stage: "worker",
        root_cause: "test_gap",
        why_chain: ["tests failed", "edge case not covered"],
        gates_passed: ["gate1", "gate2"],
        severity: "process_gap",
      })
      expect(result.success).toBe(true)
    })

    it("rejects unknown root cause", () => {
      const result = StructuredFailureSchema.safeParse({
        task_id: "01ABC",
        stage: "worker",
        root_cause: "magic_failure",
        why_chain: ["something"],
        gates_passed: [],
        severity: "transient",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("AgentEventSchema", () => {
    it("accepts task.created event", () => {
      const result = AgentEventSchema.safeParse({
        type: "task.created",
        taskId: "01ABC",
        by: "pm",
      })
      expect(result.success).toBe(true)
    })

    it("accepts spc.alert event", () => {
      const result = AgentEventSchema.safeParse({
        type: "spc.alert",
        metric: "cost_usd",
        value: 1.5,
        ucl: 0.5,
      })
      expect(result.success).toBe(true)
    })

    it("rejects unknown event type", () => {
      const result = AgentEventSchema.safeParse({
        type: "unknown.event",
        data: "foo",
      })
      expect(result.success).toBe(false)
    })
  })
})
