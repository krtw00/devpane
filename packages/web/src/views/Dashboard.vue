<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  fetchSchedulerStatus, fetchPipelineStats, fetchEvents,
  pauseScheduler, resumeScheduler,
  type PipelineStats, type SchedulerStatus, type AgentEvent,
} from '../composables/useApi'
import { useSocket, onWsEvent, sendChat } from '../composables/useSocket'

const { connected } = useSocket()

const scheduler = ref<SchedulerStatus | null>(null)
const pipeline = ref<PipelineStats | null>(null)

const recentEvents = ref<AgentEvent[]>([])

async function refreshStatus() {
  try { scheduler.value = await fetchSchedulerStatus() } catch {}
  try { pipeline.value = await fetchPipelineStats() } catch {}
  try { recentEvents.value = await fetchEvents(20) } catch {}
}

let timer: ReturnType<typeof setInterval>
onMounted(() => { refreshStatus(); timer = setInterval(refreshStatus, 3000) })
onUnmounted(() => clearInterval(timer))

// --- Scheduler control ---
const toggling = ref(false)
async function togglePause() {
  if (!scheduler.value || toggling.value) return
  toggling.value = true
  try {
    if (scheduler.value.paused) await resumeScheduler()
    else await pauseScheduler()
    scheduler.value = await fetchSchedulerStatus()
  } finally { toggling.value = false }
}

// --- Agent live streams ---
type LogLine = { text: string; type: 'text' | 'tool' | 'tool-input' | 'info' | 'stage' }

const pmLog = ref<LogLine[]>([])
const workerLog = ref<LogLine[]>([])
const pmLogEl = ref<HTMLElement | null>(null)
const workerLogEl = ref<HTMLElement | null>(null)

const MAX_LOG_LINES = 300

function pushLog(log: typeof pmLog, line: LogLine) {
  log.value.push(line)
  if (log.value.length > MAX_LOG_LINES) log.value.splice(0, log.value.length - MAX_LOG_LINES)
}

onWsEvent('worker:text', (p) => {
  const { text } = p as { taskId: string; text: string }
  const last = workerLog.value[workerLog.value.length - 1]
  if (last && last.type === 'text' && !last.text.includes('\n')) {
    last.text += text
  } else {
    pushLog(workerLog, { text, type: 'text' })
  }
  nextTick(() => workerLogEl.value?.scrollTo(0, workerLogEl.value.scrollHeight))
})

onWsEvent('worker:tool', (p) => {
  const { tool } = p as { taskId: string; tool: string }
  pushLog(workerLog, { text: `▶ ${tool}`, type: 'tool' })
  nextTick(() => workerLogEl.value?.scrollTo(0, workerLogEl.value.scrollHeight))
})

onWsEvent('worker:tool_input', (p) => {
  const { json } = p as { taskId: string; json: string }
  const last = workerLog.value[workerLog.value.length - 1]
  if (last && last.type === 'tool-input') {
    last.text += json
  } else {
    pushLog(workerLog, { text: json, type: 'tool-input' })
  }
  nextTick(() => workerLogEl.value?.scrollTo(0, workerLogEl.value.scrollHeight))
})

onWsEvent('pm:reasoning', (p) => {
  const { reasoning } = p as { reasoning: string }
  pushLog(pmLog, { text: reasoning, type: 'text' })
  nextTick(() => pmLogEl.value?.scrollTo(0, pmLogEl.value.scrollHeight))
})

onWsEvent('pm:task_generated', (p) => {
  const { title, priority } = p as { title: string; priority: number }
  pushLog(pmLog, { text: `+ ${title} (p=${priority})`, type: 'info' })
  nextTick(() => pmLogEl.value?.scrollTo(0, pmLogEl.value.scrollHeight))
})

onWsEvent('scheduler:stage', (p) => {
  const payload = p as { stage: string; taskId: string; taskTitle: string }
  if (scheduler.value) {
    scheduler.value.worker.stage = payload.stage
    scheduler.value.worker.taskId = payload.taskId
    scheduler.value.worker.taskTitle = payload.taskTitle
  }
  pushLog(workerLog, { text: `── ${payload.stage.toUpperCase()} ──`, type: 'stage' })
})

onWsEvent('task:updated', () => refreshStatus())
onWsEvent('event', () => refreshStatus())

function eventIcon(type: string): string {
  if (type.includes('completed')) return '✅'
  if (type.includes('failed')) return '❌'
  if (type.includes('passed')) return '🟢'
  if (type.includes('rejected')) return '🔴'
  if (type.includes('started')) return '⚡'
  if (type.includes('created')) return '📝'
  if (type.includes('pr.')) return '🔗'
  if (type.includes('spc')) return '📊'
  return '•'
}

function eventSummary(e: AgentEvent): string {
  const id = e.taskId ? `[${String(e.taskId).slice(-6)}]` : ''
  switch (e.type) {
    case 'task.completed': return `${id} 完了 ($${Number(e.costUsd ?? 0).toFixed(2)})`
    case 'task.failed': return `${id} 失敗: ${e.rootCause ?? 'unknown'}`
    case 'gate.passed': return `${id} ${e.gate} 通過`
    case 'gate.rejected': return `${id} ${e.gate} ${e.verdict}: ${String(e.reason ?? '').slice(0, 40)}`
    case 'task.started': return `${id} 実行開始 → ${e.workerId}`
    case 'task.created': return `${id} 作成 by ${e.by}`
    case 'pr.created': return `${id} PR作成`
    case 'pm.invoked': return 'PM呼び出し'
    case 'pm.failed': return `PM失敗 (${e.consecutiveCount}回目)`
    case 'spc.alert': return `SPC異常: ${e.metric}`
    default: return e.type
  }
}

watch(() => scheduler.value?.worker.taskId, (newId, oldId) => {
  if (newId && newId !== oldId) workerLog.value = []
})

// --- Pipeline stages ---
const STAGES = ['gate1', 'tester', 'gate2', 'worker', 'gate3', 'pr'] as const
const STAGE_LABELS: Record<string, string> = { gate1: 'G1', tester: 'Test', gate2: 'G2', worker: 'Work', gate3: 'G3', pr: 'PR' }
function isActiveStage(s: string) { return scheduler.value?.worker.stage === s }
function isPastStage(s: string) {
  const c = scheduler.value?.worker.stage
  if (!c) return false
  return STAGES.indexOf(s as typeof STAGES[number]) < STAGES.indexOf(c as typeof STAGES[number])
}

function elapsed(iso: string | null): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60}m`
}

// --- Chat ---
const chatInput = ref('')
const sending = ref(false)
const chatLog = ref<{ from: string; text: string }[]>([])
const chatEl = ref<HTMLElement | null>(null)

onWsEvent('chat', (payload) => {
  const p = payload as { message: string; category: string | null }
  chatLog.value.push({ from: p.category ? `you:${p.category}` : 'you', text: p.message })
  nextTick(() => chatEl.value?.scrollTo(0, chatEl.value.scrollHeight))
})

async function send() {
  const msg = chatInput.value.trim()
  if (!msg || sending.value) return
  sending.value = true; chatInput.value = ''
  try { await sendChat(msg) } finally { sending.value = false }
}
</script>

<template>
  <div class="office">
    <!-- Header -->
    <header>
      <div class="hdr">
        <div class="brand">
          <h1>DevPane</h1>
          <span class="sub">autonomous dev team</span>
        </div>
        <div class="stats-bar">
          <template v-if="pipeline">
            <span class="stat">G3通過率: {{ Math.round((pipeline.gate3_pass_rate ?? 0) * 100) }}%</span>
            <span class="stat">本日: {{ pipeline.tasks_today ?? 0 }}件</span>
            <span class="stat fail" v-if="pipeline.consecutive_failures > 0">連続失敗: {{ pipeline.consecutive_failures }}</span>
          </template>
          <span class="stat warn" v-if="scheduler?.rateLimitHits">RL: {{ scheduler.rateLimitHits }}回</span>
          <span class="stat" v-if="scheduler?.activeHours">稼働: {{ scheduler.activeHours.start }}:00–{{ scheduler.activeHours.end }}:00</span>
        </div>
        <div class="spacer" />
        <router-link to="/tasks" class="nav-link">タスク管理</router-link>
        <div class="ctrl">
          <button class="ctrl-btn" :class="scheduler?.paused ? 'resume' : 'pause'" @click="togglePause" :disabled="toggling || !scheduler">
            {{ scheduler?.paused ? '▶ 再開' : '⏸ 一時停止' }}
          </button>
          <span class="conn" :class="connected ? 'on' : 'off'"><span class="dot"/>{{ connected ? '接続中' : '切断' }}</span>
        </div>
      </div>
    </header>

    <!-- Pipeline Stage Bar -->
    <div v-if="scheduler?.worker.status === 'running'" class="pipeline-bar active">
      <div class="pipe-info">
        <router-link v-if="scheduler.worker.taskId" :to="`/tasks/${scheduler.worker.taskId}`" class="pipe-title pipe-link">{{ scheduler.worker.taskTitle }}</router-link>
        <span v-else class="pipe-title">{{ scheduler.worker.taskTitle }}</span>
        <span class="pipe-time">{{ elapsed(scheduler.worker.startedAt) }}</span>
      </div>
      <div class="stages">
        <span v-for="s in STAGES" :key="s" class="stg" :class="{ on: isActiveStage(s), done: isPastStage(s) }">{{ STAGE_LABELS[s] }}</span>
      </div>
    </div>
    <div v-else class="pipeline-bar">
      <div class="pipe-info">
        <span class="pipe-title idle-title">
          <template v-if="scheduler?.pm.status === 'running'">PM タスク生成中...</template>
          <template v-else-if="!scheduler?.withinActiveHours">稼働時間外（休憩中）</template>
          <template v-else-if="scheduler?.paused">一時停止中</template>
          <template v-else>待機中</template>
        </span>
      </div>
    </div>

    <!-- Agent Panes -->
    <div class="panes">
      <div class="pane" :class="{ active: scheduler?.pm.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-name">PM</span>
          <span class="pane-st" :class="scheduler?.pm.status">{{ scheduler?.pm.status === 'running' ? '実行中' : '待機' }}</span>
          <button class="pane-clear" @click="pmLog = []" v-if="pmLog.length > 0" title="クリア">×</button>
        </div>
        <div ref="pmLogEl" class="pane-log">
          <div v-for="(l, i) in pmLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="pmLog.length === 0" class="log-empty">PMの出力を待機中...</div>
        </div>
      </div>

      <div class="pane" :class="{ active: scheduler?.worker.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-name">Worker</span>
          <span class="pane-st" :class="scheduler?.worker.status">
            {{ scheduler?.worker.status === 'running' ? '実行中' : '待機' }}
            <template v-if="scheduler?.worker.stage"> · {{ scheduler.worker.stage }}</template>
          </span>
          <button class="pane-clear" @click="workerLog = []" v-if="workerLog.length > 0" title="クリア">×</button>
        </div>
        <div ref="workerLogEl" class="pane-log">
          <div v-for="(l, i) in workerLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="workerLog.length === 0" class="log-empty">Workerの出力を待機中...</div>
        </div>
      </div>
    </div>

    <!-- Bottom: Events + Chat -->
    <div class="bottom">
      <!-- Event Feed -->
      <div class="feed-panel">
        <div class="feed-hdr">イベントフィード</div>
        <div class="feed-log">
          <div v-for="(e, i) in recentEvents" :key="i" class="feed-item" :class="e.type.includes('failed') || e.type.includes('rejected') ? 'bad' : ''">
            <span class="feed-icon">{{ eventIcon(e.type) }}</span>
            <span class="feed-text">{{ eventSummary(e) }}</span>
          </div>
          <div v-if="recentEvents.length === 0" class="log-empty">イベントなし</div>
        </div>
      </div>

    <!-- Chat -->
    <div class="chat-panel">
      <div class="chat-hdr">チャット <span class="dot" :class="connected ? 'on' : ''"/></div>
      <div ref="chatEl" class="chat-log">
        <div v-for="(m, i) in chatLog" :key="i" class="chat-msg"><span class="cf">[{{ m.from }}]</span> {{ m.text }}</div>
        <div v-if="chatLog.length === 0" class="log-empty">チームに指示を送る...</div>
      </div>
      <form class="chat-form" @submit.prevent="send">
        <input v-model="chatInput" placeholder="メッセージ..." :disabled="sending" @keydown.ctrl.enter.prevent="send" />
        <button type="submit" :disabled="sending || !chatInput.trim()">送信</button>
      </form>
    </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.office {
  margin: 0 auto; padding: 0.75rem 1rem;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: #c9d1d9; font-size: 13px;
  display: flex; flex-direction: column; height: 100vh;
  max-width: 1400px;
}

/* Header */
header { flex-shrink: 0; margin-bottom: 0.5rem; }
.hdr { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.brand { display: flex; align-items: baseline; gap: 0.35rem; }
h1 { font-size: 1.1rem; margin: 0; color: #f0f6fc; letter-spacing: -0.5px; }
.sub { color: #484f58; font-size: 0.65rem; }

.stats-bar { display: flex; gap: 0.5rem; }
.stat {
  font-size: 0.65rem; color: #8b949e;
  padding: 0.1rem 0.4rem; background: #161b22; border-radius: 3px;
}
.stat.fail { color: #f85149; }
.stat.warn { color: #d29922; }

.spacer { flex: 1; }

.nav-link { color: #58a6ff; text-decoration: none; font-size: 0.7rem; }
.nav-link:hover { text-decoration: underline; }

.ctrl { display: flex; align-items: center; gap: 0.5rem; }
.ctrl-btn {
  font-family: inherit; font-size: 0.65rem; padding: 0.2rem 0.5rem;
  border-radius: 4px; border: 1px solid #30363d; cursor: pointer;
  background: #21262d; color: #8b949e;
}
.ctrl-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
.ctrl-btn.resume { border-color: #238636; color: #3fb950; }
.ctrl-btn.pause { border-color: #d29922; color: #d29922; }
.ctrl-btn:disabled { opacity: 0.4; cursor: default; }

.conn { display: flex; align-items: center; gap: 0.2rem; font-size: 0.6rem; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #f85149; display: inline-block; }
.conn.on .dot, .dot.on { background: #3fb950; box-shadow: 0 0 4px #3fb95080; }
.conn.on { color: #3fb950; }
.conn.off { color: #f85149; }

/* Pipeline bar */
.pipeline-bar {
  background: #161b22; border: 1px solid #30363d; border-radius: 6px;
  padding: 0.35rem 0.75rem; margin-bottom: 0.5rem; flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  min-height: 36px;
}
.pipeline-bar.active { border-color: #d29922; }
.pipe-info { display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1; }
.pipe-title { color: #f0f6fc; font-weight: 600; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
.pipe-link:hover { text-decoration: underline; color: #58a6ff; }
.idle-title { color: #484f58; font-weight: normal; }
.pipe-time { color: #d29922; font-size: 0.65rem; flex-shrink: 0; }
.stages { display: flex; gap: 2px; flex-shrink: 0; }
.stg {
  padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;
  background: #21262d; color: #30363d; letter-spacing: -0.3px;
}
.stg.done { background: #238636; color: #f0f6fc; }
.stg.on { background: #d29922; color: #0d1117; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.65; } }

/* Agent Panes */
.panes {
  display: grid; grid-template-columns: 1fr 1.5fr; gap: 0.5rem;
  flex: 1; min-height: 0; margin-bottom: 0.5rem;
}
.pane {
  background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
  display: flex; flex-direction: column; overflow: hidden;
  transition: border-color 0.2s;
}
.pane.active { border-color: #d2992280; }
.pane-hdr {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d;
  flex-shrink: 0;
}
.pane-name { font-weight: 700; color: #f0f6fc; font-size: 0.7rem; }
.pane-st { margin-left: auto; font-size: 0.6rem; color: #484f58; }
.pane-st.running { color: #d29922; }
.pane-st.idle { color: #484f58; }
.pane-clear {
  background: none; border: none; color: #484f58; cursor: pointer;
  font-size: 0.8rem; padding: 0 0.2rem; line-height: 1;
}
.pane-clear:hover { color: #f85149; }

.pane-log {
  flex: 1; overflow-y: auto; padding: 0.35rem 0.5rem; font-size: 0.7rem;
  line-height: 1.6; white-space: pre-wrap; word-break: break-word;
}
.log-line { }
.t-text { color: #8b949e; }
.t-tool { color: #58a6ff; font-weight: 700; padding: 0.1rem 0; }
.t-tool-input { color: #484f58; font-size: 0.65rem; }
.t-info { color: #3fb950; }
.t-stage { color: #d29922; text-align: center; font-size: 0.6rem; padding: 0.15rem 0; letter-spacing: 1px; }
.log-empty { color: #30363d; text-align: center; padding: 2rem 0; font-size: 0.75rem; }

/* Bottom: Events + Chat */
.bottom { display: grid; grid-template-columns: 1.2fr 1fr; gap: 0.5rem; flex-shrink: 0; height: 180px; }

/* Event Feed */
.feed-panel {
  background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
  display: flex; flex-direction: column; overflow: hidden;
}
.feed-hdr { padding: 0.3rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d; font-weight: 700; color: #f0f6fc; font-size: 0.7rem; }
.feed-log { flex: 1; overflow-y: auto; padding: 0.25rem 0.5rem; font-size: 0.65rem; }
.feed-item { display: flex; align-items: flex-start; gap: 0.3rem; padding: 0.15rem 0; color: #8b949e; }
.feed-item.bad { color: #f85149; }
.feed-icon { flex-shrink: 0; font-size: 0.7rem; }
.feed-text { word-break: break-word; }

/* Chat */
.chat-panel {
  background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
  display: flex; flex-direction: column; overflow: hidden;
}
.chat-hdr { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d; font-weight: 700; color: #f0f6fc; font-size: 0.7rem; }
.chat-log { flex: 1; overflow-y: auto; padding: 0.35rem 0.5rem; font-size: 0.7rem; line-height: 1.5; }
.chat-msg { }
.cf { color: #58a6ff; margin-right: 0.3rem; }
.chat-form { display: flex; gap: 0.25rem; padding: 0.25rem; border-top: 1px solid #21262d; }
.chat-form input {
  flex: 1; background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 0.2rem 0.4rem; color: #c9d1d9; font-family: inherit; font-size: 0.7rem; outline: none;
}
.chat-form input:focus { border-color: #58a6ff; }
.chat-form button {
  background: #238636; color: #f0f6fc; border: none; border-radius: 3px;
  padding: 0.2rem 0.5rem; font-family: inherit; font-size: 0.7rem; cursor: pointer;
}
.chat-form button:disabled { opacity: 0.3; }
</style>
