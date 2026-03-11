<script setup lang="ts">
import { ref, onMounted } from 'vue'

const BASE = '/api'

type Memory = {
  id: string
  content: string
  [key: string]: unknown
}

const memories = ref<Memory[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${BASE}/memories`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    memories.value = await res.json()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <header>
      <div class="header-row">
        <div>
          <h1>Memories</h1>
          <span class="subtitle">agent memory store</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/pipeline">Pipeline</router-link>
          <router-link to="/memories" class="active">Memories</router-link>
          <router-link to="/spc">SPC</router-link>
        </nav>
      </div>
    </header>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="memories.length === 0" class="empty">no memories yet</div>

    <ul v-else class="list">
      <li v-for="mem in memories" :key="mem.id" class="list-item">
        <span class="mem-id">{{ mem.id }}</span>
        <span class="mem-content">{{ mem.content }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header { margin-bottom: 2rem; }

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

.loading, .empty { text-align: center; color: #8b949e; padding: 3rem 0; }
.error { text-align: center; color: #f85149; padding: 3rem 0; }

.list { list-style: none; padding: 0; margin: 0; }

.list-item {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  margin-bottom: 0.5rem;
}

.mem-id { color: #58a6ff; flex-shrink: 0; font-size: 0.8rem; }
.mem-content { color: #c9d1d9; word-break: break-all; }
</style>
