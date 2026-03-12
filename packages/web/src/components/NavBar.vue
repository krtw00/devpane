<script setup lang="ts">
import { useSocket } from '../composables/useSocket'

const { connected } = useSocket()

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/cost', label: 'Cost' },
  { to: '/events', label: 'Events' },
  { to: '/memories', label: 'Memories' },
]

defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="navbar">
    <div class="header-row">
      <div>
        <h1>{{ title }}</h1>
        <span v-if="subtitle" class="subtitle">{{ subtitle }}</span>
      </div>
      <nav class="nav-links">
        <router-link
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :class="{ 'router-link-exact-active': false }"
          :exact="link.exact"
        >{{ link.label }}</router-link>
      </nav>
      <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
        <span class="conn-dot" />
        {{ connected ? 'connected' : 'disconnected' }}
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar {
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

.nav-links a:hover {
  color: #c9d1d9;
}

.nav-links a.router-link-exact-active {
  color: #58a6ff;
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
</style>
