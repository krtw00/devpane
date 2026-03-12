<script setup lang="ts">
import { onMounted, computed, nextTick, ref } from 'vue'
import { useTaskDetail } from '../composables/useApi'
import { useSocket, onTaskLog } from '../composables/useSocket'

const props = defineProps<{ id: string }>()
const { task, logs, refresh } = useTaskDetail(props.id)
const logStream = ref<HTMLElement | null>(null)

useSocket()

onMounted(() => {
  refresh()
})

let logIdCounter = 0

onTaskLog(props.id, (payload) => {
  logs.value.push({
    id: `ws-${++logIdCounter}`,
    task_id: props.id,
    agent: payload.agent,
    message: payload.message,
    timestamp: new Date().toISOString(),
  })
  nextTick(() => {
    if (logStream.value) {
      logStream.value.scrollTop = logStream.value.scrollHeight
    }
  })
})

const facts = computed(() => {
  if (!task.value?.result) return null
  try {
    return JSON.parse(task.value.result)
  } catch {
    return null
  }
})
</script>

<template>
  <div class="detail">
    <router-link to="/" class="back">&larr; back</router-link>

    <template v-if="task">
      <h1>{{ task.title }}</h1>
      <div class="meta">
        <span :class="['badge', `badge-${task.status}`]">{{ task.status }}</span>
        <span>by {{ task.created_by }}</span>
        <span v-if="task.assigned_to">on {{ task.assigned_to }}</span>
      </div>

      <section class="description">
        <h2>Description</h2>
        <pre>{{ task.description }}</pre>
      </section>

      <section v-if="facts" class="facts">
        <h2>Observable Facts</h2>
        <div class="facts-grid">
          <div>exit: <strong>{{ facts.exit_code }}</strong></div>
          <div>files: <strong>{{ facts.files_changed?.length ?? 0 }}</strong></div>
          <div v-if="facts.diff_stats">
            +{{ facts.diff_stats.additions }} / -{{ facts.diff_stats.deletions }}
          </div>
          <div v-if="facts.test_result">
            tests: {{ facts.test_result.passed }} pass / {{ facts.test_result.failed }} fail
          </div>
          <div v-if="facts.branch">branch: {{ facts.branch }}</div>
          <div v-if="facts.commit_hash">commit: {{ facts.commit_hash?.slice(0, 8) }}</div>
        </div>
        <details v-if="facts.files_changed?.length">
          <summary>changed files ({{ facts.files_changed.length }})</summary>
          <ul>
            <li v-for="f in facts.files_changed" :key="f">{{ f }}</li>
          </ul>
        </details>
      </section>

      <section v-if="facts?.gate3" class="gate3">
        <h2>Gate 3 Result</h2>
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
        <h2>Logs ({{ logs.length }})</h2>
        <div ref="logStream" class="log-stream">
          <div v-for="log in logs" :key="log.id" class="log-entry">
            <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            <span class="log-agent">[{{ log.agent }}]</span>
            <span class="log-msg">{{ log.message }}</span>
          </div>
          <div v-if="logs.length === 0" class="empty">no logs yet</div>
        </div>
      </section>
    </template>

    <div v-else class="loading">loading...</div>
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
</style>
