CREATE INDEX IF NOT EXISTS idx_agent_events_task_id ON agent_events(json_extract(payload, '$.taskId'));
CREATE INDEX IF NOT EXISTS idx_tasks_finished_at ON tasks(status, finished_at);
