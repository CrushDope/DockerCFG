<script setup>
/**
 * 项目详情视图（路由 /project/:name）。
 *
 * 含运行管理、可视化编辑、YAML 源码、.env 与容器四个标签页。
 * 离开本页前会检查未保存的改动。
 */
import { ref, onMounted, computed } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Box, Connection, VideoPlay, Refresh, Download, Remove } from '@element-plus/icons-vue';
import { api } from '../api';
import { store } from '../store';
import ComposeEditor from '../components/ComposeEditor.vue';

const props = defineProps({ name: { type: String, required: true } });
const router = useRouter();
const loading = ref(true);
const loadError = ref('');
const project = ref(null);
const containers = ref([]);
const dockerOk = ref(null);
const containerLoading = ref(false);
const tab = ref('form');
const composeRaw = ref('');
const envRaw = ref('');
const busy = ref('');
const refreshing = computed(() => loading.value || containerLoading.value);
const runtimeStatus = computed(() => {
  if (containerLoading.value) return { label: '检查容器状态中', tone: 'neutral' };
  if (dockerOk.value !== true) return { label: '状态未知', tone: 'neutral' };
  if (!containers.value.length) return { label: '尚无容器', tone: 'neutral' };
  const running = containers.value.filter((c) => c.state === 'running').length;
  return { label: `${running} / ${containers.value.length} 个容器运行中`, tone: running === containers.value.length ? 'positive' : running ? 'warning' : 'negative' };
});

async function loadProject({ replaceCompose = false, replaceEnv = false } = {}) {
  loading.value = true;
  loadError.value = '';
  try {
    const next = await api.project(props.name);
    // 刷新一份配置时保留另一份文件中尚未保存的草稿。
    if (!project.value || replaceCompose || composeRaw.value === persistedCompose) composeRaw.value = next.composeRaw;
    if (!project.value || replaceEnv || envRaw.value === persistedEnv) envRaw.value = next.env.raw;
    persistedCompose = next.composeRaw;
    persistedEnv = next.env.raw;
    project.value = next;
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadContainers() {
  if (containerLoading.value) return;
  containerLoading.value = true;
  try {
    const overview = await api.overview();
    dockerOk.value = overview.dockerOk;
    containers.value = overview.projects.find((p) => p.name === props.name)?.containers ?? [];
    store.overview = overview;
  } catch {
    dockerOk.value = null;
    containers.value = [];
  } finally {
    containerLoading.value = false;
  }
}

/** 当前是否存在未保存的改动（表单 / 源码 / .env） */
function hasUnsavedChanges() {
  return !!editor.value?.isDirty()
    || (project.value && (composeRaw.value !== persistedCompose || envRaw.value !== persistedEnv));
}

async function confirmDiscard(message) {
  try {
    await ElMessageBox.confirm(message, '确认操作', { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' });
    return true;
  } catch { return false; }
}

const editor = ref(null);
let persistedCompose = '';
let persistedEnv = '';
async function refresh() {
  if (refreshing.value || busy.value) return;
  if (!project.value) { await Promise.all([loadProject(), loadContainers()]); return; }
  // 刷新运行状态不重载表单或源码，避免覆盖未保存的配置。
  await loadContainers();
}

async function goBack() {
  if (busy.value) return;
  // 未保存改动的确认交给路由离开拦截器统一处理
  router.push({ name: 'projects' });
}

// 路由离开拦截：顶栏返回、浏览器前进后退都走这里
onBeforeRouteLeave(async () => {
  if (busy.value) return false;
  if (!hasUnsavedChanges()) return true;
  return await confirmDiscard('离开项目会丢弃尚未保存的配置。');
});

/** 重新从磁盘载入配置（丢弃本地未保存的表单修改） */
async function reloadProject() {
  if (busy.value) return;
  if (editor.value?.isDirty() && !await confirmDiscard('重新载入会丢弃尚未保存的表单修改。')) return;
  await loadProject({ replaceCompose: true, replaceEnv: true });
}

async function saveCompose(content, envUpdates = [], fromForm = false) {
  if (busy.value) return false;
  if (fromForm && composeRaw.value !== persistedCompose && !await confirmDiscard('保存表单会覆盖尚未保存的 YAML 源码。')) return false;
  if (!fromForm && editor.value?.isDirty() && !await confirmDiscard('保存 YAML 源码会覆盖尚未保存的表单修改。')) return false;
  if (envUpdates.length && envRaw.value !== persistedEnv && !await confirmDiscard('保存引用变量会覆盖尚未保存的 .env 源码。')) return false;
  busy.value = 'compose';
  try {
    await api.saveCompose(props.name, content, envUpdates);
    await loadProject({ replaceCompose: true, replaceEnv: !!envUpdates.length });
    ElMessage.success('Compose 配置已保存');
    return true;
  } catch (e) {
    ElMessage.error(e.message);
    return false;
  } finally { busy.value = ''; }
}

async function saveEnvRaw() {
  if (busy.value) return;
  if (editor.value?.isDirty() && !await confirmDiscard('保存 .env 后会重新加载表单，未保存的表单修改会丢失。')) return;
  busy.value = 'env';
  try {
    await api.saveEnvRaw(props.name, envRaw.value);
    await loadProject({ replaceEnv: true });
    ElMessage.success('.env 已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally { busy.value = ''; }
}

const actions = { up: '启动', restart: '重启', pull: '拉取镜像', down: '停止并移除' };
const actionIcons = { up: VideoPlay, restart: Refresh, pull: Download, down: Remove };
const containerStates = { running: '运行中', exited: '已停止', dead: '已停止', created: '已创建', paused: '已暂停', restarting: '重启中' };

async function projectAct(action) {
  if (busy.value) return;
  busy.value = action;
  try {
    const message = action === 'down' ? `这会停止并移除项目「${props.name}」的容器。` : `对项目「${props.name}」执行${actions[action]}？`;
    if (!await confirmDiscard(message)) return;
    await api.projectAction(props.name, action);
    ElMessage.success(`${actions[action]}完成`);
    await loadContainers();
  } catch (e) {
    ElMessage.error(e.message);
  } finally { busy.value = ''; }
}

async function containerAct(id, action) {
  if (busy.value) return;
  busy.value = id + action;
  try {
    await api.containerAction(id, action);
    ElMessage.success(`容器已${{ start: '启动', stop: '停止', restart: '重启' }[action]}`);
    await loadContainers();
  } catch (e) {
    ElMessage.error(e.message);
  } finally { busy.value = ''; }
}

onMounted(() => {
  void loadContainers();
  void loadProject();
});
</script>

<template>
  <div class="detail">
    <nav class="detail-breadcrumb" aria-label="项目导航">
      <el-button :icon="ArrowLeft" link type="primary" :disabled="!!busy" @click="goBack">返回项目列表</el-button>
    </nav>
    <header class="detail-header">
      <span class="detail-mark" aria-hidden="true"><el-icon><Box /></el-icon></span>
      <div class="detail-title">
        <h1 tabindex="-1">{{ name }}</h1>
        <code v-if="project" class="detail-path">{{ project.composePath }}</code>
      </div>
    </header>

    <section class="runtime-panel" aria-labelledby="runtime-title">
      <div class="runtime-summary">
        <el-icon class="runtime-icon" aria-hidden="true"><Connection /></el-icon>
        <div><h2 id="runtime-title">运行管理</h2><p v-if="!refreshing && dockerOk !== true">Docker 未连接，仅可编辑配置。</p></div>
        <span class="state-pill" :class="runtimeStatus.tone" role="status"><span class="status-dot" aria-hidden="true"></span>{{ runtimeStatus.label }}</span>
      </div>
      <div class="detail-actions">
        <el-button :icon="Refresh" :loading="refreshing" :disabled="!!busy" @click="refresh">{{ project ? '刷新状态' : '重新加载' }}</el-button>
        <template v-if="dockerOk === true">
          <el-button v-for="(label, action) in actions" :key="action" :icon="actionIcons[action]"
            :type="action === 'up' ? 'primary' : action === 'down' ? 'danger' : 'default'" :plain="action === 'down'"
            :loading="busy === action" :disabled="!!busy || !project || (!!project.parseError && action === 'up')"
            @click="projectAct(action)">{{ label }}</el-button>
        </template>
      </div>
    </section>

    <el-alert v-if="loadError" class="detail-alert" title="无法读取项目配置" :description="loadError" type="error" :closable="false" show-icon />
    <div v-if="loading && !project" class="surface-state" role="status">正在读取项目配置…</div>
    <template v-if="project">
      <el-alert v-if="project.parseError" class="detail-alert" :title="`YAML 解析错误：${project.parseError}`"
        description="请切换到「YAML 源码」修复后保存。" type="error" :closable="false" show-icon />
      <div class="detail-workspace" v-loading="loading">
        <el-tabs v-model="tab" class="detail-tabs">
          <el-tab-pane label="可视化编辑" name="form">
            <ComposeEditor v-if="!project.parseError" ref="editor" :project="project" :busy="!!busy"
              :containers="containers" :save-config="(content, updates) => saveCompose(content, updates, true)"
              @reload="reloadProject" />
            <div v-else class="surface-state"><p>修复 YAML 后即可使用可视化编辑。</p><el-button @click="tab = 'raw'">打开 YAML 源码</el-button></div>
          </el-tab-pane>
          <el-tab-pane label="YAML 源码" name="raw">
            <div class="editor-toolbar">
              <div><h2>Compose 源码</h2><p>保存前会检查 YAML 格式。</p></div>
              <span v-if="composeRaw !== project.composeRaw" class="state-pill warning" role="status">有未保存的修改</span>
              <el-button type="primary" :loading="busy === 'compose'" :disabled="!!busy || composeRaw === project.composeRaw" @click="saveCompose(composeRaw)">保存 YAML</el-button>
            </div>
            <el-input v-model="composeRaw" type="textarea" :rows="18" class="code-editor"
              aria-label="Compose YAML 源码" :disabled="!!busy" :spellcheck="false" />
          </el-tab-pane>
          <el-tab-pane label=".env 文件" name="env">
            <div class="editor-toolbar">
              <div><h2>环境文件</h2><p>{{ project.env.exists ? '每行填写一个 KEY=value。' : '尚无 .env 文件，输入内容并保存即可创建。' }}</p></div>
              <span v-if="envRaw !== project.env.raw" class="state-pill warning" role="status">有未保存的修改</span>
              <el-button type="primary" :loading="busy === 'env'" :disabled="!!busy || envRaw === project.env.raw" @click="saveEnvRaw">保存 .env</el-button>
            </div>
            <el-input v-model="envRaw" type="textarea" :rows="12" class="code-editor short" placeholder="KEY=value"
              aria-label=".env 源码" :disabled="!!busy" :spellcheck="false" autocomplete="off" />
          </el-tab-pane>
          <el-tab-pane :label="`容器${containers.length ? `（${containers.length}）` : ''}`" name="containers">
            <div v-if="containerLoading" class="surface-state" role="status">正在读取容器状态…</div>
            <div v-else-if="dockerOk !== true" class="surface-state">Docker 状态不可用。请检查连接后刷新状态。</div>
            <div v-else-if="!containers.length" class="surface-state">该项目还没有容器，可点击「启动」创建。</div>
            <ul v-else class="container-list">
              <li v-for="c in containers" :key="c.id" class="container-row">
                <span class="state-pill" :class="c.state === 'running' ? 'positive' : 'neutral'">
                  <span class="status-dot" aria-hidden="true"></span>{{ containerStates[c.state] ?? c.state }}
                </span>
                <div class="container-name">{{ c.name }}<div class="container-sub mono">{{ c.service }} · {{ c.image }}</div></div>
                <div class="container-actions">
                  <el-button :disabled="!!busy" :loading="busy === c.id + (c.state === 'running' ? 'stop' : 'start')"
                    @click="containerAct(c.id, c.state === 'running' ? 'stop' : 'start')">{{ c.state === 'running' ? '停止' : '启动' }}</el-button>
                  <el-button :disabled="!!busy" :loading="busy === c.id + 'restart'" @click="containerAct(c.id, 'restart')">重启</el-button>
                </div>
              </li>
            </ul>
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>
  </div>
</template>
