<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
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

onMounted(() => {
  refreshAll()
  timer = setInterval(refreshAll, 3000)
})
onUnmounted(() => clearInterval(timer))

onWsEvent('task:created', () => refresh())
onWsEvent('task:updated', () => refreshAll())
onWsEvent('scheduler:stage', (p) => {
  const payload = p as { stage: string; taskId: string; taskTitle: string }
  if (scheduler.value) {
    scheduler.value.worker.stage = payload.stage
    scheduler.value.worker.taskId = payload.taskId
    scheduler.value.worker.taskTitle = payload.taskTitle
  }
})

// --- Pipeline stages ---
const STAGES = ['gate1', 'tester', 'gate2', 'worker', 'gate3', 'pr'] as const

function stageLabel(s: string): string {
  return { gate1: 'G1', tester: 'Test', gate2: 'G2', worker: 'Worker', gate3: 'G3', pr: 'PR' }[s] ?? s
}

function isActiveStage(s: string): boolean {
  return scheduler.value?.worker.stage === s
}

function isPastStage(s: string): boolean {
  const current = scheduler.value?.worker.stage
  if (!current) return false
  const ci = STAGES.indexOf(current as typeof STAGES[number])
  const si = STAGES.indexOf(s as typeof STAGES[number])
  return si < ci
}

// --- Elapsed time ---
function elapsed(iso: string | null): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m${sec % 60 ? ` ${sec % 60}s` : ''}`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

// --- Task list ---
type ViewTab = 'recent' | 'running' | 'failed'
const tab = ref<ViewTab>('recent')

const recentTasks = computed(() =>
  [...tasks.value]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20)
)
const runningTasks = computed(() => tasks.value.filter(t => t.status === 'running'))
const failedTasks = computed(() =>
  tasks.value.filter(t => t.status === 'failed')
    .sort((a, b) => new Date(b.finished_at ?? 0).getTime() - new Date(a.finished_at ?? 0).getTime())
    .slice(0, 20)
)

const visibleTasks = computed(() => {
  if (tab.value === 'running') return runningTasks.value
  if (tab.value === 'failed') return failedTasks.value
  return recentTasks.value
})

const counts = computed(() => {
  const c = { pending: 0, running: 0, done: 0, failed: 0 }
  for (const t of tasks.value) c[t.status]++
  return c
})

function statusIcon(s: Task['status']) {
  return { pending: '⏳', running: '⚡', done: '✅', failed: '❌' }[s]
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

// --- Chat ---
const chatInput = ref('')
const sending = ref(false)
const chatCategory = ref<'none' | 'decision' | 'lesson'>('none')
const chatLog = ref<{ from: string; text: string; time: string }[]>([])
const chatEl = ref<HTMLElement | null>(null)

onWsEvent('chat', (payload) => {
  const p = payload as { message: string; created_at: string; category: string | null }
  const label = p.category ? `you:${p.category}` : 'you'
  chatLog.value.push({ from: label, text: p.message, time: p.created_at })
  nextTick(() => chatEl.value?.scrollTo(0, chatEl.value.scrollHeight))
})

async function send() {
  const msg = chatInput.value.trim()
  if (!msg || sending.value) return
  sending.value = true
  chatInput.value = ''
  try {
    const cat = chatCategory.value !== 'none' ? chatCategory.value : undefined
    await sendChat(msg, cat)
  } finally {
    sending.value = false
  }
}

// --- New Task Modal ---
const showModal = ref(false)
const taskForm = ref({ title: '', description: '', priority: 50 })
const submitting = ref(false)

async function submitTask() {
  if (submitting.value) return
  submitting.value = true
  try {
    await createTask(taskForm.value)
    showModal.value = false
    refresh()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="office">
    <header>
      <div class="header-row">
        <div class="header-brand">
          <h1>DevPane</h1>
          <span class="subtitle">the office window</span>
        </div>
        <nav class="nav-links">
          <router-link to="/" class="active">Office</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/memories">Memories</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics">Metrics</router-link>
          <router-link to="/improvements">Kaizen</router-link>
        </nav>
        <div class="conn-status" :class="connected ? 'on' : 'off'">
          <span class="dot" />{{ connected ? 'live' : 'disconnected' }}
        </div>
      </div>
    </header>

    <!-- Agent Panel -->
    <section class="agents">
      <div class="agent-card" :class="{ active: scheduler?.pm.status === 'running' }">
        <div class="agent-icon">🤖</div>
        <div class="agent-name">PM</div>
        <div class="agent-status">{{ scheduler?.pm.status ?? 'idle' }}</div>
      </div>
      <div class="agent-card" :class="{ active: scheduler?.worker.status === 'running' }">
        <div class="agent-icon">🔧</div>
        <div class="agent-name">Worker</div>
        <div class="agent-status">
          {{ scheduler?.worker.status ?? 'idle' }}
          <template v-if="scheduler?.worker.startedAt && scheduler?.worker.status === 'running'">
            · {{ elapsed(scheduler.worker.startedAt) }}
          </template>
        </div>
      </div>
      <div class="agent-card scheduler-card">
        <div class="agent-icon">⏱</div>
        <div class="agent-name">Scheduler</div>
        <div class="agent-status">
          <template v-if="scheduler?.paused">paused</template>
          <template v-else-if="!scheduler?.withinActiveHours">sleeping</template>
          <template v-else-if="scheduler?.alive">active</template>
          <template v-else>stopped</template>
        </div>
      </div>
    </section>

    <!-- Pipeline Stage Visualization -->
    <section v-if="scheduler?.worker.status === 'running'" class="pipeline-live">
      <div class="pipeline-task-title">{{ scheduler.worker.taskTitle }}</div>
      <div class="pipeline-stages">
        <div
          v-for="s in STAGES"
          :key="s"
          class="stage"
          :class="{ active: isActiveStage(s), past: isPastStage(s) }"
        >
          {{ stageLabel(s) }}
        </div>
      </div>
    </section>

    <!-- Stats Row -->
    <section class="stats-row" v-if="pipelineStats">
      <div class="stat-pill" :class="pipelineStats.gate3_pass_rate >= 0.7 ? 'good' : pipelineStats.gate3_pass_rate >= 0.4 ? 'warn' : 'bad'">
        Gate {{ Math.round(pipelineStats.gate3_pass_rate * 100) }}%
      </div>
      <div class="stat-pill">{{ counts.done }} done</div>
      <div class="stat-pill">{{ counts.pending }} pending</div>
      <div class="stat-pill" :class="pipelineStats.consecutive_failures >= 3 ? 'bad' : ''">
        {{ pipelineStats.consecutive_failures }} streak fail
      </div>
    </section>

    <!-- Task List -->
    <section class="task-section">
      <div class="tab-bar">
        <button :class="{ active: tab === 'recent' }" @click="tab = 'recent'">Recent</button>
        <button :class="{ active: tab === 'running' }" @click="tab = 'running'">Running ({{ counts.running }})</button>
        <button :class="{ active: tab === 'failed' }" @click="tab = 'failed'">Failed ({{ counts.failed }})</button>
        <button class="new-task-btn" @click="showModal = true; taskForm = { title: '', description: '', priority: 50 }">+ Task</button>
      </div>

      <div v-if="loading && tasks.length === 0" class="empty">loading...</div>

      <ul class="task-list">
        <li v-for="task in visibleTasks" :key="task.id" :class="['task-item', `s-${task.status}`]">
          <router-link :to="`/tasks/${task.id}`">
            <span class="task-icon">{{ statusIcon(task.status) }}</span>
            <div class="task-info">
              <span class="task-title">{{ task.title }}</span>
              <span class="task-meta">
                {{ task.created_by }}
                <template v-if="task.started_at"> · {{ timeAgo(task.started_at) }}</template>
              </span>
            </div>
          </router-link>
        </li>
      </ul>

      <div v-if="!loading && visibleTasks.length === 0" class="empty">
        {{ tab === 'recent' ? 'no tasks yet' : `no ${tab} tasks` }}
      </div>
    </section>

    <!-- Chat -->
    <section class="chat-section">
      <h2>Chat <span class="ws-dot" :class="{ on: connected }"></span></h2>
      <div ref="chatEl" class="chat-log">
        <div v-for="(msg, i) in chatLog" :key="i" class="chat-msg">
          <span class="chat-from">[{{ msg.from }}]</span>{{ msg.text }}
        </div>
        <div v-if="chatLog.length === 0" class="chat-empty">send a message to create a task</div>
      </div>
      <form class="chat-form" @submit.prevent="send">
        <select v-model="chatCategory" class="chat-cat">
          <option value="none">task</option>
          <option value="decision">decision</option>
          <option value="lesson">lesson</option>
        </select>
        <input v-model="chatInput" class="chat-input" placeholder="tell the team..." :disabled="sending" />
        <button class="chat-btn" type="submit" :disabled="sending || !chatInput.trim()">send</button>
      </form>
    </section>

    <!-- New Task Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal">
          <h3>New Task</h3>
          <form @submit.prevent="submitTask">
            <label>Title<input v-model="taskForm.title" class="modal-input" required /></label>
            <label>Description<textarea v-model="taskForm.description" class="modal-input" required rows="4" /></label>
            <label>Priority<input v-model.number="taskForm.priority" class="modal-input" type="number" min="0" max="100" /></label>
            <div class="modal-actions">
              <button type="button" @click="showModal = false">Cancel</button>
              <button type="submit" class="primary" :disabled="submitting || !taskForm.title.trim()">Create</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.office {
  max-width: 860px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: #c9d1d9;
}

/* Header */
header { margin-bottom: 1.5rem; }
.header-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.header-brand { display: flex; align-items: baseline; gap: 0.5rem; }
h1 { font-size: 1.4rem; margin: 0; color: #f0f6fc; }
.subtitle { color: #484f58; font-size: 0.8rem; }
.nav-links { display: flex; gap: 0.5rem; }
.nav-links a { color: #8b949e; text-decoration: none; font-size: 0.8rem; padding: 0.2rem 0.4rem; border-radius: 4px; }
.nav-links a:hover { color: #c9d1d9; }
.nav-links a.active, .nav-links a.router-link-exact-active { color: #58a6ff; }
.conn-status { display: flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; }
.dot { width: 7px; height: 7px; border-radius: 50%; }
.conn-status.on .dot { background: #3fb950; box-shadow: 0 0 6px #3fb95080; }
.conn-status.on { color: #3fb950; }
.conn-status.off .dot { background: #f85149; }
.conn-status.off { color: #f85149; }

/* Agent Panel */
.agents { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
.agent-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
  transition: border-color 0.3s;
}
.agent-card.active { border-color: #d29922; background: #d2992210; }
.agent-icon { font-size: 1.5rem; }
.agent-name { font-size: 0.75rem; color: #f0f6fc; font-weight: 600; }
.agent-status { font-size: 0.7rem; color: #8b949e; }
.agent-card.active .agent-status { color: #d29922; }

/* Pipeline Stages */
.pipeline-live {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 0.75rem; margin-bottom: 1rem; text-align: center;
}
.pipeline-task-title { font-size: 0.85rem; color: #f0f6fc; margin-bottom: 0.5rem; }
.pipeline-stages { display: flex; justify-content: center; gap: 0.25rem; align-items: center; }
.stage {
  padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600;
  background: #21262d; color: #484f58; position: relative;
}
.stage.past { background: #238636; color: #f0f6fc; }
.stage.active { background: #d29922; color: #0d1117; animation: pulse 1.5s infinite; }
.stage + .stage::before { content: '→'; position: absolute; left: -0.7rem; color: #484f58; font-size: 0.6rem; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

/* Stats */
.stats-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
.stat-pill {
  padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.7rem;
  background: #21262d; color: #8b949e;
}
.stat-pill.good { background: #23863620; color: #3fb950; border: 1px solid #3fb95040; }
.stat-pill.warn { background: #d2992220; color: #d29922; border: 1px solid #d2992240; }
.stat-pill.bad { background: #f8514920; color: #f85149; border: 1px solid #f8514940; }

/* Task List */
.task-section { margin-bottom: 1rem; }
.tab-bar { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; align-items: center; }
.tab-bar button {
  background: #161b22; color: #8b949e; border: 1px solid #30363d;
  padding: 0.3rem 0.6rem; font-family: inherit; font-size: 0.75rem;
  border-radius: 4px; cursor: pointer;
}
.tab-bar button.active { color: #58a6ff; border-color: #58a6ff; }
.tab-bar button:hover { color: #c9d1d9; }
.new-task-btn { margin-left: auto !important; }

.task-list { list-style: none; padding: 0; margin: 0; }
.task-item {
  border: 1px solid #21262d; border-radius: 6px; margin-bottom: 0.4rem;
  transition: border-color 0.15s;
}
.task-item:hover { border-color: #58a6ff; }
.task-item a { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; color: inherit; text-decoration: none; }
.task-icon { font-size: 1rem; flex-shrink: 0; }
.task-info { display: flex; flex-direction: column; min-width: 0; }
.task-title { font-size: 0.85rem; color: #f0f6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-meta { font-size: 0.7rem; color: #8b949e; }
.s-running { border-color: #d29922; }
.s-failed { border-color: #f8514940; }

/* Chat */
.chat-section { border-top: 1px solid #21262d; padding-top: 1rem; }
.chat-section h2 { font-size: 0.85rem; color: #f0f6fc; margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.4rem; }
.ws-dot { width: 7px; height: 7px; border-radius: 50%; background: #f85149; display: inline-block; }
.ws-dot.on { background: #3fb950; }
.chat-log {
  background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
  padding: 0.5rem; max-height: 150px; overflow-y: auto; font-size: 0.75rem; margin-bottom: 0.4rem;
}
.chat-msg { line-height: 1.5; }
.chat-from { color: #58a6ff; margin-right: 0.4rem; }
.chat-empty { color: #484f58; }
.chat-form { display: flex; gap: 0.4rem; }
.chat-cat {
  background: #161b22; color: #8b949e; border: 1px solid #21262d; border-radius: 4px;
  padding: 0.35rem; font-family: inherit; font-size: 0.7rem;
}
.chat-input {
  flex: 1; background: #161b22; border: 1px solid #21262d; border-radius: 4px;
  padding: 0.35rem 0.5rem; color: #c9d1d9; font-family: inherit; font-size: 0.8rem; outline: none;
}
.chat-input:focus { border-color: #58a6ff; }
.chat-btn {
  background: #238636; color: #f0f6fc; border: none; border-radius: 4px;
  padding: 0.35rem 0.75rem; font-family: inherit; font-size: 0.8rem; cursor: pointer;
}
.chat-btn:disabled { opacity: 0.5; }

/* Empty */
.empty { text-align: center; color: #484f58; padding: 2rem 0; font-size: 0.85rem; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 1.5rem; width: 400px; max-width: 90vw; color: #c9d1d9; font-family: inherit;
}
.modal h3 { margin: 0 0 1rem; color: #f0f6fc; }
.modal label { display: block; margin-bottom: 0.5rem; font-size: 0.8rem; color: #8b949e; }
.modal-input {
  display: block; width: 100%; margin-top: 0.2rem; background: #0d1117; border: 1px solid #21262d;
  border-radius: 4px; padding: 0.4rem 0.6rem; color: #c9d1d9; font-family: inherit; font-size: 0.85rem;
  outline: none; box-sizing: border-box;
}
.modal-input:focus { border-color: #58a6ff; }
textarea.modal-input { resize: vertical; min-height: 60px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.modal-actions button {
  background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 4px;
  padding: 0.4rem 0.75rem; font-family: inherit; font-size: 0.85rem; cursor: pointer;
}
.modal-actions button.primary { background: #238636; color: #f0f6fc; border: none; }
.modal-actions button.primary:disabled { opacity: 0.5; }
</style>
