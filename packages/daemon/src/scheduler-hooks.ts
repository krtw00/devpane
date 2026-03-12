import type { Task } from "@devpane/shared"

export type TaskCompletedData = {
  task: Task
  costUsd: number
  numTurns: number
  executionMs: number
  facts: { files_changed: string[]; diff_stats: { additions: number; deletions: number }; commit_hash?: string | null }
  prUrl: string | null
}

export type TaskFailedData = {
  task: Task
  rootCause: string
}

type HookMap = {
  "task.completed": TaskCompletedData
  "task.failed": TaskFailedData
}

type HookFn<T> = (data: T) => void | Promise<void>

const hooks: { [K in keyof HookMap]: HookFn<HookMap[K]>[] } = {
  "task.completed": [],
  "task.failed": [],
}

export function registerHook<K extends keyof HookMap>(event: K, fn: HookFn<HookMap[K]>): void {
  hooks[event].push(fn)
}

export async function runHooks<K extends keyof HookMap>(event: K, data: HookMap[K]): Promise<void> {
  for (const fn of hooks[event]) {
    try {
      await fn(data)
    } catch (err) {
      console.error(`[hook] ${event} handler failed:`, err instanceof Error ? err.message : err)
    }
  }
}
