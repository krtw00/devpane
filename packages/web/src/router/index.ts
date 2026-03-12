import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import TaskDetail from '../views/TaskDetail.vue'
import EventsLog from '../views/EventsLog.vue'
import Memories from '../views/Memories.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/tasks/:id', component: TaskDetail, props: true },
    { path: '/events', component: EventsLog },
    { path: '/memories', component: Memories },
  ],
})
