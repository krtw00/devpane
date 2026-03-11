CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  priority    INTEGER DEFAULT 0,
  parent_id   TEXT REFERENCES tasks(id),
  created_by  TEXT NOT NULL,
  assigned_to TEXT,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  result      TEXT
);

CREATE TABLE IF NOT EXISTS task_logs (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL,
  agent     TEXT NOT NULL,
  message   TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
