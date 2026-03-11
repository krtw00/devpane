import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import TaskDetail from '../views/TaskDetail.vue'
import CostDashboard from '../views/CostDashboard.vue'
import EventsLog from '../views/EventsLog.vue'
import PipelineView from '../views/PipelineView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/tasks/:id', component: TaskDetail, props: true },
    { path: '/cost', component: CostDashboard },
    { path: '/events', component: EventsLog },
    { path: '/pipeline', component: PipelineView },
  ],
})
