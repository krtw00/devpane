// Re-export from split modules for backward compatibility
export { getDb, initDb, closeDb } from "./db/core.js"
export { createTask, getNextPending, getTask, getAllTasks, getTasksByStatus, getRecentDone, getAllDoneTitles, getFailedTasks, startTask, finishTask, revertToPending, requeueTask, getRetryCount, updateTaskCost, appendLog, getTaskLogs, getTasksSince } from "./db/tasks.js"
export { insertAgentEvent, getAgentEvents } from "./db/events.js"
export { getActiveImprovements } from "./db/improvements.js"
export { getPipelineStats, getCostStats } from "./db/stats.js"
