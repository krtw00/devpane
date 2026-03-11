<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchMemories, deleteMemory, updateMemory, type Memory } from '../composables/useApi'

const memories = ref<Memory[]>([])
const loading = ref(false)
const activeCategory = ref<string>('all')
const categories = ['all', 'feature', 'decision', 'lesson'] as const

const editingId = ref<string | null>(null)
const editContent = ref('')

async function refresh() {
  loading.value = true
  try {
    const cat = activeCategory.value === 'all' ? undefined : activeCategory.value
    memories.value = await fetchMemories(cat)
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  if (!confirm('このメモリを削除しますか？')) return
  await deleteMemory(id)
  await refresh()
}

function startEdit(m: Memory) {
  editingId.value = m.id
  editContent.value = m.content
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit(id: string) {
  await updateMemory(id, editContent.value)
  editingId.value = null
  editContent.value = ''
  await refresh()
}

function categoryLabel(cat: string) {
  return { feature: 'Feature', decision: 'Decision', lesson: 'Lesson' }[cat] ?? cat
}

function categoryColor(cat: string) {
  return { feature: '#58a6ff', decision: '#d29922', lesson: '#3fb950' }[cat] ?? '#8b949e'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const grouped = computed(() => {
  const groups: Record<string, Memory[]> = { feature: [], decision: [], lesson: [] }
  for (const m of memories.value) {
    groups[m.category]?.push(m)
  }
  return groups
})

const visibleCategories = computed(() => {
  if (activeCategory.value === 'all') return ['feature', 'decision', 'lesson']
  return [activeCategory.value]
})

onMounted(refresh)
</script>

<template>
  <div class="memory-view">
    <header>
      <div class="header-row">
        <div>
          <h1>Memories</h1>
          <span class="subtitle">PM knowledge base</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/memories" class="active">Memories</router-link>
        </nav>
      </div>
    </header>

    <div class="filter-bar">
      <div class="btn-group">
        <button
          v-for="cat in categories"
          :key="cat"
          :class="['filter-btn', { active: activeCategory === cat }]"
          @click="activeCategory = cat; refresh()"
        >{{ cat }}</button>
      </div>
    </div>

    <div v-if="loading && memories.length === 0" class="loading">loading...</div>

    <div v-for="cat in visibleCategories" :key="cat" class="category-section">
      <h2 class="category-title" :style="{ color: categoryColor(cat) }">
        {{ categoryLabel(cat) }}
        <span class="category-count">({{ (grouped[cat] ?? []).length }})</span>
      </h2>

      <div v-if="!(grouped[cat] ?? []).length" class="empty-cat">no memories</div>

      <ul class="memory-list">
        <li v-for="m in (grouped[cat] ?? [])" :key="m.id" class="memory-item">
          <div v-if="editingId === m.id" class="edit-form">
            <textarea v-model="editContent" class="edit-textarea" rows="3" />
            <div class="edit-actions">
              <button class="btn-save" @click="saveEdit(m.id)">Save</button>
              <button class="btn-cancel" @click="cancelEdit">Cancel</button>
            </div>
          </div>
          <div v-else>
            <div class="memory-content">{{ m.content }}</div>
            <div class="memory-meta">
              <span>{{ timeAgo(m.updated_at) }}</span>
              <span v-if="m.source_task_id" class="memory-source">
                <router-link :to="`/tasks/${m.source_task_id}`">source task</router-link>
              </span>
            </div>
            <div class="memory-actions">
              <button class="btn-edit" @click="startEdit(m)">Edit</button>
              <button class="btn-delete" @click="remove(m.id)">Delete</button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="!loading && memories.length === 0" class="empty">no memories stored yet</div>
  </div>
</template>

<style scoped>
.memory-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header { margin-bottom: 2rem; }

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

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-links a {
  color: #8b949e;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.nav-links a:hover { color: #c9d1d9; }

.nav-links a.active,
.nav-links a.router-link-exact-active {
  color: #58a6ff;
}

.filter-bar {
  margin-bottom: 1.5rem;
}

.btn-group { display: flex; }

.filter-btn {
  background: #161b22;
  color: #8b949e;
  border: 1px solid #30363d;
  padding: 0.25rem 0.5rem;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-btn:first-child { border-radius: 4px 0 0 4px; }
.filter-btn:last-child { border-radius: 0 4px 4px 0; }
.filter-btn:not(:first-child) { border-left: none; }
.filter-btn:hover { color: #c9d1d9; }

.filter-btn.active {
  background: #30363d;
  color: #58a6ff;
  border-color: #58a6ff;
}

.filter-btn.active + .filter-btn {
  border-left: 1px solid #30363d;
}

.category-section {
  margin-bottom: 2rem;
}

.category-title {
  font-size: 0.95rem;
  margin: 0 0 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.category-count {
  font-size: 0.75rem;
  color: #8b949e;
  font-weight: normal;
}

.memory-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.memory-item {
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
}

.memory-content {
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.memory-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.7rem;
  color: #8b949e;
  margin-top: 0.5rem;
}

.memory-source a {
  color: #58a6ff;
  text-decoration: none;
}

.memory-source a:hover { text-decoration: underline; }

.memory-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.btn-edit, .btn-delete {
  background: transparent;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
}

.btn-edit {
  color: #58a6ff;
}

.btn-edit:hover {
  border-color: #58a6ff;
}

.btn-delete {
  color: #f85149;
}

.btn-delete:hover {
  border-color: #f85149;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-textarea {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
  outline: none;
}

.edit-textarea:focus { border-color: #58a6ff; }

.edit-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-save {
  background: #238636;
  color: #f0f6fc;
  border: none;
  border-radius: 4px;
  padding: 0.25rem 0.75rem;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.btn-cancel {
  background: transparent;
  color: #8b949e;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.25rem 0.75rem;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.btn-cancel:hover {
  color: #c9d1d9;
  border-color: #484f58;
}

.empty-cat {
  color: #484f58;
  font-size: 0.8rem;
  padding: 0.5rem 0;
}

.loading, .empty {
  text-align: center;
  color: #8b949e;
  padding: 3rem 0;
}
</style>
