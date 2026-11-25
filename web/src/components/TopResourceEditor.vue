<script setup>
/**
 * 顶层资源编辑器：维护 compose 顶层的 networks / volumes / configs / secrets。
 * 每项 = 名称 + 若干属性，保存时还原成 compose 的对象写法。
 */
import { computed } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import FieldLabel from './FieldLabel.vue';
import SchemaField from './SchemaField.vue';
import RowsEditor from './RowsEditor.vue';

const props = defineProps({
  def: { type: Object, required: true },
  modelValue: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);

const fields = computed(() => props.def.fields || []);

function setEntry(i, patch) {
  const next = props.modelValue.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
  emit('update:modelValue', next);
}
function add() {
  emit('update:modelValue', [...props.modelValue, { name: '', __attrs: {} }]);
}
function remove(i) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i));
}
function setAttr(i, key, value) {
  const entry = props.modelValue[i] || {};
  setEntry(i, { __attrs: { ...(entry.__attrs || {}), [key]: value } });
}
function attrSet(entry, key) {
  const v = entry.__attrs ? entry.__attrs[key] : undefined;
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return String(v).trim() !== '';
}
</script>

<template>
  <div class="res-editor">
    <div v-if="!modelValue.length" class="res-empty">
      <span class="res-empty-text">尚未声明{{ def.label }}</span>
      <button type="button" class="res-add" @click="add">
        <el-icon aria-hidden="true"><Plus /></el-icon><span>添加{{ def.label }}</span>
      </button>
    </div>

    <div v-for="(entry, i) in modelValue" :key="i" class="res-item">
      <div class="res-item-head">
        <el-input
          :model-value="entry.name"
          :placeholder="`${def.label}名称`"
          size="small"
          class="res-name"
          @update:model-value="(v) => setEntry(i, { name: v })"
        />
        <el-button
          :icon="Delete" size="small" text type="danger"
          :aria-label="`删除 ${entry.name || def.label}`" @click="remove(i)"
        />
      </div>

      <div class="res-attrs">
        <div v-for="f in fields" :key="f.key" class="res-attr">
          <FieldLabel :label="f.label" :key-name="f.key" :set="attrSet(entry, f.key)" />

          <RowsEditor
            v-if="f.type === 'kv'"
            :model-value="(entry.__attrs && entry.__attrs[f.key]) || []"
            kind="kv"
            key-placeholder="名称"
            value-placeholder="取值"
            add-text="添加"
            @update:model-value="(v) => setAttr(i, f.key, v)"
          />
          <SchemaField
            v-else
            :field="f"
            :model-value="entry.__attrs ? entry.__attrs[f.key] : undefined"
            @update:model-value="(v) => setAttr(i, f.key, v)"
          />
        </div>
      </div>
    </div>

    <button v-if="modelValue.length" type="button" class="res-add res-add-full" @click="add">
      <el-icon aria-hidden="true"><Plus /></el-icon><span>添加{{ def.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.res-editor { display: grid; gap: 10px; }
.res-item {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  background: var(--surface-2);
}
.res-item-head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--border);
}
.res-name { max-width: 280px; font-weight: 600; }
.res-attrs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px 20px;
}
.res-attr { min-width: 0; display: grid; gap: 6px; align-content: start; }

.res-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  padding: 14px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.res-empty-text { font-size: var(--fs-sm); color: var(--muted); }
.res-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}
.res-add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.res-add:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.res-add-full { width: 100%; justify-content: center; }
</style>
