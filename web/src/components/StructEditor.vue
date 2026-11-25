<script setup>
/**
 * 结构化子表单：把 build / healthcheck / deploy / logging / ulimits
 * 这类嵌套对象展开成可填写的表单项，不再需要手写 JSON。
 */
import FieldLabel from './FieldLabel.vue';
import SchemaField from './SchemaField.vue';
import RowsEditor from './RowsEditor.vue';

const props = defineProps({
  def: { type: Object, required: true },
  modelValue: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);

function set(key, value) {
  emit('update:modelValue', { ...(props.modelValue || {}), [key]: value });
}

/** 子字段是否已有取值（用于「已配置」状态点） */
function isSet(f) {
  const v = props.modelValue ? props.modelValue[f.key] : undefined;
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return String(v).trim() !== '';
}
</script>

<template>
  <div class="struct-editor">
    <div v-for="f in def.fields" :key="f.key" class="struct-field">
      <FieldLabel :label="f.label" :key-name="f.path || f.key" :set="isSet(f)" />

      <RowsEditor
        v-if="f.type === 'kv'"
        :model-value="(modelValue && modelValue[f.key]) || []"
        kind="kv"
        :key-placeholder="f.keyPlaceholder"
        :value-placeholder="f.valuePlaceholder"
        add-text="添加"
        @update:model-value="(v) => set(f.key, v)"
      />
      <SchemaField
        v-else
        :field="f"
        :model-value="modelValue ? modelValue[f.key] : undefined"
        @update:model-value="(v) => set(f.key, v)"
      />
    </div>
  </div>
</template>

<style scoped>
.struct-editor {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  gap: 14px 20px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.struct-field { min-width: 0; display: grid; gap: 6px; align-content: start; }
</style>
