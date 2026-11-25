/**
 * 全局共享状态。
 *
 * 项目概览（overview）同时被顶栏与项目列表页使用，
 * 放在这里避免在路由视图之间层层透传。
 */
import { reactive } from 'vue';
import { api } from './api';

export const store = reactive({
  overview: null,
  overviewError: '',
  refreshing: false,
  /** 会话版本号：退出登录后自增，用于丢弃仍在途中的旧请求结果 */
  session: 0,
});

export async function loadOverview() {
  if (store.refreshing) return;
  const version = store.session;
  store.refreshing = true;
  store.overviewError = '';
  try {
    const result = await api.overview();
    if (version === store.session) store.overview = result;
  } catch (e) {
    if (version === store.session) store.overviewError = e.message;
  } finally {
    if (version === store.session) store.refreshing = false;
  }
}

export function resetStore() {
  store.session++;
  store.overview = null;
  store.overviewError = '';
  store.refreshing = false;
}
