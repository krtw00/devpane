<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useTasks, createTask, type Task } from '../composables/useApi'
import { useSocket, onWsEvent, sendChat } from '../composables/useSocket'

const { tasks, loading, refresh } = useTasks()
const { connected } = useSocket()

const chatInput = ref('')
const sending = ref(false)
const chatLog = ref<{ from: string; text: string; time: string }[]>([])
const chatEl = ref<HTMLElement | null>(null)

let timer: ReturnType<typeof setInterval>

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 10000) // slower poll, WS handles live updates
})

onUnmounted(() => clearInterval(timer))

onWsEvent('task:created', () => refresh())
onWsEvent('task:updated', () => refresh())
onWsEvent('chat', (payload) => {
  const p = payload as { message: string; created_at: string }
  chatLog.value.push({ from: 'you', text: p.message, time: p.created_at })
  nextTick(() => chatEl.value?.scrollTo(0, chatEl.value.scrollHeight))
})

async function send() {
  const msg = chatInput.value.trim()
  if (!msg || sending.value) return
  sending.value = true
  chatInput.value = ''
  try {
    await sendChat(msg)
  } finally {
    sending.value = false
  }
}

const showModal = ref(false)
const taskForm = ref({ title: '', description: '', priority: 50 })
const submitting = ref(false)

function openModal() {
  taskForm.value = { title: '', description: '', priority: 50 }
  showModal.value = true
}

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

const statusOrder: Record<string, number> = { running: 0, pending: 1, failed: 2, done: 3 }

const sorted = computed(() =>
  [...tasks.value].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
)

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
</script>

<template>
  <div class="dashboard">
    <header>
      <div class="header-row">
        <div>
          <h1>DevPane</h1>
          <span class="subtitle">the office window</span>
        </div>
        <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
          <span class="conn-dot" />
          {{ connected ? 'connected' : 'disconnected' }}
        </div>
      </div>
      <div v-if="!connected" class="conn-banner">
        daemon connection lost — reconnecting...
      </div>
    </header>

    <div class="stats">
      <div class="stat">
        <span class="stat-num">{{ counts.running }}</span>
        <span class="stat-label">running</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.pending }}</span>
        <span class="stat-label">pending</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.done }}</span>
        <span class="stat-label">done</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.failed }}</span>
        <span class="stat-label">failed</span>
      </div>
    </div>

    <div v-if="loading && tasks.length === 0" class="loading">loading...</div>

    <ul class="task-list">
      <li v-for="task in sorted" :key="task.id" :class="['task-item', `status-${task.status}`]">
        <router-link :to="`/tasks/${task.id}`">
          <span class="task-icon">{{ statusIcon(task.status) }}</span>
          <div class="task-info">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              {{ task.status }} · {{ task.created_by }}
              <template v-if="task.started_at"> · started {{ timeAgo(task.started_at) }}</template>
              <template v-if="task.finished_at"> · finished {{ timeAgo(task.finished_at) }}</template>
            </span>
          </div>
        </router-link>
      </li>
    </ul>

    <div v-if="!loading && tasks.length === 0" class="empty">
      no tasks yet — waiting for PM to generate...
    </div>

    <section class="chat-section">
      <h2>Chat <span class="ws-dot" :class="{ on: connected }"></span></h2>
      <div ref="chatEl" class="chat-log">
        <div v-for="(msg, i) in chatLog" :key="i" class="chat-msg">
          <span class="chat-from">[{{ msg.from }}]</span>
          <span>{{ msg.text }}</span>
        </div>
        <div v-if="chatLog.length === 0" class="chat-empty">send a message to create a task</div>
      </div>
      <form class="chat-form" @submit.prevent="send">
        <input
          v-model="chatInput"
          class="chat-input"
          placeholder="tell the team what to do..."
          :disabled="sending"
        />
        <button class="chat-btn" type="submit" :disabled="sending || !chatInput.trim()">send</button>
        <button class="new-task-btn" type="button" @click="openModal">+ New Task</button>
      </form>
    </section>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal">
          <h3>New Task</h3>
          <form @submit.prevent="submitTask">
            <label>
              Title
              <input v-model="taskForm.title" class="modal-input" required />
            </label>
            <label>
              Description
              <textarea v-model="taskForm.description" class="modal-input modal-textarea" required rows="4" />
            </label>
            <label>
              Priority
              <input v-model.number="taskForm.priority" class="modal-input" type="number" min="0" max="100" />
            </label>
            <div class="modal-actions">
              <button type="button" class="modal-cancel" @click="showModal = false">Cancel</button>
              <button type="submit" class="modal-submit" :disabled="submitting || !taskForm.title.trim() || !taskForm.description.trim()">
                {{ submitting ? 'Creating...' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header {
  margin-bottom: 2rem;
}

h1 {
  font-size: 1.5rem;
  margin: 0;
  color: #f0f6fc;
}

.subtitle {
  color: #8b949e;
  font-size: 0.85rem;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conn-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.conn-ok .conn-dot {
  background: #3fb950;
  box-shadow: 0 0 6px #3fb95080;
}

.conn-ok {
  color: #3fb950;
}

.conn-err .conn-dot {
  background: #f85149;
  box-shadow: 0 0 6px #f8514980;
}

.conn-err {
  color: #f85149;
}

.conn-banner {
  margin-top: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #f8514920;
  border: 1px solid #f8514960;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #f85149;
}

.stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 1.8rem;
  font-weight: bold;
  color: #f0f6fc;
}

.stat-label {
  font-size: 0.75rem;
  color: #8b949e;
  text-transform: uppercase;
}

.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.task-item {
  border: 1px solid #30363d;
  border-radius: 6px;
  margin-bottom: 0.5rem;
  transition: border-color 0.15s;
}

.task-item:hover {
  border-color: #58a6ff;
}

.task-item a {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: inherit;
  text-decoration: none;
}

.task-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.task-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.task-title {
  font-weight: 500;
  color: #f0f6fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  font-size: 0.75rem;
  color: #8b949e;
}

.status-running {
  border-color: #d29922;
}

.status-failed {
  border-color: #f85149;
}

.loading, .empty {
  text-align: center;
  color: #8b949e;
  padding: 3rem 0;
}

.chat-section {
  margin-top: 2rem;
  border-top: 1px solid #30363d;
  padding-top: 1.5rem;
}

.chat-section h2 {
  font-size: 0.95rem;
  color: #f0f6fc;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f85149;
  display: inline-block;
}

.ws-dot.on {
  background: #3fb950;
}

.chat-log {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem;
  max-height: 200px;
  overflow-y: auto;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
}

.chat-msg {
  line-height: 1.6;
}

.chat-from {
  color: #58a6ff;
  margin-right: 0.5rem;
}

.chat-empty {
  color: #484f58;
}

.chat-form {
  display: flex;
  gap: 0.5rem;
}

.chat-input {
  flex: 1;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
}

.chat-input:focus {
  border-color: #58a6ff;
}

.chat-btn {
  background: #238636;
  color: #f0f6fc;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.chat-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.new-task-btn {
  background: #30363d;
  color: #c9d1d9;
  border: 1px solid #484f58;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}

.new-task-btn:hover {
  border-color: #58a6ff;
  color: #58a6ff;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.modal {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 1.5rem;
  width: 420px;
  max-width: 90vw;
  color: #c9d1d9;
}

.modal h3 {
  margin: 0 0 1rem;
  color: #f0f6fc;
  font-size: 1.1rem;
}

.modal label {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: #8b949e;
}

.modal-input {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
  box-sizing: border-box;
}

.modal-input:focus {
  border-color: #58a6ff;
}

.modal-textarea {
  resize: vertical;
  min-height: 80px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.modal-cancel {
  background: transparent;
  color: #8b949e;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.modal-cancel:hover {
  color: #c9d1d9;
  border-color: #484f58;
}

.modal-submit {
  background: #238636;
  color: #f0f6fc;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.modal-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
