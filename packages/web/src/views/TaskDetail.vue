<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useTaskDetail, fetchEvents, fetchTaskTrace, retryTask, patchTask, type PipelineTrace } from '../composables/useApi'
import { ref } from 'vue'

const props = defineProps<{ id: string }>()
const { task, logs, refresh } = useTaskDetail(props.id)

const trace = ref<PipelineTrace | null>(null)

async function loadTrace() {
  try { trace.value = await fetchTaskTrace(props.id) } catch {}
}

let timer: ReturnType<typeof setInterval>

onMounted(() => {
  refresh()
  loadPrUrl()
  loadTrace()
  timer = setInterval(() => { refresh(); loadTrace() }, 3000)
})

onUnmounted(() => clearInterval(timer))

const prUrl = ref<string | null>(null)

async function loadPrUrl() {
  try {
    const events = await fetchEvents(10, 'pr.created', props.id)
    const match = events[0]
    if (match && typeof match.url === 'string') prUrl.value = match.url
  } catch {}
}

const retrying = ref(false)
async function doRetry() {
  if (!task.value || retrying.value) return
  retrying.value = true
  try { await retryTask(props.id); await refresh() } finally { retrying.value = false }
}

const cancelling = ref(false)
async function doCancel() {
  if (!task.value || cancelling.value) return
  cancelling.value = true
  try { await patchTask(props.id, { status: 'cancelled' }); await refresh() } finally { cancelling.value = false }
}

const editingPriority = ref(false)
const newPriority = ref(0)
function startEditPriority() {
  if (!task.value) return
  newPriority.value = task.value.priority
  editingPriority.value = true
}
async function savePriority() {
  if (!task.value) return
  await patchTask(props.id, { priority: newPriority.value })
  editingPriority.value = false
  await refresh()
}

const facts = computed(() => {
  if (!task.value?.result) return null
  try {
    return JSON.parse(task.value.result)
  } catch {
    return null
  }
})

const diffAddPct = computed(() => {
  if (!facts.value?.diff_stats) return 0
  const { additions, deletions } = facts.value.diff_stats
  const total = additions + deletions
  return total === 0 ? 0 : Math.round((additions / total) * 100)
})

const diffDelPct = computed(() => {
  if (!facts.value?.diff_stats) return 0
  const { additions, deletions } = facts.value.diff_stats
  const total = additions + deletions
  return total === 0 ? 0 : Math.round((deletions / total) * 100)
})
</script>

<template>
  <div class="detail">
    <router-link to="/tasks" class="back">← タスク一覧に戻る</router-link>

    <template v-if="task">
      <h1>{{ task.title }}</h1>
      <div class="meta">
        <span :class="['badge', `badge-${task.status}`]">{{ task.status }}</span>
        <span>作成: {{ task.created_by }}</span>
        <span v-if="task.assigned_to">担当: {{ task.assigned_to }}</span>
        <span class="priority-display" @click="startEditPriority" title="クリックで変更">P:{{ task.priority }}</span>
        <a v-if="prUrl" :href="prUrl" target="_blank" class="pr-link">PR →</a>
        <button v-if="task.status === 'failed' || task.status === 'suppressed'" class="retry-btn" @click="doRetry" :disabled="retrying">{{ retrying ? '再キュー中...' : '🔄 リトライ' }}</button>
        <button v-if="task.status === 'pending'" class="cancel-btn" @click="doCancel" :disabled="cancelling">{{ cancelling ? 'キャンセル中...' : '✕ キャンセル' }}</button>
      </div>

      <div v-if="editingPriority" class="priority-edit">
        <label>優先度:</label>
        <input type="number" v-model.number="newPriority" min="0" max="100" class="priority-input" />
        <button class="save-btn" @click="savePriority">保存</button>
        <button class="cancel-edit-btn" @click="editingPriority = false">取消</button>
      </div>

      <section class="description">
        <h2>説明</h2>
        <pre>{{ task.description }}</pre>
      </section>

      <section v-if="trace" class="pipeline-trace">
        <h2>パイプライン</h2>
        <div class="stages">
          <span class="stg" :class="trace.gate1">G1</span>
          <span class="stg" :class="trace.tester">T</span>
          <span class="stg" :class="trace.gate2">G2</span>
          <span class="stg" :class="trace.worker">W</span>
          <span class="stg" :class="trace.gate3">G3</span>
          <span class="stg-outcome">{{ trace.outcome }}</span>
        </div>
      </section>

      <section v-if="facts" class="facts">
        <h2>実行結果</h2>
        <div class="facts-grid">
          <div>exit: <strong>{{ facts.exit_code }}</strong></div>
          <div>files: <strong>{{ facts.files_changed?.length ?? 0 }}</strong></div>
          <div v-if="facts.test_result">
            tests: {{ facts.test_result.passed }} pass / {{ facts.test_result.failed }} fail
          </div>
          <div v-if="facts.branch">branch: {{ facts.branch }}</div>
          <div v-if="facts.commit_hash">commit: {{ facts.commit_hash?.slice(0, 8) }}</div>
        </div>
        <div v-if="facts.diff_stats" class="diff-bar-container">
          <div class="diff-bar">
            <span class="additions" :style="{ width: diffAddPct + '%' }">+{{ facts.diff_stats.additions }}</span>
            <span class="deletions" :style="{ width: diffDelPct + '%' }">-{{ facts.diff_stats.deletions }}</span>
          </div>
          <span class="diff-total">{{ facts.diff_stats.additions + facts.diff_stats.deletions }} 行</span>
        </div>
        <details v-if="facts.files_changed?.length">
          <summary>変更ファイル ({{ facts.files_changed.length }})</summary>
          <ul>
            <li v-for="f in facts.files_changed" :key="f">{{ f }}</li>
          </ul>
        </details>
      </section>

      <section v-if="facts?.gate3" class="gate3">
        <h2>Gate 3 判定</h2>
        <div class="gate3-verdict" :class="`verdict-${facts.gate3.verdict}`">
          {{ facts.gate3.verdict.toUpperCase() }}
        </div>
        <ul class="gate3-reasons">
          <li v-for="(r, i) in facts.gate3.reasons" :key="i">{{ r }}</li>
        </ul>
        <div v-if="facts.gate3.failure" class="gate3-failure">
          <span class="failure-label">root cause:</span> {{ facts.gate3.failure.root_cause }}
          <span class="failure-label">stage:</span> {{ facts.gate3.failure.stage }}
          <span class="failure-label">severity:</span> {{ facts.gate3.failure.severity }}
        </div>
      </section>

      <section class="logs">
        <h2>ログ ({{ logs.length }})</h2>
        <div class="log-stream">
          <div v-for="log in logs" :key="log.id" class="log-entry">
            <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            <span class="log-agent">[{{ log.agent }}]</span>
            <span class="log-msg">{{ log.message }}</span>
          </div>
          <div v-if="logs.length === 0" class="empty">ログなし</div>
        </div>
      </section>
    </template>

    <div v-else class="loading">読み込み中...</div>
  </div>
</template>

<style scoped>
.detail {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

.back {
  color: #58a6ff;
  text-decoration: none;
  font-size: 0.85rem;
}

h1 {
  font-size: 1.3rem;
  color: #f0f6fc;
  margin: 1rem 0 0.5rem;
}

h2 {
  font-size: 0.95rem;
  color: #f0f6fc;
  margin: 1.5rem 0 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: #8b949e;
  align-items: center;
}

.badge {
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge-pending { background: #30363d; color: #8b949e; }
.badge-running { background: #d29922; color: #0d1117; }
.badge-done { background: #238636; color: #f0f6fc; }
.badge-failed { background: #f85149; color: #f0f6fc; }
.badge-suppressed { background: #6e7681; color: #f0f6fc; }

.pr-link {
  color: #58a6ff; text-decoration: none; font-size: 0.75rem;
  padding: 0.1rem 0.4rem; border: 1px solid #58a6ff40; border-radius: 3px;
}
.pr-link:hover { background: #58a6ff15; }

.retry-btn {
  font-family: inherit; font-size: 0.7rem; padding: 0.15rem 0.5rem;
  background: #21262d; color: #d29922; border: 1px solid #d2992240; border-radius: 3px;
  cursor: pointer;
}
.retry-btn:hover { background: #d2992220; }
.retry-btn:disabled { opacity: 0.4; cursor: default; }

.cancel-btn {
  font-family: inherit; font-size: 0.7rem; padding: 0.15rem 0.5rem;
  background: #21262d; color: #f85149; border: 1px solid #f8514940; border-radius: 3px;
  cursor: pointer;
}
.cancel-btn:hover { background: #f8514920; }
.cancel-btn:disabled { opacity: 0.4; cursor: default; }

.priority-display {
  padding: 0.1rem 0.4rem; border: 1px solid #30363d; border-radius: 3px;
  cursor: pointer; font-size: 0.7rem;
}
.priority-display:hover { background: #21262d; }

.priority-edit {
  display: flex; gap: 0.5rem; align-items: center;
  margin-top: 0.5rem; font-size: 0.8rem;
}
.priority-input {
  width: 60px; padding: 0.15rem 0.3rem; font-family: inherit; font-size: 0.8rem;
  background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 3px;
}
.save-btn {
  font-family: inherit; font-size: 0.7rem; padding: 0.15rem 0.5rem;
  background: #238636; color: #f0f6fc; border: 1px solid #23863640; border-radius: 3px;
  cursor: pointer;
}
.cancel-edit-btn {
  font-family: inherit; font-size: 0.7rem; padding: 0.15rem 0.5rem;
  background: #21262d; color: #8b949e; border: 1px solid #30363d; border-radius: 3px;
  cursor: pointer;
}

.description pre {
  background: #161b22;
  padding: 1rem;
  border-radius: 6px;
  white-space: pre-wrap;
  font-size: 0.85rem;
  overflow-x: auto;
}

.facts-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.85rem;
}

.facts-grid strong {
  color: #f0f6fc;
}

details {
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

details summary {
  cursor: pointer;
  color: #58a6ff;
}

details ul {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.log-stream {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem;
  max-height: 400px;
  overflow-y: auto;
  font-size: 0.75rem;
  line-height: 1.6;
}

.log-entry {
  display: flex;
  gap: 0.5rem;
}

.log-time {
  color: #484f58;
  flex-shrink: 0;
}

.log-agent {
  color: #d29922;
  flex-shrink: 0;
}

.log-msg {
  color: #c9d1d9;
  word-break: break-all;
}

.loading, .empty {
  color: #8b949e;
  text-align: center;
  padding: 2rem 0;
}

.gate3 { margin-top: 1rem; }

.gate3-verdict {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.verdict-go { background: #238636; color: #f0f6fc; }
.verdict-recycle { background: #d29922; color: #0d1117; }
.verdict-kill { background: #f85149; color: #f0f6fc; }

.gate3-reasons {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
  font-size: 0.8rem;
}

.gate3-failure {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  padding: 0.5rem;
  background: #161b22;
  border-radius: 4px;
  border-left: 3px solid #f85149;
}

.failure-label {
  color: #8b949e;
  margin-right: 0.25rem;
}

.pipeline-trace { margin-top: 1rem; }

.stages {
  display: flex;
  gap: 4px;
  align-items: center;
}

.stg {
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 700;
  background: #21262d;
  color: #30363d;
}

.stg.pass { background: #238636; color: #f0f6fc; }
.stg.kill { background: #f85149; color: #f0f6fc; }
.stg.recycle { background: #d29922; color: #0d1117; }
.stg.pending { background: #21262d; color: #484f58; }

.stg-outcome {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  color: #8b949e;
}

.diff-bar-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.diff-bar {
  display: flex;
  flex: 1;
  height: 20px;
  border-radius: 3px;
  overflow: hidden;
  font-size: 0.7rem;
  font-weight: 600;
}

.diff-bar .additions {
  background: #3fb950;
  color: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.diff-bar .deletions {
  background: #f85149;
  color: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.diff-total {
  color: #484f58;
  font-size: 0.7rem;
  flex-shrink: 0;
}
</style>
