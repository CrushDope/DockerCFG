<script setup>
/**
 * compose 可视化编辑器（工作台布局）。
 *
 * 布局：左「服务栏」 → 中「分组导航」 → 右「表单区」，
 *      顶部为全局工具条（视图切换 / 字段搜索 / 仅显示已配置），底部为吸底保存栏。
 *
 * 字段名在页面上显示中文，保存时按 schema 映射回 compose 的英文键名。
 * 未被改动的字段保持原始值（含对象形态与数字类型），不会因为打开表单再保存就改写文件。
 */
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Box, Connection, Cpu, Delete, FolderOpened, Link, Lock, Odometer,
  Plus, Refresh, Search, Setting, Tickets,
} from '@element-plus/icons-vue';
import { SERVICE_FIELDS, SERVICE_GROUPS, STRUCT_DEFS, TOP_FIELDS, TOP_RESOURCE_DEFS, fieldsOfGroup } from '../composeSchema';
import { deepClone, toRows, rowsEqual, mappingsEqual, editorEqual } from '../composeFields';
import {
  loadServiceModel, buildCompose,
  envDirty, envEqual, collectRefUpdates, stable,
} from '../composeBuild';
import FieldLabel from './FieldLabel.vue';
import SchemaField from './SchemaField.vue';
import StructEditor from './StructEditor.vue';
import TopResourceEditor from './TopResourceEditor.vue';
import EnvEditor from './EnvEditor.vue';

const props = defineProps({
  project: { type: Object, required: true },
  busy: Boolean,
  saveConfig: { type: Function, required: true },
  containers: { type: Array, default: () => [] },
});
const emit = defineEmits(['reload']);

// 后端返回的 compose 是 map[string]any，序列化时键会被按字母排序，
// 直接用它会打乱用户手写的字段顺序。这里自行解析原始 YAML 以保留顺序。
const doc = ref({});
const compose = computed(() => doc.value || {});

let yamlLib = null;
async function ensureYaml() {
  if (!yamlLib) yamlLib = (await import('yaml')).default;
  return yamlLib;
}

// ---------------- 状态 ----------------
const view = ref('services'); // services | top
const activeIndex = ref(0);
const activeGroup = ref('basic');
const services = ref([]);
const saving = ref(false);
const ready = ref(false);
const svcQuery = ref('');
const fieldQuery = ref('');
const onlySet = ref(false);
let baseline = '';
const isDirty = () => ready.value && baseline !== snapshot();
defineExpose({ isDirty });

function snapshot() {
  return JSON.stringify([services.value, topName.value, topResources.value]);
}

// 顶层
const topName = ref('');
const topExtras = ref({});
const topResources = ref({ networks: [], volumes: [], configs: [], secrets: [] });
const topOrigResources = ref({});

// 分组图标（按分组 id 映射）
const GROUP_ICONS = {
  basic: Box,
  network: Connection,
  storage: FolderOpened,
  env: Tickets,
  deps: Link,
  build: Cpu,
  health: Odometer,
  system: Lock,
};
const TOP_ICONS = { networks: Connection, volumes: FolderOpened, configs: Setting, secrets: Lock };

// ---------------- 载入 ----------------
let loadToken = 0;
async function load() {
  const token = ++loadToken;
  ready.value = false;
  let YAML;
  try { YAML = await ensureYaml(); } catch {
    ElMessage.error('无法加载表单编辑器，请刷新页面后重试。');
    return;
  }
  if (token !== loadToken) return; // 丢弃过期结果

  // 优先用本地解析的原始 YAML（保留字段顺序），失败时回退后端解析结果
  let parsed = props.project.compose || {};
  if (props.project.composeRaw) {
    try {
      const r = YAML.parse(props.project.composeRaw);
      if (r && typeof r === 'object') parsed = r;
    } catch {
      /* 解析失败由后端的 parseError 提示，这里回退即可 */
    }
  }
  doc.value = parsed;

  const rawServices = parsed.services || {};
  const parsedSvcs = props.project.services || [];
  services.value = Object.entries(rawServices).map(([name, cfg]) => {
    const p = parsedSvcs.find((x) => x.name === name);
    return loadServiceModel(name, cfg, p ? p.environment || [] : []);
  });
  if (activeIndex.value >= services.value.length) activeIndex.value = 0;
  loadTop();
  baseline = snapshot();
  ready.value = true;
}

function attrsToEditor(attrs, def) {
  const obj = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {};
  const out = {};
  for (const f of def.fields) {
    const raw = obj[f.key];
    if (f.type === 'kv') out[f.key] = toRows(raw, 'kv');
    else if (f.type === 'switch') out[f.key] = raw === true;
    else out[f.key] = raw === undefined || raw === null ? '' : String(raw);
  }
  return out;
}

function resourceToEntries(v, def) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => ({ name: String(x), __attrs: {} }));
  return Object.entries(v).map(([name, attrs]) => ({
    name,
    __attrs: attrsToEditor(attrs, def),
  }));
}

function loadTop() {
  const c = compose.value || {};
  topName.value = c.name || '';
  const extras = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === 'services' || k === 'name') continue;
    if (TOP_RESOURCE_DEFS[k]) continue;
    extras[k] = v;
  }
  topExtras.value = extras;
  for (const key of Object.keys(TOP_RESOURCE_DEFS)) {
    topResources.value[key] = resourceToEntries(c[key], TOP_RESOURCE_DEFS[key]);
    topOrigResources.value[key] = deepClone(c[key]);
  }
}

watch(() => props.project, load, { immediate: true, deep: false });

// ---------------- 当前服务 ----------------
const current = computed(() => services.value[activeIndex.value] || null);

function selectService(i) {
  activeIndex.value = i;
  activeGroup.value = 'basic';
}

function addService() {
  const used = new Set(services.value.map((s) => s.name));
  let n = services.value.length + 1;
  while (used.has(`service${n}`)) n++;
  services.value.push(loadServiceModel(`service${n}`, {}));
  activeIndex.value = services.value.length - 1;
  activeGroup.value = 'basic';
}

function removeService(i) {
  services.value.splice(i, 1);
  if (i < activeIndex.value) activeIndex.value--;
  if (activeIndex.value >= services.value.length) activeIndex.value = Math.max(0, services.value.length - 1);
}

async function saveAll() {
  if (!isDirty() || saving.value || props.busy) return;
  if (!services.value.length || services.value.some((svc) => !/^[a-zA-Z0-9_.-]+$/.test(svc.name.trim()))) {
    ElMessage.warning('至少保留一个服务；服务名只可包含字母、数字、点、下划线和短横线。');
    return;
  }
  const { compose: built, dupes } = buildCompose({
    services: services.value, topExtras: topExtras.value, topName: topName.value,
    topResources: topResources.value, topOrigResources: topOrigResources.value, topResourceDefs: TOP_RESOURCE_DEFS,
  });
  if (dupes.length) {
    ElMessage.warning(`服务名「${dupes.join('、')}」重复，请修改后再保存。`);
    return;
  }
  saving.value = true;
  try {
    if (services.value.some((svc) => svc.environment.some((item) => item.isRef && !item.key.trim()))) {
      throw new Error('请填写引用型变量的变量名。');
    }
    const updates = collectRefUpdates(services.value);
    const YAML = await ensureYaml();
    const content = stable(built) === stable(compose.value) ? props.project.composeRaw
      : YAML.stringify(built, { lineWidth: 0, sortMapEntries: false });
    await props.saveConfig(content, updates);
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally { saving.value = false; }
}

// ---------------- 展示辅助 ----------------
/** 字段是否已有取值 */
function fieldSet(f, svc) {
  if (!svc) return false;
  const v = svc[f.key];
  if (f.type === 'mapping' || f.type === 'list' || f.type === 'kv') return Array.isArray(v) && v.length > 0;
  if (f.type === 'struct') {
    return Object.values(v || {}).some((x) => {
      if (x === undefined || x === null || x === false || x === '') return false;
      if (Array.isArray(x)) return x.length > 0;
      return true;
    });
  }
  if (f.type === 'switch') return v === true;
  return String(v ?? '').trim() !== '';
}

function groupBadge(gid) {
  const svc = current.value;
  if (!svc) return 0;
  if (gid === 'env') return (svc.environment || []).length;
  return fieldsOfGroup(gid).filter((f) => fieldSet(f, svc)).length;
}

function groupTotal(gid) {
  if (gid === 'env') return (current.value?.environment || []).length;
  return fieldsOfGroup(gid).length;
}

/** 单个服务是否有未保存改动 */
function serviceDirty(svc) {
  if (!svc) return false;
  for (const f of SERVICE_FIELDS) {
    if (f.type === 'mapping') {
      if (!mappingsEqual(svc[f.key], svc.origRows[f.key])) return true;
    } else if (f.type === 'list' || f.type === 'kv') {
      if (!rowsEqual(svc[f.key], svc.origRows[f.key])) return true;
    } else if (f.type === 'struct') {
      if (!editorEqual(svc[f.key], svc.origStruct[f.key])) return true;
    } else if (f.type === 'switch') {
      if (svc[f.key] !== (svc.raw?.[f.key] === true)) return true;
    } else {
      const orig = svc.raw?.[f.key];
      const now = String(svc[f.key] ?? '').trim();
      const was = orig === undefined || orig === null ? '' : String(orig);
      if (now !== was) return true;
    }
  }
  return !envEqual(svc.environment, svc.origEnvironment);
}

/** 容器运行状态 → 圆点色调 */
function svcTone(name) {
  const list = props.containers.filter((c) => c.service === name);
  if (!list.length) return 'idle';
  return list.some((c) => c.state === 'running') ? 'running' : 'stopped';
}

// ---------------- 过滤与导航 ----------------
const filteredServices = computed(() => {
  const term = svcQuery.value.trim().toLowerCase();
  return services.value
    .map((svc, index) => ({ svc, index }))
    .filter(({ svc }) => !term || [svc.name, svc.image].some((v) => String(v || '').toLowerCase().includes(term)));
});

const activeGroupDef = computed(() => SERVICE_GROUPS.find((g) => g.id === activeGroup.value) || SERVICE_GROUPS[0]);

function matchField(f) {
  const term = fieldQuery.value.trim().toLowerCase();
  if (term) {
    const hay = `${f.label} ${f.key} ${f.help || ''}`.toLowerCase();
    if (!hay.includes(term)) return false;
  }
  if (onlySet.value && !fieldSet(f, current.value)) return false;
  return true;
}

/** 分组内的可见字段 */
function visibleFields(gid) {
  return fieldsOfGroup(gid).filter(matchField);
}

/** 有可见字段的分组（无筛选条件时全部显示） */
const visibleGroups = computed(() => {
  const filtering = !!fieldQuery.value.trim() || onlySet.value;
  if (!filtering) return SERVICE_GROUPS;
  return SERVICE_GROUPS.filter((g) => {
    if (g.id === 'env') {
      if (onlySet.value) {
        const hasVars = (current.value?.environment || []).length > 0;
        const hasField = fieldsOfGroup(g.id).some((f) => fieldSet(f, current.value));
        if (!hasVars && !hasField) return false;
      }
      if (fieldQuery.value.trim()) {
        const term = fieldQuery.value.trim().toLowerCase();
        const hit = fieldsOfGroup(g.id).some(matchField);
        return hit || '环境变量 env'.toLowerCase().includes(term) || 'env'.includes(term);
      }
      return true;
    }
    return visibleFields(g.id).length > 0;
  });
});

// 搜索时自动切到第一个有命中的分组
watch([fieldQuery, onlySet], () => {
  if (!visibleGroups.value.length) return;
  if (!visibleGroups.value.some((g) => g.id === activeGroup.value)) {
    activeGroup.value = visibleGroups.value[0].id;
  }
});
</script>

<template>
  <div class="ce" v-loading="saving || !ready">
    <!-- ============ 工具条 ============ -->
    <div class="ce-toolbar">
      <el-radio-group v-model="view" size="small" class="ce-seg">
        <el-radio-button value="services"><el-icon aria-hidden="true"><Box /></el-icon><span>服务配置</span></el-radio-button>
        <el-radio-button value="top"><el-icon aria-hidden="true"><Setting /></el-icon><span>顶层配置</span></el-radio-button>
      </el-radio-group>

      <div class="ce-tools">
        <el-input
          v-model="fieldQuery"
          :prefix-icon="Search"
          size="small"
          class="ce-search"
          placeholder="搜索字段名或英文键"
          aria-label="搜索字段"
          clearable
        />
        <el-checkbox v-model="onlySet" size="small">仅显示已配置</el-checkbox>
        <el-button :icon="Refresh" size="small" text :disabled="props.busy" @click="emit('reload')">重新载入</el-button>
      </div>
    </div>

    <!-- ============ 服务配置 ============ -->
    <div v-if="view === 'services'" class="ce-body">
      <!-- 左：服务栏 -->
      <aside class="ce-rail" aria-label="服务列表">
        <div class="ce-rail-head">
          <el-input
            v-model="svcQuery"
            :prefix-icon="Search"
            size="small"
            placeholder="筛选服务"
            aria-label="筛选服务"
            clearable
          />
        </div>

        <ul class="ce-rail-list">
          <li
            v-for="item in filteredServices"
            :key="item.index"
            class="ce-svc-item"
            :class="{ active: item.index === activeIndex }"
          >
            <button
              type="button"
              class="ce-svc"
              :aria-current="item.index === activeIndex ? 'true' : undefined"
              @click="selectService(item.index)"
            >
              <span class="ce-svc-dot" :class="svcTone(item.svc.name)" aria-hidden="true"></span>
              <span class="ce-svc-text">
                <span class="ce-svc-title">{{ item.svc.name || '(未命名)' }}</span>
                <span class="ce-svc-image">{{ item.svc.image || '未指定镜像' }}</span>
              </span>
              <span v-if="serviceDirty(item.svc)" class="ce-svc-dirty" title="有未保存的修改" aria-label="有未保存的修改"></span>
            </button>
            <el-button
              :aria-label="`移除服务 ${item.svc.name}`"
              :icon="Delete"
              size="small"
              text
              type="danger"
              @click.stop="removeService(item.index)"
            />
          </li>
        </ul>

        <div v-if="!filteredServices.length" class="ce-rail-empty">
          {{ services.length ? '没有匹配的服务' : '还没有服务' }}
        </div>

        <button type="button" class="ce-rail-add" @click="addService">
          <el-icon aria-hidden="true"><Plus /></el-icon><span>新增服务</span>
        </button>
      </aside>

      <!-- 中：分组导航 -->
      <nav class="ce-nav" aria-label="配置分组">
        <button
          v-for="g in visibleGroups"
          :key="g.id"
          type="button"
          class="ce-nav-item"
          :class="{ active: g.id === activeGroup }"
          :aria-current="g.id === activeGroup ? 'true' : undefined"
          @click="activeGroup = g.id"
        >
          <el-icon class="ce-nav-icon" aria-hidden="true"><component :is="GROUP_ICONS[g.id]" /></el-icon>
          <span class="ce-nav-label">{{ g.label }}</span>
          <span class="ce-nav-count" :class="{ zero: !groupBadge(g.id) }">{{ groupBadge(g.id) }}</span>
        </button>
      </nav>

      <!-- 右：表单区 -->
      <section class="ce-form">
        <template v-if="current">
          <header class="ce-form-head">
            <div class="ce-form-title">
              <h3>{{ activeGroupDef.label }}</h3>
              <p>{{ activeGroupDef.desc }}</p>
            </div>
            <span class="ce-form-meta">
              <span class="ce-form-count">已配置 {{ groupBadge(activeGroup) }} / {{ groupTotal(activeGroup) }}</span>
              <code class="ce-form-key">{{ activeGroupDef.id }}</code>
            </span>
          </header>

          <div class="ce-rows">
            <template v-for="f in visibleFields(activeGroup)" :key="f.key">
              <div class="ce-row" :class="{ 'is-set': fieldSet(f, current) }">
                <div class="ce-row-label">
                  <FieldLabel :label="f.label" :key-name="f.key" :set="fieldSet(f, current)" />
                </div>
                <div class="ce-row-control">
                  <StructEditor
                    v-if="f.type === 'struct'"
                    :def="STRUCT_DEFS[f.struct]"
                    :model-value="current[f.key]"
                    @update:model-value="(v) => (current[f.key] = v)"
                  />
                  <SchemaField
                    v-else
                    :field="f"
                    :model-value="current[f.key]"
                    @update:model-value="(v) => (current[f.key] = v)"
                  />
                  <p v-if="f.help" class="ce-row-help">{{ f.help }}</p>
                </div>
              </div>
            </template>

            <!-- 环境变量表：整组独占 -->
            <div
              v-if="activeGroup === 'env' && (!fieldQuery.trim() || visibleFields('env').length)"
              class="ce-env-block"
            >
              <EnvEditor v-model="current.environment" />
            </div>

            <div v-if="!visibleFields(activeGroup).length && activeGroup !== 'env'" class="ce-empty">
              {{ fieldQuery.trim() || onlySet ? '没有符合筛选条件的字段' : '该分组暂无可编辑字段' }}
            </div>
          </div>

          <footer class="ce-form-foot">
            <div class="ce-svc-ident">
              <span class="ce-svc-ident-label">正在编辑服务</span>
              <el-input
                v-model="current.name"
                class="ce-svc-name-field"
                id="compose-service-name"
                aria-label="服务名"
                placeholder="服务名，例如 web"
              />
              <code class="ce-svc-img-tag mono">{{ current.image || '未指定镜像' }}</code>
              <span v-if="envDirty(current)" class="ce-dirty">环境变量有未保存改动</span>
            </div>
            <el-button type="danger" plain size="small" :icon="Delete" @click="removeService(activeIndex)">
              删除服务
            </el-button>
          </footer>
        </template>

        <div v-else class="ce-empty ce-empty-lg">请在左侧选择或新增一个服务</div>
      </section>
    </div>

    <!-- ============ 顶层配置 ============ -->
    <div v-else class="ce-top">
      <section class="ce-card">
        <header class="ce-card-head">
          <div class="ce-card-title">
            <h3><el-icon aria-hidden="true"><Setting /></el-icon>基本信息</h3>
            <p>compose 顶层不属于任何服务的配置</p>
          </div>
        </header>
        <div class="ce-rows">
          <div v-for="f in TOP_FIELDS" :key="f.key" class="ce-row">
            <div class="ce-row-label">
              <FieldLabel :label="f.label" :key-name="f.key" :set="!!topName" />
            </div>
            <div class="ce-row-control">
              <SchemaField :field="f" :model-value="topName" @update:model-value="(v) => (topName = v)" />
            </div>
          </div>
        </div>
      </section>

      <section v-for="(def, key) in TOP_RESOURCE_DEFS" :key="key" class="ce-card">
        <header class="ce-card-head">
          <div class="ce-card-title">
            <h3><el-icon aria-hidden="true"><component :is="TOP_ICONS[key]" /></el-icon>{{ def.label }}</h3>
            <p>{{ def.desc }}</p>
          </div>
          <span class="ce-form-count">{{ (topResources[key] || []).length }} 项</span>
        </header>
        <div class="ce-card-body">
          <TopResourceEditor
            :def="def"
            :model-value="topResources[key]"
            @update:model-value="(v) => (topResources[key] = v)"
          />
        </div>
      </section>
    </div>

    <!-- ============ 吸底保存栏 ============ -->
    <div class="ce-savebar">
      <span class="ce-save-status" :class="{ dirty: isDirty() }" role="status">
        <span class="status-dot" aria-hidden="true"></span>
        <span v-if="isDirty()">有未保存的修改<span class="ce-save-note">引用型变量的值将同步写入 .env</span></span>
        <span v-else>所有配置均已保存</span>
      </span>
      <el-button type="primary" :loading="saving" :disabled="!isDirty() || busy" @click="saveAll">
        保存全部配置
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.ce { min-width: 0; }

/* ---------- 工具条 ---------- */
.ce-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3) var(--sp-4);
  flex-wrap: wrap;
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
}
.ce-seg :deep(.el-radio-button__inner) { display: inline-flex; align-items: center; gap: 6px; }
.ce-tools { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.ce-search { width: 230px; }

/* ---------- 三栏骨架 ---------- */
.ce-body {
  display: grid;
  grid-template-columns: 236px 186px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

/* ---------- 左：服务栏 ---------- */
.ce-rail {
  position: sticky;
  /* 让开吸顶的应用顶栏 */
  top: 74px;
  display: grid;
  /* 显式声明单列轨道：避免隐式 auto 轨道按 max-content 撑破容器 */
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
  max-height: calc(100vh - 150px);
  overflow-y: auto;
  overflow-x: hidden;
}
.ce-rail-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; min-width: 0; }
.ce-svc-item {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 2px 4px 2px 6px;
  transition: background var(--transition), border-color var(--transition);
}
.ce-svc-item:hover { background: var(--surface-2); }
.ce-svc-item.active { background: var(--accent-soft); border-color: var(--accent-edge); }
.ce-svc {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 4px;
  border: 0;
  background: none;
  text-align: left;
  color: inherit;
}
.ce-svc-dot {
  width: 8px; height: 8px; flex: 0 0 8px;
  border-radius: 50%;
  background: var(--faint);
  box-shadow: 0 0 0 3px rgb(148 163 184 / 0.15);
}
.ce-svc-dot.running { background: var(--ok-600); box-shadow: 0 0 0 3px rgb(4 120 87 / 0.15); }
.ce-svc-dot.stopped { background: var(--ink-300); }
.ce-svc-text { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; }
.ce-svc-title {
  display: block;
  min-width: 0;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ce-svc-image {
  display: block;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ce-svc-dirty {
  width: 6px; height: 6px; flex: 0 0 6px;
  border-radius: 50%;
  background: var(--warn-600);
}
.ce-svc-item :deep(.el-button) {
  flex: 0 0 26px;
  width: 26px;
  min-width: 26px;
  height: 26px;
  padding: 0;
}
.ce-rail-empty {
  padding: 14px 8px;
  text-align: center;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.ce-rail-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 7px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}
.ce-rail-add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.ce-rail-add:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }

/* ---------- 中：分组导航 ---------- */
.ce-nav {
  position: sticky;
  /* 让开吸顶的应用顶栏 */
  top: 74px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  align-content: start;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
}
.ce-nav-item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}
.ce-nav-item:hover { background: var(--surface-2); color: var(--ink); }
.ce-nav-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-edge);
  color: var(--brand-700);
}
.ce-nav-icon { font-size: 15px; }
.ce-nav-label { font-size: var(--fs-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ce-nav-item.active .ce-nav-label { font-weight: 700; }
.ce-nav-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-500);
  font-size: var(--fs-xs);
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.ce-nav-count.zero { color: var(--ink-300); background: transparent; }
.ce-nav-item.active .ce-nav-count { background: var(--surface); color: var(--brand-700); }

/* ---------- 右：表单区 ---------- */
.ce-form {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.ce-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: 13px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-soft);
}
.ce-form-title h3 { margin: 0; font-size: var(--fs-md); font-weight: 700; color: var(--ink); letter-spacing: 0; }
.ce-form-title p { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--muted); }
.ce-form-meta { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.ce-form-count {
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--ink-500);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ce-form-key { color: var(--muted); font-size: var(--fs-xs); }

.ce-rows { display: grid; }
.ce-row {
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr);
  gap: var(--sp-4);
  align-items: start;
  padding: 13px 18px;
  border-bottom: 1px solid var(--border-soft);
}
.ce-row:last-child { border-bottom: none; }
.ce-row:hover { background: #fcfdfe; }
.ce-row-label { padding-top: 3px; min-width: 0; }
.ce-row-control { min-width: 0; display: grid; gap: 6px; }
.ce-row-help { margin: 0; font-size: var(--fs-sm); color: var(--muted); line-height: 1.5; }

.ce-env-block { padding: 16px 18px; border-bottom: 1px solid var(--border-soft); }

.ce-empty {
  padding: 40px 18px;
  text-align: center;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.ce-empty-lg { padding: 72px 18px; font-size: var(--fs-base); }

.ce-form-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
  padding: 12px 18px;
  background: var(--surface-2);
  border-top: 1px solid var(--border-soft);
}
.ce-svc-ident { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.ce-svc-ident-label { font-size: var(--fs-sm); color: var(--muted); font-weight: 600; }
.ce-svc-name-field { width: 190px; }
.ce-svc-img-tag {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 9px;
  border-radius: var(--radius-xs);
  background: var(--surface-3);
  color: var(--ink-500);
  font-size: var(--fs-xs);
}
.ce-dirty {
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  background: var(--warn-50);
  border: 1px solid var(--warn-100);
  color: var(--warn-700);
  font-size: var(--fs-xs);
  font-weight: 600;
}

/* ---------- 顶层配置 ---------- */
.ce-top { display: grid; gap: 14px; }
.ce-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.ce-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: 13px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-soft);
}
.ce-card-title h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--ink);
}
.ce-card-title p { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--muted); }
.ce-card-body { padding: 14px 18px; }

/* ---------- 吸底保存栏 ---------- */
.ce-savebar {
  position: sticky;
  bottom: 12px;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
  margin-top: 18px;
  padding: 11px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  /* 不使用 backdrop-filter：它会强制合成图层，文字被降级为灰度抗锯齿后发虚 */
  background: rgb(255 255 255 / 0.98);
  box-shadow: var(--shadow-md);
}
.ce-save-status { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--muted); }
.ce-save-status .status-dot { color: var(--ok-600); }
.ce-save-status.dirty .status-dot { color: var(--warn-600); }
.ce-save-status.dirty { color: var(--ink); font-weight: 600; }
.ce-save-note { margin-left: 10px; color: var(--muted); font-weight: 400; }
.ce-savebar :deep(.el-button) { min-height: 40px; }

/* ---------- 响应式 ---------- */
@media (max-width: 1240px) {
  /* 分组导航上移为横向滚动条，表单区占据第二列 */
  .ce-body { grid-template-columns: 210px minmax(0, 1fr); }
  .ce-nav {
    grid-column: 1 / -1;
    grid-row: 1;
    position: static;
    /* 横向排列时取消显式单列，改用隐式 max-content 列 */
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    justify-content: start;
    overflow-x: auto;
    gap: 4px;
    scrollbar-width: thin;
  }
  .ce-nav-item { grid-template-columns: 18px auto auto; }
  .ce-rail { grid-column: 1; grid-row: 2; }
  .ce-form { grid-column: 2; grid-row: 2; }
}

@media (max-width: 900px) {
  /* 单列堆叠：导航 → 服务 → 表单 */
  .ce-body { grid-template-columns: minmax(0, 1fr); }
  .ce-nav { grid-column: 1; grid-row: 1; }
  .ce-rail { grid-column: 1; grid-row: 2; position: static; max-height: 260px; }
  .ce-form { grid-column: 1; grid-row: 3; }
  .ce-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .ce-row-label { padding-top: 0; }
  .ce-savebar :deep(.el-button) { width: 100%; }
  .ce-save-status { width: 100%; }
}
</style>
