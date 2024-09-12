import { createRouter, createWebHistory } from 'vue-router';
import LiveStreamVue from '../components/LiveStreamVue.vue';

const routes = [
  {
    path: '/live-stream',
    name: 'LiveStream',
    component: LiveStreamVue
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
