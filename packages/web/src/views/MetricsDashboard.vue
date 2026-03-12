<script setup lang="ts">
</script>

<template>
  <div class="metrics-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Metrics</h1>
          <span class="subtitle">SPC control charts</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics" class="active">Metrics</router-link>
          <router-link to="/improvements">Improvements</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/memories">Memories</router-link>
        </nav>
      </div>
    </header>

    <div class="placeholder">metrics dashboard — coming soon</div>
  </div>
</template>

<style scoped>
.metrics-page {
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

.placeholder {
  text-align: center;
  color: #8b949e;
  padding: 3rem 0;
}
</style>
