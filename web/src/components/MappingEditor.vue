<script setup>
/**
 * 双列映射编辑器：把「宿主机:容器」拆成两列分别填写。
 *
 * flavor=port   → 宿主机端口 ↔ 容器端口，模式列为协议（tcp / udp / sctp）
 * flavor=volume → 宿主机路径或卷名 ↔ 容器内路径，模式列为读写权限
 * flavor=device → 宿主机设备 ↔ 容器内设备，模式列为设备权限
 *
 * 行结构 { key, value, mode, note, long }，与 composeFields.toMappings 对应。
 */
import { computed } from 'vue';
import { Delete, Plus, Right } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  flavor: { type: String, default: 'port' },
  field: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);

const hostLabel = computed(() => props.field.hostLabel || (props.flavor === 'port' ? '宿主机端口' : '宿主机路径'));
const containerLabel = computed(() => props.field.containerLabel || '容器端口');
const hostPlaceholder = computed(() => props.field.hostPlaceholder || '');
const containerPlaceholder = computed(() => props.field.containerPlaceholder || '');

const modeOptions = computed(() => {
  if (props.flavor === 'port') {
    return [
      { label: '默认 TCP', value: '' },
      { label: 'TCP', value: 'tcp' },
      { label: 'UDP', value: 'udp' },
      { label: 'SCTP', value: 'sctp' },
    ];
  }
  if (props.flavor === 'volume') {
    return [
      { label: '读写', value: '' },
      { label: '只读 ro', value: 'ro' },
      { label: '读写 rw', value: 'rw' },
      { label: '共享 z', value: 'z' },
      { label: '私有 Z', value: 'Z' },
    ];
  }
  return [
    { label: '默认', value: '' },
    { label: '读 r', value: 'r' },
    { label: '写 w', value: 'w' },
    { label: '读写 rwm', value: 'rwm' },
  ];
});

const modeLabel = computed(() => (props.flavor === 'port' ? '协议' : props.flavor === 'volume' ? '权限' : '权限'));

function update(i, patch) {
  const next = props.modelValue.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  emit('update:modelValue', next);
}
function add() {
  emit('update:modelValue', [...props.modelValue, { key: '', value: '', mode: '', note: {} }]);
}
function remove(i) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i));
}

/** 展示长语法还原标记，让用户知道这一行来自对象写法 */
function rowHint(r) {
  if (!r.long) return '';
  const bits = [];
  if (r.note?.volumeType) bits.push(`类型 ${r.note.volumeType}`);
  if (r.note?.readOnly) bits.push('只读');
  if (r.note?.propagation) bits.push(`传播 ${r.note.propagation}`);
  if (r.note?.nocopy) bits.push('nocopy');
  if (r.note?.consistency) bits.push(r.note.consistency);
  return bits.length ? bits.join(' · ') : '长语法';
}
</script>

<template>
  <div class="map-editor">
    <div class="map-caption" aria-hidden="true">
      <span>{{ hostLabel }}</span>
      <span></span>
      <span>{{ containerLabel }}</span>
      <span>{{ modeLabel }}</span>
      <span></span>
    </div>

    <div v-for="(r, i) in modelValue" :key="i" class="map-row">
      <el-input
        class="map-input map-host"
        :model-value="r.key"
        :placeholder="hostPlaceholder"
        :aria-label="`第 ${i + 1} 项${hostLabel}`"
        @update:model-value="(v) => update(i, { key: v })"
      />
      <span class="map-arrow" aria-hidden="true"><el-icon><Right /></el-icon></span>
      <el-input
        class="map-input map-container"
        :model-value="r.value"
        :placeholder="containerPlaceholder"
        :aria-label="`第 ${i + 1} 项${containerLabel}`"
        @update:model-value="(v) => update(i, { value: v })"
      />
      <el-select
        class="map-mode"
        :model-value="r.mode"
        :aria-label="`第 ${i + 1} 项${modeLabel}`"
        @update:model-value="(v) => update(i, { mode: v })"
      >
        <el-option v-for="o in modeOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button
        class="map-del"
        :icon="Delete"
        text
        type="danger"
        :aria-label="`删除第 ${i + 1} 项映射`"
        @click="remove(i)"
      />
      <span v-if="rowHint(r)" class="map-hint">{{ rowHint(r) }}</span>
    </div>

    <div v-if="!modelValue.length" class="map-empty">暂无映射，点击下方按钮添加。</div>

    <button type="button" class="map-add" @click="add">
      <el-icon aria-hidden="true"><Plus /></el-icon>
      <span>{{ field.addText || '添加' }}</span>
    </button>
  </div>
</template>

<style scoped>
.map-editor { display: grid; gap: 8px; width: 100%; min-width: 0; }

.map-caption,
.map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 116px 32px;
  gap: 8px;
  align-items: center;
}

.map-caption {
  color: var(--muted);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 0 2px;
}
.map-caption span:nth-child(3),
.map-caption span:nth-child(4) { padding-left: 2px; }

.map-host :deep(.el-input__inner) { font-family: var(--font-mono); }
.map-container :deep(.el-input__inner) { font-family: var(--font-mono); }
.map-input { min-width: 0; }

.map-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--faint);
  font-size: var(--fs-md);
}
.map-mode { width: 116px; }

.map-del { width: 32px; height: 34px; padding: 0; }

.map-hint {
  grid-column: 1 / -1;
  margin-top: -2px;
  padding-left: 2px;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.map-empty {
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: center;
}

.map-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-size: var(--fs-base);
  font-weight: 600;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}
.map-add:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.map-add:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }

@media (max-width: 900px) {
  .map-caption { display: none; }
  .map-row { grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 32px; }
  .map-mode { grid-column: 1 / -1; width: 100%; }
  .map-del { grid-column: 4; grid-row: 1; }
}
</style>
