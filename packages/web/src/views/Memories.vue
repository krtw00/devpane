<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchMemories, createMemory, deleteMemory, type Memory } from '../composables/useApi'
import { useSocket } from '../composables/useSocket'

const { connected } = useSocket()
const memories = ref<Memory[]>([])
const loading = ref(false)
const activeTab = ref<'all' | 'feature' | 'decision' | 'lesson'>('all')

const newCategory = ref<'feature' | 'decision' | 'lesson'>('decision')
const newContent = ref('')
const submitting = ref(false)

async function refresh() {
  loading.value = true
  try {
    const cat = activeTab.value === 'all' ? undefined : activeTab.value
    memories.value = await fetchMemories(cat)
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => memories.value)

const tabs = ['all', 'feature', 'decision', 'lesson'] as const

function tabCount(tab: string): number {
  if (tab === 'all') return memories.value.length
  return memories.value.filter(m => m.category === tab).length
}

async function handleAdd() {
  if (!newContent.value.trim()) return
  submitting.value = true
  try {
    await createMemory({ category: newCategory.value, content: newContent.value.trim() })
    newContent.value = ''
    await refresh()
  } finally {
    submitting.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('この記憶を削除しますか？')) return
  await deleteMemory(id)
  await refresh()
}

function categoryColor(cat: string): string {
  if (cat === 'feature') return '#58a6ff'
  if (cat === 'decision') return '#d29922'
  if (cat === 'lesson') return '#3fb950'
  return '#8b949e'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

onMounted(refresh)
</script>

<template>
  <div class="memories-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Memories</h1>
          <span class="subtitle">PM knowledge base</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics">Metrics</router-link>
          <router-link to="/improvements">Improvements</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/memories" class="active">Memories</router-link>
        </nav>
        <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
          <span class="conn-dot" />
          {{ connected ? 'connected' : 'disconnected' }}
        </div>
      </div>
    </header>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab"
        class="tab-btn"
        :class="{ active: activeTab === tab }"
        @click="activeTab = tab; refresh()"
      >
        {{ tab }}
        <span class="tab-count">{{ tabCount(tab) }}</span>
      </button>
    </div>

    <div class="add-form">
      <select v-model="newCategory" class="cat-select">
        <option value="feature">feature</option>
        <option value="decision">decision</option>
        <option value="lesson">lesson</option>
      </select>
      <textarea
        v-model="newContent"
        class="content-input"
        placeholder="新しい記憶を追加..."
        rows="2"
        @keydown.ctrl.enter="handleAdd"
      />
      <button class="add-btn" :disabled="submitting || !newContent.trim()" @click="handleAdd">
        {{ submitting ? '...' : 'Add' }}
      </button>
    </div>

    <div v-if="loading && memories.length === 0" class="loading">loading...</div>

    <div class="memory-list">
      <div v-for="m in filtered" :key="m.id" class="memory-card">
        <div class="memory-header">
          <span class="memory-cat" :style="{ color: categoryColor(m.category) }">{{ m.category }}</span>
          <span class="memory-date">{{ formatDate(m.created_at) }}</span>
          <button class="delete-btn" @click="handleDelete(m.id)">x</button>
        </div>
        <div class="memory-content">{{ m.content }}</div>
        <div v-if="m.source_task_id" class="memory-source">
          <router-link :to="`/tasks/${m.source_task_id}`">
            task:{{ m.source_task_id.slice(-6) }}
          </router-link>
        </div>
      </div>
      <div v-if="!loading && memories.length === 0" class="empty">no memories yet</div>
    </div>
  </div>
</template>

<style scoped>
.memories-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header { margin-bottom: 1.5rem; }

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h1 { font-size: 1.5rem; margin: 0; color: #f0f6fc; }
.subtitle { color: #8b949e; font-size: 0.85rem; }

.nav-links { display: flex; gap: 1rem; }
.nav-links a { color: #8b949e; text-decoration: none; font-size: 0.85rem; padding: 0.25rem 0.5rem; border-radius: 4px; }
.nav-links a:hover { color: #c9d1d9; }
.nav-links a.active, .nav-links a.router-link-exact-active { color: #58a6ff; }

.conn-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; }
.conn-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.conn-ok .conn-dot { background: #3fb950; }
.conn-ok { color: #3fb950; }
.conn-err .conn-dot { background: #f85149; }
.conn-err { color: #f85149; }

.tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #21262d;
  padding-bottom: 0.5rem;
}

.tab-btn {
  background: none;
  border: none;
  color: #8b949e;
  font-family: inherit;
  font-size: 0.8rem;
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
}

.tab-btn:hover { color: #c9d1d9; }
.tab-btn.active { color: #58a6ff; background: #161b22; }

.tab-count {
  font-size: 0.65rem;
  background: #21262d;
  padding: 0.1rem 0.35rem;
  border-radius: 8px;
  margin-left: 0.3rem;
}

.add-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  align-items: flex-start;
}

.cat-select {
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.4rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.content-input {
  flex: 1;
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.4rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  resize: vertical;
}

.content-input::placeholder { color: #484f58; }

.add-btn {
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 0.4rem 1rem;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  flex-shrink: 0;
}

.add-btn:hover { background: #2ea043; }
.add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.memory-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.memory-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem;
}

.memory-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.memory-cat {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.memory-date {
  font-size: 0.7rem;
  color: #484f58;
  margin-left: auto;
}

.delete-btn {
  background: none;
  border: none;
  color: #484f58;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0 0.3rem;
}

.delete-btn:hover { color: #f85149; }

.memory-content {
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

.memory-source {
  margin-top: 0.5rem;
  font-size: 0.7rem;
}

.memory-source a {
  color: #58a6ff;
  text-decoration: none;
}

.memory-source a:hover { text-decoration: underline; }

.loading, .empty { color: #8b949e; text-align: center; padding: 3rem 0; }
</style>
