import { createRouter, createWebHistory } from 'vue-router';
import LiveStreamVue from '../components/LiveStreamVue.vue';
import LiveStreamKurento from '../components/LiveStreamKurento.vue';

const routes = [
  {
    path: '/live-stream',
    name: 'LiveStream',
    component: LiveStreamVue
  },
  {
    path: '/live-stream/kurento',
    name: 'LiveStreamKurento',
    component: LiveStreamKurento
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
