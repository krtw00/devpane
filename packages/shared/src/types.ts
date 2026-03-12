// Task status
export type TaskStatus = "pending" | "running" | "done" | "failed"

// Task creator
export type TaskCreator = "pm" | "human"

// Task
export type Task = {
  id: string // ULID
  title: string
  description: string
  constraints: string | null // JSON stringified string[]
  status: TaskStatus
  priority: number
  parent_id: string | null
  created_by: TaskCreator
  assigned_to: string | null // worker id
  created_at: string // ISO 8601
  started_at: string | null
  finished_at: string | null
  result: string | null // JSON stringified ObservableFacts
  cost_usd: number
  tokens_used: number
  retry_count: number
}

// Observable Facts — Worker完了後にdaemonが客観的に収集する事実
export type ObservableFacts = {
  exit_code: number
  files_changed: string[]
  diff_stats: { additions: number; deletions: number }
  test_result?: {
    passed: number
    failed: number
    exit_code: number
  }
  lint_result?: {
    errors: number
    exit_code: number
  }
  branch: string
  commit_hash?: string
}

// Task log entry
export type TaskLog = {
  id: string // ULID
  task_id: string
  agent: string // 'pm' | 'worker-0' | 'worker-1'
  message: string
  timestamp: string // ISO 8601
}

// PM output — PMが返すタスクリスト
export type PmOutput = {
  tasks: { title: string; description: string; priority: number; constraints?: string[] }[]
  reasoning: string
}

// Memory — PMの永続記憶
export type MemoryCategory = "feature" | "decision" | "lesson"

export type Memory = {
  id: string // ULID
  category: MemoryCategory
  content: string
  source_task_id: string | null
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
}

// Improvement — 自己改善の履歴
export type ImprovementStatus = "active" | "reverted" | "permanent"

export type Improvement = {
  id: string
  trigger_analysis: string // JSON
  target: string
  action: string
  applied_at: string
  status: ImprovementStatus
  before_metrics: string | null // JSON
  after_metrics: string | null // JSON
  verdict: string | null // 'effective' | 'ineffective' | 'harmful'
}

// SPC Metric — 管理図用時系列データ
export type SpcMetric = {
  id: string
  task_id: string
  metric: string // 'cost_usd' | 'execution_time' | 'diff_size'
  value: number
  recorded_at: string
}

// Config
export type Config = {
  PROJECT_ROOT: string
  WORKER_TIMEOUT_MS: number
  PM_TIMEOUT_MS: number
  IDLE_INTERVAL_SEC: number
  PM_RETRY_INTERVAL_SEC: number
  COOLDOWN_INTERVAL_SEC: number
  WORKER_CONCURRENCY: number
  DB_PATH: string
  API_PORT: number
}
