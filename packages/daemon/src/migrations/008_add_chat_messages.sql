CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('human', 'system')),
  message    TEXT NOT NULL,
  task_id    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_task_id ON chat_messages(task_id);
