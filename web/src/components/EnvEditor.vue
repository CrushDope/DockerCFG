<script setup>
/**
 * 环境变量编辑器。
 *
 * 核心规则：
 *  - compose 中写 ${VAR} 的变量 → 表格里显示 .env 中的真实值，
 *    标记为「引用 .env」，保存时值写入 .env 文件，compose 中保持占位符。
 *  - compose 中写死的字面量 → 标记为「内联」，保存时值写入 compose 文件。
 *  - 用户可切换来源：在两者之间移动，切换后值随之转移。
 */
import { ref, watch } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);

const rows = ref([]);

watch(
  () => props.modelValue,
  (v) => {
    rows.value = (v || []).map((e) => ({ ...e }));
  },
  { immediate: true }
);

function addRow() {
  rows.value.push({ key: '', value: '', isRef: false, raw: '', hasDefault: false, default: '' });
  emit('update:modelValue', rows.value);
}
function removeRow(i) {
  rows.value.splice(i, 1);
  emit('update:modelValue', rows.value);
}
function update(i, patch) {
  rows.value[i] = { ...rows.value[i], ...patch };
  emit('update:modelValue', rows.value);
}

/** 切换来源：引用 ↔ 内联 */
function toggleSource(i, toRef) {
  const r = rows.value[i];
  if (toRef) {
    update(i, { isRef: true, raw: r.hasDefault ? `\${${r.key}:-${r.default}}` : `\${${r.key}}` });
  } else {
    update(i, { isRef: false, refKey: '', raw: r.value });
  }
}

/**
 * 生成 compose 中的引用写法，例如 ${TMDB_API_KEY}。
 * 放在脚本里拼装，模板中只做插值——Vue 模板不解析 ${...}，
 * 直接写在模板里会被当成纯文本输出。
 */
function refExpr(r) {
  return '${' + (r.refKey || r.key) + '}';
}
</script>

<template>
  <div class="env-editor">
    <div class="env-legend">
      <span class="env-legend-item"><i class="env-swatch env-swatch-ref"></i>引用 .env —— 值写入 .env 文件，compose 中保持 <code>${VAR}</code></span>
      <span class="env-legend-item"><i class="env-swatch env-swatch-inline"></i>内联 —— 值直接写入 compose 文件</span>
    </div>

    <div class="env-table">
      <div class="env-tr env-head">
        <span class="env-td">变量名</span>
        <span class="env-td">值</span>
        <span class="env-td env-td-source">来源</span>
        <span class="env-td env-td-act">操作</span>
      </div>

      <div v-for="(r, i) in rows" :key="i" class="env-tr">
        <span class="env-td">
          <el-input
            :model-value="r.key"
            placeholder="KEY" aria-label="环境变量名"
            size="small"
            class="mono"
            @update:model-value="(v) => update(i, { key: v })"
          />
        </span>
        <span class="env-td">
          <el-input
            :model-value="r.value" aria-label="环境变量值"
            :placeholder="r.isRef ? '来自 .env 的真实值' : '直接写入 compose 的值'"
            size="small"
            @update:model-value="(v) => update(i, { value: v })"
          />
          <code v-if="r.isRef && r.key" class="env-raw">compose 中写作 {{ refExpr(r) }}</code>
        </span>
        <span class="env-td env-td-source">
          <div class="env-source" role="group" :aria-label="`第 ${i + 1} 个变量的来源`">
            <button
              type="button" class="env-source-btn" :class="{ on: r.isRef }"
              :aria-pressed="r.isRef" @click="toggleSource(i, true)"
            >.env</button>
            <button
              type="button" class="env-source-btn" :class="{ on: !r.isRef }"
              :aria-pressed="!r.isRef" @click="toggleSource(i, false)"
            >内联</button>
          </div>
        </span>
        <span class="env-td env-td-act">
          <el-button
            :icon="Delete" aria-label="移除环境变量" size="small" text type="danger"
            @click="removeRow(i)"
          />
        </span>
      </div>

      <div v-if="!rows.length" class="env-empty">
        该服务暂无环境变量，可从下方添加。
      </div>
    </div>

    <div class="env-foot">
      <button type="button" class="env-add" @click="addRow">
        <el-icon aria-hidden="true"><Plus /></el-icon><span>添加变量</span>
      </button>
      <span class="env-count">共 {{ rows.length }} 个变量</span>
    </div>
  </div>
</template>

<style scoped>
.env-editor { display: grid; gap: 12px; }

.env-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.env-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.env-legend code { color: var(--ink); font-size: var(--fs-xs); }
.env-swatch { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 9px; }
.env-swatch-ref { background: var(--ok-600); }
.env-swatch-inline { background: var(--brand-500); }

.env-table {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}
.env-tr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 132px 44px;
  align-items: start;
  border-bottom: 1px solid var(--border-soft);
}
.env-tr:last-child { border-bottom: none; }
.env-head {
  background: var(--surface-3);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.env-td { padding: 8px 10px; min-width: 0; display: block; }
.env-head .env-td { padding: 8px 10px; }
.env-td-source { display: flex; justify-content: center; padding-top: 9px; }
.env-td-act { display: flex; justify-content: center; padding-top: 6px; }
.env-raw {
  display: block;
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--ink-300);
  overflow-wrap: anywhere;
}

.env-source {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  border: 1px solid var(--border);
}
.env-source-btn {
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 3px 9px;
  transition: background var(--transition), color var(--transition);
}
.env-source-btn:hover { color: var(--ink); }
.env-source-btn.on {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-xs);
}
.env-source-btn:first-child.on { color: var(--ok-700); }
.env-source-btn:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 1px; }

.env-empty {
  padding: 22px 14px;
  text-align: center;
  color: var(--muted);
  font-size: var(--fs-sm);
  background: var(--surface-2);
}

.env-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.env-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}
.env-add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.env-add:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.env-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }

@media (max-width: 720px) {
  .env-head { display: none; }
  .env-tr { grid-template-columns: minmax(0, 1fr) 44px; padding: 4px; }
  .env-td { padding: 6px; }
  .env-td:nth-child(-n+2) { grid-column: 1 / -1; }
  .env-td-source { justify-content: flex-start; padding-top: 4px; }
}
</style>
