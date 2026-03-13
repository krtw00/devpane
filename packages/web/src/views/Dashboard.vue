<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useTasks, fetchSchedulerStatus, fetchPipelineStats, createTask, type Task, type PipelineStats, type SchedulerStatus } from '../composables/useApi'
import { useSocket, onWsEvent, sendChat } from '../composables/useSocket'

const { tasks, loading, refresh } = useTasks()
const { connected } = useSocket()

const scheduler = ref<SchedulerStatus | null>(null)
const pipelineStats = ref<PipelineStats | null>(null)

async function refreshAll() {
  refresh()
  try { scheduler.value = await fetchSchedulerStatus() } catch {}
  try { pipelineStats.value = await fetchPipelineStats() } catch {}
}

let timer: ReturnType<typeof setInterval>
onMounted(() => { refreshAll(); timer = setInterval(refreshAll, 3000) })
onUnmounted(() => clearInterval(timer))

// --- Agent live streams ---
type LogLine = { text: string; type: 'text' | 'tool' | 'info' }

const pmLog = ref<LogLine[]>([])
const workerLog = ref<LogLine[]>([])
const pmLogEl = ref<HTMLElement | null>(null)
const workerLogEl = ref<HTMLElement | null>(null)

const MAX_LOG_LINES = 200

function pushLog(log: typeof pmLog, line: LogLine) {
  log.value.push(line)
  if (log.value.length > MAX_LOG_LINES) log.value.splice(0, log.value.length - MAX_LOG_LINES)
}

// Worker stream events
onWsEvent('worker:text', (p) => {
  const { text } = p as { taskId: string; text: string }
  // Accumulate text until newline, then push as a line
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

// PM events
onWsEvent('pm:reasoning', (p) => {
  const { reasoning } = p as { reasoning: string }
  pushLog(pmLog, { text: reasoning, type: 'text' })
  nextTick(() => pmLogEl.value?.scrollTo(0, pmLogEl.value.scrollHeight))
})

onWsEvent('pm:task_generated', (p) => {
  const { title, priority } = p as { title: string; priority: number }
  pushLog(pmLog, { text: `→ ${title} (p=${priority})`, type: 'info' })
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
  pushLog(workerLog, { text: `── ${payload.stage} ──`, type: 'info' })
})

onWsEvent('task:created', () => refresh())
onWsEvent('task:updated', () => refreshAll())

// Clear worker log when new task starts
watch(() => scheduler.value?.worker.taskId, (newId, oldId) => {
  if (newId && newId !== oldId) workerLog.value = []
})

// --- Pipeline stages ---
const STAGES = ['gate1', 'tester', 'gate2', 'worker', 'gate3', 'pr'] as const
function stageLabel(s: string) { return { gate1: 'G1', tester: 'Test', gate2: 'G2', worker: 'Worker', gate3: 'G3', pr: 'PR' }[s] ?? s }
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
  return min < 60 ? `${min}m${sec % 60 ? ` ${sec % 60}s` : ''}` : `${Math.floor(min / 60)}h ${min % 60}m`
}

// --- Task list ---
const counts = computed(() => {
  const c = { pending: 0, running: 0, done: 0, failed: 0 }
  for (const t of tasks.value) c[t.status]++
  return c
})

const recentTasks = computed(() =>
  [...tasks.value].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 15)
)

function statusIcon(s: Task['status']) { return { pending: '⏳', running: '⚡', done: '✅', failed: '❌' }[s] }
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`
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
        <div class="brand"><h1>DevPane</h1><span class="sub">the office window</span></div>
        <nav>
          <router-link to="/">Office</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/memories">Mem</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics">SPC</router-link>
          <router-link to="/improvements">Kaizen</router-link>
        </nav>
        <div class="conn" :class="connected ? 'on' : 'off'"><span class="dot"/>{{ connected ? 'live' : 'off' }}</div>
      </div>
    </header>

    <!-- Pipeline Stage Bar -->
    <div v-if="scheduler?.worker.status === 'running'" class="pipeline-bar">
      <span class="pipe-title">{{ scheduler.worker.taskTitle }}</span>
      <span class="pipe-time">{{ elapsed(scheduler.worker.startedAt) }}</span>
      <div class="stages">
        <span v-for="s in STAGES" :key="s" class="stg" :class="{ on: isActiveStage(s), done: isPastStage(s) }">{{ stageLabel(s) }}</span>
      </div>
    </div>
    <div v-else class="pipeline-bar idle">
      <span class="pipe-title">
        <template v-if="scheduler?.pm.status === 'running'">PM thinking...</template>
        <template v-else-if="!scheduler?.withinActiveHours">sleeping (outside active hours)</template>
        <template v-else-if="scheduler?.paused">paused</template>
        <template v-else>idle — waiting for tasks</template>
      </span>
    </div>

    <!-- Agent Panes (Shogun-style) -->
    <div class="panes">
      <!-- PM Pane -->
      <div class="pane" :class="{ active: scheduler?.pm.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-icon">🤖</span>
          <span class="pane-name">PM</span>
          <span class="pane-st">{{ scheduler?.pm.status ?? 'idle' }}</span>
        </div>
        <div ref="pmLogEl" class="pane-log">
          <div v-for="(l, i) in pmLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="pmLog.length === 0" class="log-empty">waiting for PM activity...</div>
        </div>
      </div>

      <!-- Worker Pane -->
      <div class="pane" :class="{ active: scheduler?.worker.status === 'running' }">
        <div class="pane-hdr">
          <span class="pane-icon">🔧</span>
          <span class="pane-name">Worker</span>
          <span class="pane-st">
            {{ scheduler?.worker.status ?? 'idle' }}
            <template v-if="scheduler?.worker.stage"> · {{ scheduler.worker.stage }}</template>
          </span>
        </div>
        <div ref="workerLogEl" class="pane-log">
          <div v-for="(l, i) in workerLog" :key="i" :class="['log-line', `t-${l.type}`]">{{ l.text }}</div>
          <div v-if="workerLog.length === 0" class="log-empty">waiting for worker activity...</div>
        </div>
      </div>
    </div>

    <!-- Stats + Tasks side by side -->
    <div class="bottom">
      <!-- Task List -->
      <div class="tasks-panel">
        <div class="tasks-hdr">
          <span class="tasks-title">Tasks</span>
          <span class="pill">{{ counts.done }}✓</span>
          <span class="pill">{{ counts.pending }}⏳</span>
          <span class="pill" :class="counts.failed > 0 ? 'bad' : ''">{{ counts.failed }}✗</span>
          <button class="add-btn" @click="showModal = true; taskForm = { title: '', description: '', priority: 50 }">+</button>
        </div>
        <ul class="tlist">
          <li v-for="task in recentTasks" :key="task.id" :class="`s-${task.status}`">
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
          <div v-if="chatLog.length === 0" class="log-empty">tell the team what to do...</div>
        </div>
        <form class="chat-form" @submit.prevent="send">
          <input v-model="chatInput" placeholder="message..." :disabled="sending" />
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
            <div class="mact"><button type="button" @click="showModal = false">Cancel</button><button type="submit" class="pri" :disabled="submitting">Create</button></div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
.office {
  max-width: 960px; margin: 0 auto; padding: 1rem;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: #c9d1d9; font-size: 0.8rem;
  display: flex; flex-direction: column; height: 100vh;
}

/* Header */
header { margin-bottom: 0.75rem; flex-shrink: 0; }
.hdr { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.brand { display: flex; align-items: baseline; gap: 0.4rem; }
h1 { font-size: 1.2rem; margin: 0; color: #f0f6fc; }
.sub { color: #484f58; font-size: 0.7rem; }
nav { display: flex; gap: 0.4rem; margin-left: auto; }
nav a { color: #8b949e; text-decoration: none; font-size: 0.75rem; padding: 0.15rem 0.3rem; border-radius: 3px; }
nav a:hover { color: #c9d1d9; }
nav a.router-link-exact-active { color: #58a6ff; }
.conn { display: flex; align-items: center; gap: 0.25rem; font-size: 0.65rem; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #f85149; display: inline-block; }
.conn.on .dot, .dot.on { background: #3fb950; box-shadow: 0 0 4px #3fb95080; }
.conn.on { color: #3fb950; }
.conn.off { color: #f85149; }

/* Pipeline bar */
.pipeline-bar {
  background: #161b22; border: 1px solid #d29922; border-radius: 6px;
  padding: 0.4rem 0.75rem; margin-bottom: 0.75rem; flex-shrink: 0;
  display: flex; align-items: center; gap: 0.75rem;
}
.pipeline-bar.idle { border-color: #30363d; }
.pipe-title { color: #f0f6fc; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pipeline-bar.idle .pipe-title { color: #484f58; font-weight: normal; }
.pipe-time { color: #d29922; font-size: 0.7rem; flex-shrink: 0; }
.stages { display: flex; gap: 0.2rem; margin-left: auto; flex-shrink: 0; }
.stg {
  padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.65rem; font-weight: 600;
  background: #21262d; color: #484f58;
}
.stg.done { background: #238636; color: #f0f6fc; }
.stg.on { background: #d29922; color: #0d1117; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }

/* Agent Panes */
.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem; flex: 1; min-height: 0; }
.pane {
  background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
  display: flex; flex-direction: column; overflow: hidden;
  transition: border-color 0.3s;
}
.pane.active { border-color: #d29922; }
.pane-hdr {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.35rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d;
  flex-shrink: 0;
}
.pane-icon { font-size: 1rem; }
.pane-name { font-weight: 600; color: #f0f6fc; font-size: 0.75rem; }
.pane-st { margin-left: auto; color: #8b949e; font-size: 0.65rem; }
.pane.active .pane-st { color: #d29922; }
.pane-log {
  flex: 1; overflow-y: auto; padding: 0.4rem; font-size: 0.7rem;
  line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
.log-line { }
.t-text { color: #8b949e; }
.t-tool { color: #58a6ff; font-weight: 600; }
.t-info { color: #d29922; text-align: center; font-size: 0.65rem; }
.log-empty { color: #30363d; text-align: center; padding: 2rem 0; }

/* Bottom: Tasks + Chat */
.bottom { display: grid; grid-template-columns: 1.5fr 1fr; gap: 0.5rem; flex-shrink: 0; max-height: 220px; }

.tasks-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
.tasks-hdr { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d; }
.tasks-title { font-weight: 600; color: #f0f6fc; font-size: 0.75rem; }
.pill { padding: 0.05rem 0.3rem; border-radius: 8px; font-size: 0.6rem; background: #21262d; color: #8b949e; }
.pill.bad { color: #f85149; }
.add-btn {
  margin-left: auto; background: #21262d; color: #8b949e; border: 1px solid #30363d;
  border-radius: 3px; width: 22px; height: 22px; font-size: 0.8rem; cursor: pointer; line-height: 1;
}
.add-btn:hover { color: #58a6ff; border-color: #58a6ff; }

.tlist { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
.tlist li { border-bottom: 1px solid #161b22; }
.tlist li a { display: flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.5rem; color: inherit; text-decoration: none; }
.tlist li a:hover { background: #161b22; }
.ti { font-size: 0.75rem; flex-shrink: 0; }
.tt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #c9d1d9; }
.tm { color: #484f58; font-size: 0.6rem; flex-shrink: 0; }
.s-running { border-left: 2px solid #d29922; }
.s-failed { border-left: 2px solid #f85149; }

.chat-panel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
.chat-hdr { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; background: #161b22; border-bottom: 1px solid #21262d; font-weight: 600; color: #f0f6fc; font-size: 0.75rem; }
.chat-log { flex: 1; overflow-y: auto; padding: 0.4rem; font-size: 0.7rem; line-height: 1.5; }
.chat-msg { }
.cf { color: #58a6ff; margin-right: 0.3rem; }
.chat-form { display: flex; gap: 0.3rem; padding: 0.3rem; border-top: 1px solid #21262d; }
.chat-form input {
  flex: 1; background: #161b22; border: 1px solid #21262d; border-radius: 3px;
  padding: 0.25rem 0.4rem; color: #c9d1d9; font-family: inherit; font-size: 0.75rem; outline: none;
}
.chat-form input:focus { border-color: #58a6ff; }
.chat-form button {
  background: #238636; color: #f0f6fc; border: none; border-radius: 3px;
  padding: 0.25rem 0.5rem; font-family: inherit; font-size: 0.75rem; cursor: pointer;
}
.chat-form button:disabled { opacity: 0.4; }

.empty { text-align: center; color: #30363d; padding: 1.5rem 0; }

/* Modal */
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 1.25rem; width: 380px; max-width: 90vw; color: #c9d1d9; font-family: inherit;
}
.modal h3 { margin: 0 0 0.75rem; color: #f0f6fc; font-size: 1rem; }
.modal label { display: block; margin-bottom: 0.5rem; font-size: 0.75rem; color: #8b949e; }
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
