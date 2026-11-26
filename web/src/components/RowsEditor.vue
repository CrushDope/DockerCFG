<script setup>
/**
 * 行式编辑器：用于「字符串列表」与「键值对」两类字段。
 *  - kind=list：一行一个输入框，整条内容就是值（端口、挂载、命令……）
 *  - kind=kv  ：一行两个输入框，名称 + 取值（标签、网络、依赖……）
 */
import { Delete, Plus } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  kind: { type: String, default: 'list' },
  placeholder: { type: String, default: '值' },
  keyPlaceholder: { type: String, default: '名称' },
  valuePlaceholder: { type: String, default: '取值' },
  addText: { type: String, default: '添加' },
});
const emit = defineEmits(['update:modelValue']);

function update(i, patch) {
  const next = props.modelValue.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  emit('update:modelValue', next);
}
function add() {
  emit('update:modelValue', [...props.modelValue, { key: '', value: '' }]);
}
function remove(i) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i));
}
</script>

<template>
  <div class="rows-editor">
    <div v-for="(r, i) in modelValue" :key="i" class="rows-row">
      <el-input
        class="rows-input"
        :model-value="r.key"
        :placeholder="kind === 'kv' ? keyPlaceholder : placeholder"
        :aria-label="`${kind === 'kv' ? keyPlaceholder : placeholder} ${i + 1}`"
        @update:model-value="(v) => update(i, { key: v })"
      />
      <el-input
        v-if="kind === 'kv'"
        class="rows-input"
        :model-value="r.value"
        :placeholder="valuePlaceholder"
        :aria-label="`${valuePlaceholder} ${i + 1}`"
        @update:model-value="(v) => update(i, { value: v })"
      />
      <el-button
        class="rows-del"
        :icon="Delete"
        text
        type="danger"
        :aria-label="`删除第 ${i + 1} 行`"
        @click="remove(i)"
      />
    </div>

    <button type="button" class="rows-add" @click="add">
      <el-icon aria-hidden="true"><Plus /></el-icon>
      <span>{{ addText }}</span>
    </button>
  </div>
</template>

<style scoped>
.rows-editor { display: grid; gap: 6px; width: 100%; }
.rows-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.rows-input { flex: 1 1 0; min-width: 0; }
.rows-del { flex: 0 0 28px; width: 28px; height: 28px; padding: 0; }
.rows-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}
.rows-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.rows-add:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
</style>
