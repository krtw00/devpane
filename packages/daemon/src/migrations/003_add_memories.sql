CREATE TABLE IF NOT EXISTS memories (
  id             TEXT PRIMARY KEY,
  category       TEXT NOT NULL,
  content        TEXT NOT NULL,
  source_task_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
