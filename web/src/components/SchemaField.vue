<script setup>
/**
 * 单个字段的控件渲染器（只负责控件，标签由外层统一排布）。
 *
 * 控件类型：input / select / switch / list / kv / textarea
 */
import RowsEditor from './RowsEditor.vue';

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { type: null, default: '' },
});
const emit = defineEmits(['update:modelValue']);

function set(v) {
  emit('update:modelValue', v);
}
</script>

<template>
  <div class="schema-field">
    <el-input
      v-if="field.type === 'input'"
      :model-value="modelValue"
      :aria-label="field.label"
      :placeholder="field.placeholder"
      size="small"
      clearable
      @update:model-value="set"
    />

    <el-select
      v-else-if="field.type === 'select'"
      :model-value="modelValue"
      :aria-label="field.label"
      :placeholder="field.placeholder || '未设置'"
      size="small"
      clearable
      style="width: 100%"
      @update:model-value="set"
    >
      <el-option v-for="o in field.options" :key="o.value" :label="o.label" :value="o.value" />
    </el-select>

    <el-switch
      v-else-if="field.type === 'switch'"
      :model-value="modelValue"
      :aria-label="field.label"
      inline-prompt
      active-text="开"
      inactive-text="关"
      style="--el-switch-on-color: var(--accent); margin-left: -8px"
      @update:model-value="set"
    />

    <RowsEditor
      v-else-if="field.type === 'list'"
      :model-value="modelValue"
      :aria-label="field.label"
      kind="list"
      :placeholder="field.placeholder"
      :add-text="field.addText || '添加'"
      @update:model-value="set"
    />

    <RowsEditor
      v-else-if="field.type === 'kv'"
      :model-value="modelValue"
      :aria-label="field.label"
      kind="kv"
      :key-placeholder="field.keyPlaceholder"
      :value-placeholder="field.valuePlaceholder"
      :add-text="field.addText || '添加'"
      @update:model-value="set"
    />

    <el-input
      v-else-if="field.type === 'textarea'"
      :model-value="modelValue"
      :aria-label="field.label"
      type="textarea"
      :rows="3"
      :placeholder="field.placeholder"
      size="small"
      @update:model-value="set"
    />

    <span v-else class="sf-unsupported">该字段类型暂不支持可视化编辑</span>
  </div>
</template>

<style scoped>
.schema-field { min-width: 0; width: 100%; }
.sf-unsupported {
  font-size: var(--fs-sm);
  color: var(--warn-700);
  background: var(--warn-50);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
}
</style>
