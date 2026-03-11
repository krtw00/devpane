-- 自己改善の履歴
CREATE TABLE IF NOT EXISTS improvements (
  id               TEXT PRIMARY KEY,
  trigger_analysis TEXT NOT NULL,
  target           TEXT NOT NULL,
  action           TEXT NOT NULL,
  applied_at       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  before_metrics   TEXT,
  after_metrics    TEXT,
  verdict          TEXT
);

CREATE INDEX IF NOT EXISTS idx_improvements_status ON improvements(status);

-- SPC管理図用メトリクス
CREATE TABLE IF NOT EXISTS spc_metrics (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spc_metrics_metric ON spc_metrics(metric, recorded_at);

-- 型付きイベントログ
CREATE TABLE IF NOT EXISTS agent_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  timestamp   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(type, timestamp);
