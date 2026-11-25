/**
 * 路由表。
 *
 *  /                项目列表（概览 + 项目卡片）
 *  /project/:name   项目详情（可视化编辑 / YAML / .env / 容器）
 *
 * 后端对非 /api/ 路径有 SPA 回退，直接访问深链接也能正常打开。
 */
import { createRouter, createWebHistory } from 'vue-router';
import ProjectListView from '../views/ProjectListView.vue';
import ProjectDetailView from '../views/ProjectDetailView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'projects', component: ProjectListView, meta: { title: 'Compose 项目' } },
    { path: '/project/:name', name: 'project', component: ProjectDetailView, props: true, meta: { title: '项目详情' } },
    { path: '/:pathMatch(.*)*', redirect: { name: 'projects' } },
  ],
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 };
  },
});
