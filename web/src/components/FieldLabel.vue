<script setup>
/**
 * 字段标签：中文主标签 + compose 英文键 + 「已配置」状态点。
 *
 * 页面上一律展示中文名，英文键以等宽小字作为副标签，
 * 便于用户在「可视化编辑」与「YAML 源码」之间对照。
 */
defineProps({
  label: { type: String, required: true },
  keyName: { type: String, default: '' },
  set: { type: Boolean, default: false },
});
</script>

<template>
  <div class="sf-label" :class="{ 'is-set': set }">
    <span class="sf-cn">{{ label }}</span>
    <span v-if="set" class="sf-dot" title="已配置" aria-label="已配置"></span>
    <code v-if="keyName" class="sf-en">{{ keyName }}</code>
  </div>
</template>

<style scoped>
.sf-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
}
.sf-cn {
  color: var(--muted);
  font-size: var(--fs-base);
  font-weight: 600;
  line-height: 1.4;
}
.sf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 6px;
}
.sf-en {
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.is-set .sf-cn { color: var(--ink); font-weight: 600; }
.is-set .sf-en { color: var(--ink-500); }
</style>
