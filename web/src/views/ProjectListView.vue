<script setup>
/**
 * 项目列表视图（路由 /）。
 *
 * 展示概览统计、项目搜索筛选与项目卡片；点击卡片进入项目详情路由。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Refresh, Connection } from '@element-plus/icons-vue';
import ProjectList from '../components/ProjectList.vue';
import NewProjectModal from '../components/NewProjectModal.vue';
import { store, loadOverview } from '../store';

const router = useRouter();
const showNewProject = ref(false);

const overview = computed(() => store.overview);
const refreshing = computed(() => store.refreshing);

function openProject(name) {
  router.push({ name: 'project', params: { name } });
}

function onProjectCreated(name) {
  showNewProject.value = false;
  ElMessage.success(`项目「${name}」已创建`);
  router.push({ name: 'project', params: { name } });
  void loadOverview();
}

onMounted(() => {
  if (!overview.value) void loadOverview();
});
</script>

<template>
  <div class="overview">
    <section class="overview-hero" aria-labelledby="overview-title">
      <div class="overview-heading">
        <h1 id="overview-title" tabindex="-1">项目概览</h1>
        <p>浏览和管理 Compose 项目及其容器。</p>
      </div>
      <div class="overview-tools">
        <el-button :icon="Refresh" :loading="refreshing" @click="loadOverview">刷新列表</el-button>
        <el-button type="primary" :icon="Plus" @click="showNewProject = true">新建项目</el-button>
      </div>
    </section>

    <div v-if="overview && !overview.dockerOk" class="offline-note">
      <el-icon aria-hidden="true"><Connection /></el-icon>
      <span><strong>Docker 未连接</strong><span class="offline-note-detail">容器状态和操作不可用，仍可编辑 Compose 配置。</span></span>
    </div>

    <el-alert
      v-if="store.overviewError"
      class="overview-alert"
      title="无法刷新项目列表"
      :description="store.overviewError"
      type="error"
      :closable="false"
      show-icon
    />

    <ProjectList
      v-if="overview"
      :projects="overview.projects"
      :docker-ok="overview.dockerOk"
      @open="openProject"
      @create="showNewProject = true"
    />
    <div v-else-if="refreshing" class="surface-state" role="status">正在扫描项目…</div>

    <details v-if="overview?.composeRoot" class="root-location">
      <summary>扫描目录</summary>
      <code>{{ overview.composeRoot }}</code>
    </details>

    <NewProjectModal v-if="showNewProject" @close="showNewProject = false" @created="onProjectCreated" />
  </div>
</template>
