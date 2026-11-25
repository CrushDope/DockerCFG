<script setup>
/**
 * 应用外壳：登录页 / 顶栏 + 路由出口。
 *
 * 页面内容由 vue-router 管理：
 *   /              → 项目列表
 *   /project/:name → 项目详情
 */
import { nextTick, ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { Box, Connection, FolderOpened, Grid, Loading, Lock, SwitchButton } from '@element-plus/icons-vue';
import { api, setUnauthorizedHandler } from './api';
import { store, loadOverview, resetStore } from './store';

const route = useRoute();
const router = useRouter();

const authed = ref(false);
const checking = ref(true);
const loggingIn = ref(false);
const loggingOut = ref(false);
const password = ref('');
const loginError = ref('');
const main = ref(null);

async function check() {
  try {
    authed.value = (await api.authStatus()).authenticated;
    if (authed.value) void loadOverview();
  } catch (e) {
    loginError.value = e.message;
  } finally {
    checking.value = false;
  }
}

async function doLogin() {
  if (loggingIn.value || !password.value) return;
  loginError.value = '';
  loggingIn.value = true;
  try {
    await api.login(password.value);
    authed.value = true;
    password.value = '';
    void loadOverview();
  } catch (e) {
    loginError.value = e.message;
  } finally {
    loggingIn.value = false;
  }
}

async function doLogout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await api.logout();
    resetStore();
    authed.value = false;
    await router.push({ name: 'projects' });
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loggingOut.value = false;
  }
}

// 会话过期时回到登录界面
setUnauthorizedHandler(() => {
  resetStore();
  authed.value = false;
});

// 路由切换后把焦点移到新页面的标题，便于键盘与读屏用户
watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    main.value?.querySelector('h1')?.focus();
  }
);

onMounted(check);
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div v-if="checking" class="loading-box" role="status">
      <el-icon class="is-loading" :size="28" aria-hidden="true"><Loading /></el-icon>
      <span>正在检查登录状态…</span>
    </div>

    <main v-else-if="!authed" class="login-wrap">
      <div class="login-shell">
        <div class="login-banner">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true"><el-icon><Box /></el-icon></span>
            <div><div class="brand-title">DockerCFG Manager</div><div class="brand-sub">Compose 工作台</div></div>
          </div>
          <div class="login-hero">
            <h2 class="login-hero-title">用可视化方式管理 NAS 上的 Compose 项目</h2>
            <p class="login-hero-text">扫描目录、查看容器状态、编辑 compose 与 .env，改动直接落盘。</p>
          </div>
          <div class="login-diagram" aria-hidden="true">
            <div class="diagram-parent"><el-icon><FolderOpened /></el-icon><code>compose.yaml</code></div>
            <div class="diagram-branches"><code>services</code><code>volumes</code><code>networks</code></div>
          </div>
        </div>
        <form class="login-form" @submit.prevent="doLogin">
          <h1>登录工作台</h1>
          <p>输入访问密码，管理 NAS 上的 Compose 项目。</p>
          <label for="access-password">访问密码</label>
          <el-input id="access-password" v-model="password" type="password" placeholder="请输入访问密码"
            autocomplete="current-password" size="large" show-password required
            :aria-invalid="!!loginError" :aria-describedby="loginError ? 'login-error' : undefined">
            <template #prefix><el-icon aria-hidden="true"><Lock /></el-icon></template>
          </el-input>
          <el-alert v-if="loginError" id="login-error" class="login-error" :title="loginError" type="error" :closable="false" show-icon />
          <el-button type="primary" size="large" native-type="submit" :loading="loggingIn" :disabled="!password">登录</el-button>
        </form>
      </div>
    </main>

    <div v-else class="app-layout">
      <a class="skip-link" href="#workspace">跳转到主内容</a>
      <header class="app-header">
        <div class="header-inner">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true"><el-icon><Box /></el-icon></span>
            <div><div class="brand-title">DockerCFG Manager</div><div class="brand-sub">Compose 工作台</div></div>
          </div>
          <div class="rail-section">工作区</div>
          <nav class="app-nav" aria-label="工作区导航">
            <router-link
              class="rail-current"
              :class="{ 'is-current': route.name === 'projects' }"
              :to="{ name: 'projects' }"
            >
              <el-icon aria-hidden="true"><Grid /></el-icon><span>Compose 项目</span>
            </router-link>
          </nav>
          <div class="header-actions">
            <div class="connection" :class="store.overview?.dockerOk ? 'connected' : store.overview ? 'offline' : ''" role="status">
              <el-icon class="connection-icon" aria-hidden="true"><Connection /></el-icon>
              <div><span class="connection-title">Docker 引擎</span><span class="connection-state"><span class="status-dot" aria-hidden="true"></span>
                {{ store.overview?.dockerOk ? '已连接' : store.overview ? '未连接' : '检查中' }}</span></div>
            </div>
            <el-button class="logout-button" :icon="SwitchButton" :loading="loggingOut" aria-label="退出登录" @click="doLogout"><span>退出登录</span></el-button>
          </div>
        </div>
      </header>

      <main id="workspace" ref="main" class="app-main" tabindex="-1">
        <router-view />
      </main>
    </div>
  </el-config-provider>
</template>
