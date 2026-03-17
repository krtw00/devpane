// Re-export from split modules for backward compatibility
export { getDb, initDb, closeDb } from "./db/core.js"
export { createTask, getNextPending, claimNextPending, getTask, getAllTasks, getTasksByStatus, getRecentDone, getAllDoneTitles, getFailedTasks, startTask, finishTask, revertToPending, requeueTask, suppressTask, suppressTerminalFailedTask, suppressTerminalFailedTasks, getRetryCount, updateTaskCost, updateTaskPriority, cancelTask, appendLog, getTaskLogs, getTasksSince, recoverOrphanedTasks } from "./db/tasks.js"
export { insertChatMessage, getChatMessages } from "./db/chat-messages.js"
export { insertAgentEvent, getAgentEvents, getEventsByTaskId } from "./db/events.js"
export { getImprovement, getActiveImprovements, getRecentImprovements, updateImprovementStatus } from "./db/improvements.js"
export { getSpcMetrics } from "./db/spc-query.js"
export { getPipelineStats, getCostStats } from "./db/stats.js"
