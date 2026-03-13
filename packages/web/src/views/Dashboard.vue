<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import {
  useTasks, fetchSchedulerStatus, fetchPipelineStats,
  createTask, pauseScheduler, resumeScheduler,
  type Task, type PipelineStats, type SchedulerStatus,
} from '../composables/useApi'
import { useSocket, onWsEvent, sendChat } from '../composables/useSocket'

const { tasks, loading, refresh } = useTasks()
const { connected } = useSocket()

const scheduler = ref<SchedulerStatus | null>(null)
const pipeline = ref<PipelineStats | null>(null)

async function refreshAll() {
  refresh()
  try { scheduler.value = await fetchSchedulerStatus() } catch {}
  try { pipeline.value = await fetchPipelineStats() } catch {}
}

let timer: ReturnType<typeof setInterval>
onMounted(() => { refreshAll(); timer = setInterval(refreshAll, 3000) })
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

// Worker stream events
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

// PM events
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

// Stage updates
onWsEvent('scheduler:stage', (p) => {
  const payload = p as { stage: string; taskId: string; taskTitle: string }
  if (scheduler.value) {
    scheduler.value.worker.stage = payload.stage
    scheduler.value.worker.taskId = payload.taskId
    scheduler.value.worker.taskTitle = payload.taskTitle
  }
  pushLog(workerLog, { text: `── ${payload.stage.toUpperCase()} ──`, type: 'stage' })
})

onWsEvent('task:created', () => refresh())
onWsEvent('task:updated', () => refreshAll())

// Clear worker log when new task starts
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

// --- Task list ---
const taskFilter = ref<'all' | 'pending' | 'running' | 'done' | 'failed'>('all')

const counts = computed(() => {
  const c = { pending: 0, running: 0, done: 0, failed: 0 }
  for (const t of tasks.value) c[t.status]++
  return c
})

const filteredTasks = computed(() => {
  let list = [...tasks.value].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  if (taskFilter.value !== 'all') list = list.filter(t => t.status === taskFilter.value)
  return list.slice(0, 30)
})

function statusIcon(s: Task['status']) { return { pending: '⏳', running: '⚡', done: '✅', failed: '❌' }[s] }
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`
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

// --- Modal ---
const showModal = ref(false)
const taskForm = ref({ title: '', description: '', priority: 50 })
const submitting = ref(false)
async function submitTask() {
  if (submitting.value) return; submitting.value = true
  try { await createTask(taskForm.value); showModal.value = false; refresh() } finally { submitting.value = false }
}
</script>

<template>
  <div class="office">
    <!-- Header -->
    <header>
      <div class="hdr">
        <div class="brand">
          <h1>DevPane</h1>
          <span class="sub">the office window</span>
        </div>
        <div class="stats-bar" v-if="pipeline">
          <span class="stat">G3: {{ Math.round((pipeline.gate3_pass_rate ?? 0) * 100) }}%</span>
          <span class="stat">today: {{ pipeline.tasks_today ?? 0 }}</span>
          <span class="stat fail" v-if="pipeline.consecutive_failures > 0">fail streak: {{ pipeline.consecutive_failures }}</span>
        </div>
        <nav>
          <router-link to="/">Office</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/memories">Memory</router-link>
          <router-link to="/cost">Cost</router-link>
        </nav>
        <div class="ctrl">
          <button class="ctrl-btn" :class="scheduler?.paused ? 'resume' : 'pause'" @click="togglePause" :disabled="toggling || !scheduler">
            {{ scheduler?.paused ? '▶ resume' : '⏸ pause' }}
          </button>
          <span class="conn" :class="connected ? 'on' : 'off'"><span class="dot"/>{{ connected ? 'live' : 'off' }}</span>
        </div>
      </div>
    </header>

    <!-- Pipeline Stage Bar -->
    <div v-if="scheduler?.worker.status === 'running'" class="pipeline-bar active">
      <div class="pipe-info">
        <span class="pipe-title">{{ scheduler.worker.taskTitle }}</span>
        <span class="pipe-time">{{ elapsed(scheduler.worker.startedAt) }}</span>
      </div>
      <div class="stages">
        <span v-for="s in STAGES" :key="s" class="stg" :class="{ on: isActiveStage(s), done: isPastStage(s) }">{{ STAGE_LABELS[s] }}</span>
      </div>
    </div>
    <div v-else class="pipeline-bar">
      <div class="pipe-info">
        <span class="pipe-title idle-title">
          <template v-if="scheduler?.pm.status === 'running'">PM generating tasks...</template>
          <template v-else-if="!scheduler?.withinActiveHours">sleeping (outside active hours)</template>
          <template v-else-if="scheduler?.paused">paused</template>
          <template v-else>idle</template>
        </span>
      </div>
    </div>

    <!-- Main content: Agent Panes -->
    <div class="panes">
      <!-- PM Pane -->
      <div class="pane" :class="{ active: scheduler?.pm.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-name">PM</span>
          <span class="pane-st" :class="scheduler?.pm.status">{{ scheduler?.pm.status ?? 'idle' }}</span>
          <button class="pane-clear" @click="pmLog = []" v-if="pmLog.length > 0" title="clear">×</button>
        </div>
        <div ref="pmLogEl" class="pane-log">
          <div v-for="(l, i) in pmLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="pmLog.length === 0" class="log-empty">waiting for PM...</div>
        </div>
      </div>

      <!-- Worker Pane -->
      <div class="pane" :class="{ active: scheduler?.worker.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-name">Worker</span>
          <span class="pane-st" :class="scheduler?.worker.status">
            {{ scheduler?.worker.status ?? 'idle' }}
            <template v-if="scheduler?.worker.stage"> · {{ scheduler.worker.stage }}</template>
          </span>
          <button class="pane-clear" @click="workerLog = []" v-if="workerLog.length > 0" title="clear">×</button>
        </div>
        <div ref="workerLogEl" class="pane-log">
          <div v-for="(l, i) in workerLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="workerLog.length === 0" class="log-empty">waiting for worker...</div>
        </div>
      </div>
    </div>

    <!-- Bottom: Tasks + Chat -->
    <div class="bottom">
      <!-- Task List -->
      <div class="tasks-panel">
        <div class="tasks-hdr">
          <span class="tasks-title">Tasks</span>
          <div class="filter-tabs">
            <button :class="{ active: taskFilter === 'all' }" @click="taskFilter = 'all'">all {{ tasks.length }}</button>
            <button :class="{ active: taskFilter === 'done' }" @click="taskFilter = 'done'">✓{{ counts.done }}</button>
            <button :class="{ active: taskFilter === 'pending' }" @click="taskFilter = 'pending'">⏳{{ counts.pending }}</button>
            <button :class="{ active: taskFilter === 'running' }" @click="taskFilter = 'running'">⚡{{ counts.running }}</button>
            <button :class="{ active: taskFilter === 'failed', bad: counts.failed > 0 }" @click="taskFilter = 'failed'">✗{{ counts.failed }}</button>
          </div>
          <button class="add-btn" @click="showModal = true; taskForm = { title: '', description: '', priority: 50 }" title="new task">+</button>
        </div>
        <ul class="tlist">
          <li v-for="task in filteredTasks" :key="task.id" :class="`s-${task.status}`">
            <router-link :to="`/tasks/${task.id}`">
              <span class="ti">{{ statusIcon(task.status) }}</span>
              <span class="tt">{{ task.title }}</span>
              <span class="tm">{{ timeAgo(task.finished_at || task.started_at || task.created_at) }}</span>
            </router-link>
          </li>
        </ul>
        <div v-if="!loading && tasks.length === 0" class="empty">no tasks yet</div>
      </div>

      <!-- Chat -->
      <div class="chat-panel">
        <div class="chat-hdr">Chat <span class="dot" :class="connected ? 'on' : ''"/></div>
        <div ref="chatEl" class="chat-log">
          <div v-for="(m, i) in chatLog" :key="i" class="chat-msg"><span class="cf">[{{ m.from }}]</span> {{ m.text }}</div>
          <div v-if="chatLog.length === 0" class="log-empty">send instructions to the team...</div>
        </div>
        <form class="chat-form" @submit.prevent="send">
          <input v-model="chatInput" placeholder="message..." :disabled="sending" @keydown.ctrl.enter.prevent="send" />
          <button type="submit" :disabled="sending || !chatInput.trim()">send</button>
        </form>
      </div>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
        <div class="modal">
          <h3>New Task</h3>
          <form @submit.prevent="submitTask">
            <label>Title<input v-model="taskForm.title" required /></label>
            <label>Description<textarea v-model="taskForm.description" required rows="3" /></label>
            <label>Priority<input v-model.number="taskForm.priority" type="number" min="0" max="100" /></label>
            <div class="mact">
              <button type="button" @click="showModal = false">Cancel</button>
              <button type="submit" class="pri" :disabled="submitting">Create</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
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

nav { display: flex; gap: 0.3rem; margin-left: auto; }
nav a { color: #484f58; text-decoration: none; font-size: 0.7rem; padding: 0.15rem 0.35rem; border-radius: 3px; }
nav a:hover { color: #c9d1d9; }
nav a.router-link-exact-active { color: #58a6ff; background: #58a6ff15; }

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
.pipe-title { color: #f0f6fc; font-weight: 600; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

/* Bottom: Tasks + Chat */
.bottom { display: grid; grid-template-columns: 1.5fr 1fr; gap: 0.5rem; flex-shrink: 0; height: 220px; }

.tasks-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
.tasks-hdr {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d;
}
.tasks-title { font-weight: 700; color: #f0f6fc; font-size: 0.7rem; }

.filter-tabs { display: flex; gap: 1px; margin-left: 0.5rem; }
.filter-tabs button {
  font-family: inherit; font-size: 0.55rem; padding: 0.1rem 0.3rem;
  background: #21262d; color: #484f58; border: none; cursor: pointer;
}
.filter-tabs button:first-child { border-radius: 3px 0 0 3px; }
.filter-tabs button:last-child { border-radius: 0 3px 3px 0; }
.filter-tabs button.active { background: #30363d; color: #c9d1d9; }
.filter-tabs button.bad { color: #f85149; }

.add-btn {
  margin-left: auto; background: #21262d; color: #8b949e; border: 1px solid #30363d;
  border-radius: 3px; width: 20px; height: 20px; font-size: 0.75rem; cursor: pointer; line-height: 1;
}
.add-btn:hover { color: #58a6ff; border-color: #58a6ff; }

.tlist { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
.tlist li { border-bottom: 1px solid #161b22; }
.tlist li a { display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem; color: inherit; text-decoration: none; }
.tlist li a:hover { background: #161b22; }
.ti { font-size: 0.7rem; flex-shrink: 0; }
.tt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #c9d1d9; font-size: 0.7rem; }
.tm { color: #484f58; font-size: 0.55rem; flex-shrink: 0; }
.s-running { border-left: 2px solid #d29922; }
.s-failed { border-left: 2px solid #f85149; }

.chat-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
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

.empty { text-align: center; color: #30363d; padding: 1.5rem 0; }

/* Modal */
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 1.25rem; width: 400px; max-width: 90vw; color: #c9d1d9; font-family: inherit;
}
.modal h3 { margin: 0 0 0.75rem; color: #f0f6fc; font-size: 1rem; }
.modal label { display: block; margin-bottom: 0.5rem; font-size: 0.7rem; color: #8b949e; }
.modal input, .modal textarea {
  display: block; width: 100%; margin-top: 0.15rem; background: #0d1117; border: 1px solid #21262d;
  border-radius: 4px; padding: 0.35rem 0.5rem; color: #c9d1d9; font-family: inherit; font-size: 0.8rem;
  outline: none; box-sizing: border-box;
}
.modal input:focus, .modal textarea:focus { border-color: #58a6ff; }
.modal textarea { resize: vertical; min-height: 50px; }
.mact { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.75rem; }
.mact button { background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 4px; padding: 0.3rem 0.6rem; font-family: inherit; font-size: 0.8rem; cursor: pointer; }
.mact button.pri { background: #238636; color: #f0f6fc; border: none; }
.mact button.pri:disabled { opacity: 0.4; }
</style>
