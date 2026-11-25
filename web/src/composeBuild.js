/**
 * compose 组装逻辑（纯函数，无 Vue 依赖，便于回归测试）。
 *
 * 核心约定：
 *  - 未被用户改动的字段一律保留原始值（含对象形态、数字类型），
 *    避免「打开表单再保存」就把文件改得面目全非。
 *  - 改动的字段按 schema 写回，键名始终是 compose 的英文键。
 */
import { SERVICE_FIELDS, STRUCT_DEFS } from './composeSchema.js';
import {
  deepClone, toRows, rowsToValue, rowsEqual,
  structToEditor, editorToStruct, editorEqual,
} from './composeFields.js';

/** 由 compose 原始配置构建一个服务的编辑模型 */
export function loadServiceModel(name, cfg, envItems = []) {
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const svc = {
    name,
    raw: deepClone(c),
    origRows: {},
    origStruct: {},
    environment: (envItems || []).map((e) => ({ ...e })),
    origEnvironment: deepClone(envItems || []),
  };
  for (const f of SERVICE_FIELDS) {
    if (f.type === 'list' || f.type === 'kv') {
      const rows = toRows(c[f.key], f.type);
      svc[f.key] = rows;
      svc.origRows[f.key] = deepClone(rows);
    } else if (f.type === 'struct') {
      const ed = structToEditor(STRUCT_DEFS[f.struct], c[f.key]);
      svc[f.key] = ed;
      svc.origStruct[f.key] = deepClone(ed);
    } else if (f.type === 'switch') {
      svc[f.key] = c[f.key] === true;
    } else {
      const v = c[f.key];
      svc[f.key] = v === undefined || v === null ? '' : String(v);
    }
  }
  return svc;
}

const envRows = (list) => (list || []).filter((e) => e.key?.trim());
const refKey = (e) => e.refKey || e.key.trim();
const envShape = (list) => JSON.stringify(envRows(list).map((e) => JSON.stringify([
  e.key.trim(), !!e.isRef, e.isRef ? refKey(e) : (e.value ?? ''),
  e.isRef && !!e.hasDefault, e.isRef ? (e.default || '') : '',
])).sort());

export function envEqual(a, b) {
  return envShape(a) === envShape(b);
}

export function envDirty(svc) {
  if (!envEqual(svc.environment, svc.origEnvironment)) return true;
  const values = (rows) => JSON.stringify(envRows(rows).filter((e) => e.isRef)
    .map((e) => JSON.stringify([refKey(e), e.value ?? ''])).sort());
  return values(svc.environment) !== values(svc.origEnvironment);
}

/** 只写入新增引用或实际有改动的 .env 值，不覆盖其他服务正在共享的变量。 */
export function collectRefUpdates(services) {
  const updates = new Map();
  for (const svc of services) {
    const previous = new Map(envRows(svc.origEnvironment).filter((e) => e.isRef).map((e) => [refKey(e), e.value ?? '']));
    for (const e of envRows(svc.environment)) {
      if (!e.isRef) continue;
      const key = refKey(e);
      const value = e.value ?? '';
      if (previous.get(key) === value) continue;
      if (updates.has(key) && updates.get(key) !== value) throw new Error(`.env 变量「${key}」有多个不同的值，请先统一。`);
      updates.set(key, value);
    }
  }
  return Array.from(updates, ([key, value]) => ({ key, value }));
}

/** 环境变量 → compose 的 environment 段 */
export function buildEnvironment(items) {
  const out = Object.create(null);
  for (const e of items || []) {
    const k = (e.key || '').trim();
    if (!k) continue;
    out[k] = e.isRef
      ? (e.hasDefault ? `\${${refKey(e)}:-${e.default}}` : `\${${refKey(e)}}`)
      : (e.value ?? '');
  }
  return out;
}

/** 编辑模型 → compose 的 service 对象 */
export function buildService(svc) {
  const out = deepClone(svc.raw || {});
  for (const f of SERVICE_FIELDS) {
    const origRaw = svc.raw ? svc.raw[f.key] : undefined;
    if (f.type === 'list' || f.type === 'kv') {
      if (rowsEqual(svc[f.key], svc.origRows[f.key])) continue; // 未改动，保留原值
      const v = rowsToValue(svc[f.key], f.type, f.valueMode);
      if (v === undefined) delete out[f.key];
      else out[f.key] = v;
    } else if (f.type === 'struct') {
      if (editorEqual(svc[f.key], svc.origStruct[f.key])) continue;
      const v = editorToStruct(STRUCT_DEFS[f.struct], svc[f.key]);
      if (v && Object.keys(v).length) out[f.key] = v;
      else delete out[f.key];
    } else if (f.type === 'switch') {
      if (svc[f.key]) out[f.key] = true;
      else delete out[f.key];
    } else {
      const s = String(svc[f.key] ?? '').trim();
      if (origRaw === undefined) {
        if (s) out[f.key] = s;
      } else if (!s) {
        delete out[f.key];
      } else if (String(origRaw) === s) {
        out[f.key] = origRaw; // 保留原始类型（数字 / 布尔）
      } else {
        out[f.key] = s;
      }
    }
  }

  // environment：改动过才重建，未改动保留原始写法
  if (!envEqual(svc.environment, svc.origEnvironment)) {
    const envOut = buildEnvironment(svc.environment);
    if (Object.keys(envOut).length) out.environment = envOut;
    else delete out.environment;
  }
  return out;
}

/** 顶层资源条目 → compose 对象 */
export function buildTopResource(entries, def) {
  const out = {};
  for (const e of entries || []) {
    const name = (e.name || '').trim();
    if (!name) continue;
    const attrs = {};
    for (const f of def.fields) {
      const v = e.__attrs ? e.__attrs[f.key] : undefined;
      if (f.type === 'kv') {
        const val = rowsToValue(v, 'kv', f.valueMode);
        if (val !== undefined) attrs[f.key] = val;
      } else if (f.type === 'switch') {
        if (v) attrs[f.key] = true;
      } else {
        const s = String(v ?? '').trim();
        if (s) attrs[f.key] = s;
      }
    }
    out[name] = Object.keys(attrs).length ? attrs : null;
  }
  return out;
}

/** 稳定的 JSON 序列化（键排序），用于比较是否改动 */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * 组装完整 compose。
 * @param {object} o
 * @param {Array}  o.services          服务编辑模型
 * @param {object} o.topExtras         未识别的顶层字段（原样保留）
 * @param {string} o.topName           项目名称
 * @param {object} o.topResources      { networks:[], volumes:[], ... }
 * @param {object} o.topOrigResources  { networks:原值, ... }
 * @param {object} o.topResourceDefs   顶层资源定义
 */
export function buildCompose(o) {
  const out = { ...(o.topExtras || {}) };
  const svcs = Object.create(null);
  const seen = new Set();
  const dupes = [];
  for (const svc of o.services || []) {
    const key = (svc.name || '').trim();
    if (!key) continue;
    if (seen.has(key)) {
      dupes.push(key);
      continue;
    }
    seen.add(key);
    svcs[key] = buildService(svc);
  }
  out.services = svcs;

  const name = (o.topName || '').trim();
  if (name) out.name = name;
  else delete out.name;

  for (const key of Object.keys(o.topResourceDefs || {})) {
    const built = buildTopResource(o.topResources?.[key], o.topResourceDefs[key]);
    const orig = o.topOrigResources?.[key];
    if (stable(built) === stable(orig === undefined ? undefined : orig)) {
      // 未改动：保留原始写法（out 起始时不含这些键，必须显式带回）
      if (orig !== undefined) out[key] = deepClone(orig);
      continue;
    }
    if (Object.keys(built).length) out[key] = built;
    else delete out[key];
  }
  return { compose: out, dupes };
}
