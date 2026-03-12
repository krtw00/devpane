<template>
  <div class="app">
    <nav class="global-nav">
      <router-link to="/">Dashboard</router-link>
      <router-link to="/pipeline">Pipeline</router-link>
      <router-link to="/memories">Memories</router-link>
      <router-link to="/spc">SPC</router-link>
      <router-link to="/improvements">Improvements</router-link>
      <router-link to="/cost">Cost</router-link>
      <router-link to="/events">Events</router-link>
    </nav>
    <router-view />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #0d1117;
  color: #c9d1d9;
  min-height: 100vh;
}

.global-nav {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  border-bottom: 1px solid #30363d;
}

.global-nav a {
  color: #8b949e;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.global-nav a:hover {
  color: #c9d1d9;
}

.global-nav a.router-link-exact-active {
  color: #58a6ff;
}
</style>
