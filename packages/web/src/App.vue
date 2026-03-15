<script setup lang="ts">
import { onMounted, provide, ref } from 'vue'

const appName = ref('DevPane')

provide('appName', appName)

onMounted(async () => {
  try {
    const res = await fetch('/api/config')
    if (res.ok) {
      const data = await res.json()
      if (data.appName) {
        appName.value = data.appName
        document.title = data.appName
      }
    }
  } catch {
    // keep default
  }
})
</script>

<template>
  <router-view />
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
</style>
