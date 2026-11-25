<script setup>
import { computed, ref } from 'vue';
import { ArrowRight, Box, Collection, Document, Grid, Menu, Search, TrendCharts } from '@element-plus/icons-vue';

const props = defineProps({ projects: { type: Array, default: () => [] }, dockerOk: Boolean });
const emit = defineEmits(['open', 'create']);
const query = ref('');
const selectedState = ref('all');
const layout = ref('list');
const states = {
  running: { tone: 'positive', label: '运行中' },
  partial: { tone: 'warning', label: '部分运行' },
  stopped: { tone: 'negative', label: '已停止' },
  'no-container': { tone: 'neutral', label: '无容器' },
};
const unknownState = { tone: 'neutral', label: '状态未知' };
const stateOf = (p) => props.dockerOk ? (states[p.state] ?? unknownState) : unknownState;
const metrics = computed(() => [
  { label: '项目总数', icon: Box, value: props.projects.length },
  { label: '运行中的项目', icon: TrendCharts, value: props.dockerOk ? props.projects.filter((p) => p.state === 'running').length : '—' },
  { label: '服务总数', icon: Collection, value: props.projects.reduce((sum, p) => sum + p.serviceCount, 0) },
  { label: '含 .env 的项目', icon: Document, value: props.projects.filter((p) => p.envPath).length },
]);
const visibleProjects = computed(() => {
  const term = query.value.trim().toLowerCase();
  return props.projects.filter((p) =>
    (!props.dockerOk || selectedState.value === 'all' || p.state === selectedState.value) &&
    [p.name, p.composePath, ...(p.services ?? [])].some((value) => String(value).toLowerCase().includes(term)));
});

function clearFilters() {
  query.value = '';
  selectedState.value = 'all';
}
</script>

<template>
  <section aria-labelledby="projects-title">
    <dl class="fleet-metrics" aria-label="项目统计">
      <div v-for="metric in metrics" :key="metric.label" class="fleet-metric">
        <span class="metric-icon" aria-hidden="true"><el-icon><component :is="metric.icon" /></el-icon></span>
        <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div>
      </div>
    </dl>

    <div class="project-registry">
      <div class="projects-toolbar">
        <div class="projects-title"><h2 id="projects-title">Compose 项目</h2><span role="status">{{ visibleProjects.length }} / {{ projects.length }} 个项目</span></div>
        <div v-if="projects.length" class="project-filters">
          <el-input v-model="query" :prefix-icon="Search" aria-label="搜索项目、路径或服务" placeholder="搜索项目、路径或服务" clearable />
          <el-select v-if="dockerOk" v-model="selectedState" aria-label="按容器状态筛选">
            <el-option label="全部状态" value="all" />
            <el-option v-for="(state, key) in states" :key="key" :label="state.label" :value="key" />
          </el-select>
          <div class="view-control" role="group" aria-label="项目显示方式">
            <button type="button" aria-label="列表视图" :aria-pressed="layout === 'list'" @click="layout = 'list'"><el-icon aria-hidden="true"><Menu /></el-icon></button>
            <button type="button" aria-label="卡片视图" :aria-pressed="layout === 'grid'" @click="layout = 'grid'"><el-icon aria-hidden="true"><Grid /></el-icon></button>
          </div>
        </div>
      </div>

      <div v-if="!visibleProjects.length" class="surface-state">
        <el-icon :size="28" aria-hidden="true"><component :is="projects.length ? Search : Box" /></el-icon>
        <h3>{{ projects.length ? '没有符合条件的项目' : '未扫描到 Compose 项目' }}</h3>
        <p>{{ projects.length ? '试试其他关键词，或清除状态筛选。' : '确认扫描目录下有项目子目录，并包含 Compose 文件。' }}</p>
        <el-button v-if="projects.length" @click="clearFilters">清除筛选</el-button>
        <el-button v-else type="primary" plain @click="emit('create')">新建项目</el-button>
      </div>

      <div v-else class="project-results" :class="`view-${layout}`">
        <div v-if="layout === 'list'" class="row-head" aria-hidden="true">
          <span>项目 / Compose 文件</span><span>服务</span><span>容器状态</span><span></span>
        </div>
        <ul class="project-items" aria-label="项目列表">
          <li v-for="p in visibleProjects" :key="p.name">
            <button type="button" class="project-card" :aria-label="`打开项目 ${p.name}`"
              @click="emit('open', p.name, $event.currentTarget)">
              <span class="project-identity">
                <span class="project-icon" aria-hidden="true"><el-icon><Box /></el-icon></span>
                <span class="project-names">
                  <span class="project-name">{{ p.name }}</span>
                  <code class="project-path" :title="p.composePath">{{ p.composePath }}</code>
                </span>
              </span>
              <span class="project-services">
                <span v-if="p.parseError?.length" class="service-chip negative">YAML 解析错误</span>
                <template v-else-if="p.services?.length">
                  <code v-for="s in p.services.slice(0, 3)" :key="s" class="service-chip" :title="s">{{ s }}</code>
                  <span v-if="p.services.length > 3" class="service-chip">+{{ p.services.length - 3 }}</span>
                </template>
                <span v-else class="quiet">未声明服务</span>
                <code v-if="p.envPath" class="service-chip env-chip">.env</code>
              </span>
              <span class="project-runtime">
                <span class="state-pill" :class="stateOf(p).tone"><span class="status-dot" aria-hidden="true"></span>{{ stateOf(p).label }}</span>
                <span v-if="dockerOk && p.containers?.length" class="project-container-state">{{ p.runningCount }} / {{ p.containers.length }} 运行</span>
              </span>
              <el-icon class="project-arrow" aria-hidden="true"><ArrowRight /></el-icon>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
