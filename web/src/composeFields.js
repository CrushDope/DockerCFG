/**
 * compose 值 ↔ 表单表示的双向转换。
 *
 * 设计要点：
 *  1. 未被用户改动的字段一律保留原始值（含对象形态、数字类型等），
 *     避免"打开表单再保存"就把文件改得面目全非。
 *  2. 只有真正改动的字段才按新的形态写回。
 */

export function deepClone(v) {
  if (v === undefined || v === null) return v;
  return JSON.parse(JSON.stringify(v));
}

export function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * 原始值 → 可编辑行。
 * 行结构统一为 { key, value }：
 *   - list 类型只用 key（整条内容就是 key）
 *   - kv   类型 key 是名称，value 是取值
 */
export function toRows(value, kind) {
  if (value === undefined || value === null) return [];
  if (kind === 'kv') {
    if (Array.isArray(value)) {
      return value.map((s) => {
        const t = String(s);
        const i = t.indexOf('=');
        return i < 0 ? { key: t, value: '' } : { key: t.slice(0, i), value: t.slice(i + 1) };
      });
    }
    if (typeof value === 'object') {
      return Object.entries(value).map(([k, v]) => ({
        key: k,
        value: v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      }));
    }
    return [{ key: String(value), value: '' }];
  }
  // list
  if (Array.isArray(value)) {
    return value.map((x) => ({
      key: x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x),
      value: '',
    }));
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => ({
      key: k,
      value: v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
  }
  return [{ key: String(value), value: '' }];
}

/** 可编辑行 → compose 值；无有效内容时返回 undefined（表示删除该键） */
export function rowsToValue(rows, kind, valueMode = 'plain') {
  const clean = (rows || [])
    .filter((r) => String(r.key ?? '').trim() !== '')
    .map((r) => ({ key: String(r.key).trim(), value: r.value ?? '' }));
  if (!clean.length) return undefined;

  if (kind === 'kv') {
    const obj = {};
    for (const r of clean) {
      if (valueMode === 'json') {
        const t = String(r.value).trim();
        if (!t) obj[r.key] = null;
        else {
          try {
            obj[r.key] = JSON.parse(t);
          } catch {
            obj[r.key] = t;
          }
        }
      } else {
        obj[r.key] = String(r.value);
      }
    }
    return obj;
  }
  return clean.map((r) => r.key);
}

/** 行标准化，用于比较是否被改动 */
export function normalizeRows(rows) {
  return (rows || [])
    .filter((r) => String(r.key ?? '').trim() !== '')
    .map((r) => ({ key: String(r.key).trim(), value: String(r.value ?? '') }));
}

export function rowsEqual(a, b) {
  const x = normalizeRows(a);
  const y = normalizeRows(b);
  if (x.length !== y.length) return false;
  return x.every((r, i) => r.key === y[i].key && r.value === y[i].value);
}

/** 结构化子表单：compose 值 → 扁平编辑对象 */
export function structToEditor(def, value) {
  const obj = def.normalize ? def.normalize(value) : value && typeof value === 'object' ? value : {};
  const out = {};
  for (const f of def.fields) {
    const raw = f.read ? f.read(obj) : getPath(obj, f.path || f.key);
    if (f.type === 'kv') out[f.key] = toRows(raw, 'kv');
    else if (f.type === 'switch') out[f.key] = raw === true;
    else out[f.key] = raw === undefined || raw === null ? '' : String(raw);
  }
  return out;
}

/** 结构化子表单：扁平编辑对象 → compose 值 */
export function editorToStruct(def, editor) {
  const obj = {};
  for (const f of def.fields) {
    const v = editor ? editor[f.key] : undefined;
    if (f.type === 'kv') {
      const val = rowsToValue(v, 'kv', f.valueMode);
      if (val !== undefined) setPath(obj, f.path || f.key, val);
    } else if (f.type === 'switch') {
      if (v) setPath(obj, f.path || f.key, true);
    } else {
      const s = String(v ?? '').trim();
      if (!s) continue;
      if (f.write) f.write(obj, s);
      else setPath(obj, f.path || f.key, s);
    }
  }
  return obj;
}

/** 编辑对象是否发生变化（顺序敏感的深比较） */
export function editorEqual(a, b) {
  return JSON.stringify(normalizeEditor(a)) === JSON.stringify(normalizeEditor(b));
}

function normalizeEditor(obj) {
  if (!obj) return {};
  const out = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (Array.isArray(v)) out[k] = normalizeRows(v);
    else if (v && typeof v === 'object') out[k] = normalizeEditor(v);
    else out[k] = v;
  }
  return out;
}
