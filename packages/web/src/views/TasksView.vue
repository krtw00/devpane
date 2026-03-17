<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useTasks, createTask, fetchMemories, deleteMemory, updateMemory, type Task, type Memory } from '../composables/useApi'
import { onWsEvent } from '../composables/useSocket'

const { tasks, loading, error, refresh } = useTasks()

// --- Page tabs ---
const activeTab = ref<'tasks' | 'memory'>('tasks')

// --- Memory ---
const memories = ref<Memory[]>([])
const memoryFilter = ref<'all' | 'feature' | 'decision' | 'lesson'>('all')

async function refreshMemories() {
  try {
    memories.value = await fetchMemories(memoryFilter.value === 'all' ? undefined : memoryFilter.value)
  } catch {}
}

async function removeMemory(id: string) {
  try { await deleteMemory(id); await refreshMemories() } catch {}
}

const CATEGORY_LABELS: Record<string, string> = { feature: '実装済み機能', decision: '判断', lesson: '教訓' }

const editingMemory = ref<string | null>(null)
const editContent = ref('')
function startEditMemory(m: Memory) {
  editingMemory.value = m.id
  editContent.value = m.content
}
async function saveMemory(id: string) {
  try { await updateMemory(id, editContent.value); editingMemory.value = null; await refreshMemories() } catch {}
}

let timer: ReturnType<typeof setInterval>
onMounted(() => { refresh(); refreshMemories(); timer = setInterval(refresh, 5000) })
onUnmounted(() => clearInterval(timer))

onWsEvent('task:created', () => refresh())
onWsEvent('task:updated', () => refresh())

// --- Filter ---
const taskFilter = ref<'all' | 'pending' | 'running' | 'done' | 'failed' | 'suppressed'>('all')

const counts = computed(() => {
  const c = { pending: 0, running: 0, done: 0, failed: 0, suppressed: 0 }
  for (const t of tasks.value) c[t.status]++
  return c
})

const filteredTasks = computed(() => {
  let list = [...tasks.value].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  if (taskFilter.value !== 'all') list = list.filter(t => t.status === taskFilter.value)
  return list
})

function statusIcon(s: Task['status']) { return { pending: '⏳', running: '⚡', done: '✅', failed: '❌', suppressed: '🧊' }[s] }
function statusLabel(s: Task['status']) { return { pending: '待機', running: '実行中', done: '完了', failed: '失敗', suppressed: '抑止' }[s] }

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間前`
  return `${Math.floor(hr / 24)}日前`
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
  <div class="page">
    <header>
      <div class="hdr">
        <div class="page-tabs">
          <button :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">タスク</button>
          <button :class="{ active: activeTab === 'memory' }" @click="activeTab = 'memory'; refreshMemories()">メモリ</button>
        </div>
        <router-link to="/" class="nav-link">← オフィスに戻る</router-link>
      </div>
    </header>

    <div v-if="error" class="error-banner">API接続エラー: {{ error }}</div>

    <template v-if="activeTab === 'tasks'">
    <div class="toolbar">
      <div class="filter-tabs">
        <button :class="{ active: taskFilter === 'all' }" @click="taskFilter = 'all'">全て {{ tasks.length }}</button>
        <button :class="{ active: taskFilter === 'pending' }" @click="taskFilter = 'pending'">待機 {{ counts.pending }}</button>
        <button :class="{ active: taskFilter === 'running' }" @click="taskFilter = 'running'">実行中 {{ counts.running }}</button>
        <button :class="{ active: taskFilter === 'done' }" @click="taskFilter = 'done'">完了 {{ counts.done }}</button>
        <button :class="{ active: taskFilter === 'failed', bad: counts.failed > 0 }" @click="taskFilter = 'failed'">失敗 {{ counts.failed }}</button>
        <button :class="{ active: taskFilter === 'suppressed' }" @click="taskFilter = 'suppressed'">抑止 {{ counts.suppressed }}</button>
      </div>
      <button class="add-btn" @click="showModal = true; taskForm = { title: '', description: '', priority: 50 }">+ タスク追加</button>
    </div>

    <div class="task-list" v-if="filteredTasks.length > 0">
      <div v-for="task in filteredTasks" :key="task.id" class="task-row" :class="`s-${task.status}`">
        <router-link :to="`/tasks/${task.id}`" class="task-link">
          <span class="ti">{{ statusIcon(task.status) }}</span>
          <div class="task-main">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              {{ statusLabel(task.status) }}
              <template v-if="task.assigned_to"> · {{ task.assigned_to }}</template>
              · p={{ task.priority }}
            </span>
          </div>
          <span class="task-time">{{ timeAgo(task.finished_at || task.started_at || task.created_at) }}</span>
        </router-link>
      </div>
    </div>
    <div v-else-if="!loading" class="empty">
      {{ taskFilter === 'all' ? 'タスクがありません' : `${taskFilter} のタスクはありません` }}
    </div>
    <div v-else class="empty">読み込み中...</div>
    </template>

    <!-- Memory Tab -->
    <template v-if="activeTab === 'memory'">
      <div class="toolbar">
        <div class="filter-tabs">
          <button :class="{ active: memoryFilter === 'all' }" @click="memoryFilter = 'all'; refreshMemories()">全て</button>
          <button :class="{ active: memoryFilter === 'feature' }" @click="memoryFilter = 'feature'; refreshMemories()">機能</button>
          <button :class="{ active: memoryFilter === 'decision' }" @click="memoryFilter = 'decision'; refreshMemories()">判断</button>
          <button :class="{ active: memoryFilter === 'lesson' }" @click="memoryFilter = 'lesson'; refreshMemories()">教訓</button>
        </div>
        <span class="mem-count">{{ memories.length }}件</span>
      </div>
      <div class="mem-list" v-if="memories.length > 0">
        <div v-for="m in memories" :key="m.id" class="mem-row">
          <span class="mem-cat" :class="`cat-${m.category}`">{{ CATEGORY_LABELS[m.category] ?? m.category }}</span>
          <template v-if="editingMemory === m.id">
            <textarea class="mem-edit-input" v-model="editContent" rows="3" />
            <button class="mem-save" @click="saveMemory(m.id)">保存</button>
            <button class="mem-cancel-edit" @click="editingMemory = null">取消</button>
          </template>
          <template v-else>
            <span class="mem-content">{{ m.content }}</span>
            <button class="mem-edit" @click="startEditMemory(m)" title="編集">✎</button>
          </template>
          <button class="mem-del" @click="removeMemory(m.id)" title="削除">×</button>
        </div>
      </div>
      <div v-else class="empty">メモリなし</div>
    </template>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
        <div class="modal">
          <h3>タスク追加</h3>
          <form @submit.prevent="submitTask">
            <label>タイトル<input v-model="taskForm.title" required /></label>
            <label>説明<textarea v-model="taskForm.description" required rows="4" /></label>
            <label>優先度<input v-model.number="taskForm.priority" type="number" min="0" max="100" /></label>
            <div class="mact">
              <button type="button" @click="showModal = false">キャンセル</button>
              <button type="submit" class="pri" :disabled="submitting">作成</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.page {
  max-width: 900px; margin: 0 auto; padding: 1rem;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  color: #c9d1d9; font-size: 13px;
}

header { margin-bottom: 1rem; }
.hdr { display: flex; align-items: center; justify-content: space-between; }

.page-tabs { display: flex; gap: 1px; }
.page-tabs button {
  font-family: inherit; font-size: 0.85rem; font-weight: 700; padding: 0.3rem 0.75rem;
  background: #21262d; color: #8b949e; border: none; cursor: pointer;
}
.page-tabs button:first-child { border-radius: 4px 0 0 4px; }
.page-tabs button:last-child { border-radius: 0 4px 4px 0; }
.page-tabs button.active { background: #30363d; color: #f0f6fc; }
.nav-link { color: #58a6ff; text-decoration: none; font-size: 0.75rem; }
.nav-link:hover { text-decoration: underline; }

.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 0.5rem; }

.filter-tabs { display: flex; gap: 1px; }
.filter-tabs button {
  font-family: inherit; font-size: 0.7rem; padding: 0.25rem 0.5rem;
  background: #21262d; color: #8b949e; border: none; cursor: pointer;
}
.filter-tabs button:first-child { border-radius: 4px 0 0 4px; }
.filter-tabs button:last-child { border-radius: 0 4px 4px 0; }
.filter-tabs button.active { background: #30363d; color: #f0f6fc; }
.filter-tabs button.bad { color: #f85149; }

.add-btn {
  background: #238636; color: #f0f6fc; border: none; border-radius: 4px;
  padding: 0.3rem 0.6rem; font-family: inherit; font-size: 0.7rem; cursor: pointer;
}
.add-btn:hover { background: #2ea043; }

.task-list { border: 1px solid #21262d; border-radius: 6px; overflow: hidden; }

.task-row { border-bottom: 1px solid #161b22; }
.task-row:last-child { border-bottom: none; }
.task-link {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem;
  color: inherit; text-decoration: none;
}
.task-link:hover { background: #161b22; }

.ti { font-size: 0.8rem; flex-shrink: 0; }
.task-main { flex: 1; min-width: 0; }
.task-title { display: block; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-meta { display: block; font-size: 0.65rem; color: #484f58; margin-top: 0.1rem; }
.task-time { color: #484f58; font-size: 0.65rem; flex-shrink: 0; }

.s-running { border-left: 3px solid #d29922; }
.s-failed { border-left: 3px solid #f85149; }
.s-done { border-left: 3px solid #238636; }
.s-suppressed { border-left: 3px solid #6e7681; opacity: 0.75; }

.error-banner {
  background: #3d1214; color: #f85149; border: 1px solid #f8514930;
  border-radius: 6px; padding: 0.4rem 0.75rem; margin-bottom: 0.75rem;
  font-size: 0.75rem;
}

.empty { text-align: center; color: #484f58; padding: 3rem 0; }

/* Memory */
.mem-count { font-size: 0.7rem; color: #8b949e; }
.mem-list { border: 1px solid #21262d; border-radius: 6px; overflow: hidden; }
.mem-row {
  display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #161b22; font-size: 0.75rem;
}
.mem-row:last-child { border-bottom: none; }
.mem-cat {
  flex-shrink: 0; font-size: 0.6rem; font-weight: 700; padding: 0.1rem 0.35rem;
  border-radius: 3px; background: #21262d; color: #8b949e;
}
.cat-feature { color: #58a6ff; }
.cat-decision { color: #d29922; }
.cat-lesson { color: #3fb950; }
.mem-content { flex: 1; color: #c9d1d9; word-break: break-word; }
.mem-del {
  flex-shrink: 0; background: none; border: none; color: #484f58; cursor: pointer;
  font-size: 0.8rem; padding: 0 0.2rem; line-height: 1;
}
.mem-del:hover { color: #f85149; }
.mem-edit {
  flex-shrink: 0; background: none; border: none; color: #484f58; cursor: pointer;
  font-size: 0.8rem; padding: 0 0.2rem; line-height: 1;
}
.mem-edit:hover { color: #58a6ff; }
.mem-edit-input {
  flex: 1; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d;
  border-radius: 4px; padding: 0.3rem 0.5rem; font-family: inherit; font-size: 0.75rem;
  resize: vertical; min-height: 40px;
}
.mem-save {
  flex-shrink: 0; font-family: inherit; font-size: 0.6rem; padding: 0.15rem 0.4rem;
  background: #238636; color: #f0f6fc; border: none; border-radius: 3px; cursor: pointer;
}
.mem-cancel-edit {
  flex-shrink: 0; font-family: inherit; font-size: 0.6rem; padding: 0.15rem 0.4rem;
  background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 3px; cursor: pointer;
}

/* Modal */
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 1.25rem; width: 420px; max-width: 90vw; color: #c9d1d9; font-family: inherit;
}
.modal h3 { margin: 0 0 0.75rem; color: #f0f6fc; font-size: 1rem; }
.modal label { display: block; margin-bottom: 0.5rem; font-size: 0.75rem; color: #8b949e; }
.modal input, .modal textarea {
  display: block; width: 100%; margin-top: 0.15rem; background: #0d1117; border: 1px solid #21262d;
  border-radius: 4px; padding: 0.35rem 0.5rem; color: #c9d1d9; font-family: inherit; font-size: 0.8rem;
  outline: none; box-sizing: border-box;
}
.modal input:focus, .modal textarea:focus { border-color: #58a6ff; }
.modal textarea { resize: vertical; min-height: 60px; }
.mact { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.75rem; }
.mact button { background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 4px; padding: 0.3rem 0.6rem; font-family: inherit; font-size: 0.8rem; cursor: pointer; }
.mact button.pri { background: #238636; color: #f0f6fc; border: none; }
.mact button.pri:disabled { opacity: 0.4; }
</style>
