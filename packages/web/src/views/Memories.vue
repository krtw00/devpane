<script setup lang="ts">
</script>

<template>
  <div class="memories-page">
    <h1>Memories</h1>
    <span class="subtitle">agent memory store</span>
    <div class="empty">no memories yet</div>
  </div>
</template>

<style scoped>
.memories-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

h1 { font-size: 1.5rem; margin: 0; color: #f0f6fc; }
.subtitle { color: #8b949e; font-size: 0.85rem; }
.empty { text-align: center; color: #8b949e; padding: 3rem 0; }
</style>
