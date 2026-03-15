// Re-export from split modules for backward compatibility
export { getDb, initDb, closeDb } from "./db/core.js"
export { createTask, getNextPending, getTask, getAllTasks, getTasksByStatus, getRecentDone, getAllDoneTitles, getFailedTasks, startTask, finishTask, revertToPending, requeueTask, getRetryCount, updateTaskCost, appendLog, getTaskLogs, getTasksSince, recoverOrphanedTasks } from "./db/tasks.js"
export { insertAgentEvent, getAgentEvents, getEventsByTaskId } from "./db/events.js"
export { getActiveImprovements, getRecentImprovements } from "./db/improvements.js"
export { getSpcMetrics } from "./db/spc-query.js"
export { getPipelineStats, getCostStats } from "./db/stats.js"
