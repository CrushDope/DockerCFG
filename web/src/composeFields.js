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

/* ------------------------------------------------------------------ *
 * 映射字段：宿主机 ↔ 容器 成对编辑（端口 / 挂载 / 设备）
 *
 * 行结构 { key, value, mode, note }：
 *   key   宿主机侧（端口可含 IP、挂载可为路径或卷名）
 *   value 容器侧
 *   mode  协议 / 权限（tcp|udp、ro|rw、r|w|rwm 等）
 *   note  无法归入以上三列的原始片段（长语法、附加标志），保真回写用
 * ------------------------------------------------------------------ */

/** 长语法对象 → 映射行；返回 null 表示不是可识别的长语法 */
function longSyntaxRow(x, flavor) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  // note.__raw 保存原始对象：回写时以它为底增量覆盖，保留键顺序与值的原始类型
  if (flavor === 'port') {
    // { target, published, host_ip, protocol, mode }
    const container = x.target ?? x.container ?? '';
    const host = x.published ?? x.host ?? '';
    if (container === '' && host === '') return null;
    return {
      key: host !== '' && x.host_ip ? `${x.host_ip}:${host}` : String(host),
      value: String(container),
      mode: x.protocol ? String(x.protocol) : '',
      note: { __raw: deepClone(x), rawKey: host, rawValue: container, ...(x.mode ? { modeFlag: String(x.mode) } : {}) },
      long: true,
    };
  }
  // volume / device 长语法
  const source = x.source ?? x.host ?? '';
  const target = x.target ?? x.container ?? '';
  if (source === '' && target === '') return null;
  const note = { __raw: deepClone(x), rawKey: source, rawValue: target };
  if (x.type && flavor === 'volume') note.volumeType = String(x.type);
  if (flavor === 'volume' && x.read_only === true) note.readOnly = true;
  if (x.bind?.propagation) note.propagation = String(x.bind.propagation);
  if (x.volume?.nocopy === true) note.nocopy = true;
  if (x.consistency) note.consistency = String(x.consistency);
  return {
    key: String(source), value: String(target),
    mode: flavor === 'device' ? (x.permissions ? String(x.permissions) : '') : '',
    note, long: true,
  };
}

/**
 * 原始值 → 映射行。
 * 支持短语法字符串（a:b:c）与 Compose 长语法对象，未知形态原样留在一列里。
 */
export function toMappings(value, flavor = 'port') {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((x) => {
    const long = longSyntaxRow(x, flavor);
    if (long) return long;
    const text = x === null || x === undefined ? '' : String(x);
    if (!text.trim()) return { key: '', value: '', mode: '', note: {} };

    // 协议可能写在末尾 /tcp /udp：先摘出来，剩下再按冒号拆
    let body = text;
    let mode = '';
    const knownModes = flavor === 'port'
      ? ['tcp', 'udp', 'sctp']
      : flavor === 'volume'
        ? ['ro', 'rw', 'z', 'Z', 'rshared', 'rslave', 'rprivate', 'consistent', 'cached', 'delegated']
        : ['r', 'w', 'rwm'];
    const slash = body.lastIndexOf('/');
    if (slash > 0 && knownModes.includes(body.slice(slash + 1).toLowerCase())) {
      mode = body.slice(slash + 1);
      body = body.slice(0, slash);
    }

    const parts = body.split(':');
    if (flavor === 'port') {
      // 8080:80 / 127.0.0.1:8080:80 / 8080 / [::1]:8080:80
      if (parts.length >= 3) {
        return { key: parts.slice(0, -1).join(':'), value: parts[parts.length - 1], mode, note: {} };
      }
      if (parts.length === 2) return { key: parts[0], value: parts[1], mode, note: {} };
      return { key: '', value: parts[0], mode, note: {} };
    }

    // volume / device：source:target[:mode]，mode 需匹配已知值才摘出
    if (parts.length >= 2) {
      let tail = parts[parts.length - 1];
      let extraMode = '';
      if (!mode && knownModes.includes(tail.toLowerCase())) {
        extraMode = tail;
        parts.pop();
      }
      const target = parts.length >= 2 ? parts[parts.length - 1] : '';
      const source = parts.length >= 3 ? parts.slice(0, -1).join(':') : (parts.length === 2 ? parts[0] : '');
      return { key: source, value: target, mode: mode || extraMode, note: {} };
    }
    return { key: '', value: parts[0], mode, note: {} };
  });
}

/** 映射行 → compose 短语法数组；无有效内容返回 undefined */
export function mappingsToValue(rows, flavor = 'port') {
  const out = [];
  for (const r of rows || []) {
    const host = String(r.key ?? '').trim();
    const container = String(r.value ?? '').trim();
    const mode = String(r.mode ?? '').trim();
    const note = r.note || {};
    if (!host && !container) continue;

    // 长语法：以原始对象为底增量覆盖，保住键顺序与未改动值的原始类型（如 published: 8080 数字）
    if (r.long) {
      const obj = note.__raw ? deepClone(note.__raw) : {};
      // 值没变就保留原类型，变了才写字符串
      const nextKey = String(note.rawKey ?? '') === host ? note.rawKey : (host || undefined);
      const nextValue = String(note.rawValue ?? '') === container ? note.rawValue : (container || undefined);
      if (flavor === 'port') {
        if (nextValue !== undefined) obj.target = nextValue;
        else delete obj.target;
        if (nextKey !== undefined) {
          if (host.includes(':')) {
            const at = host.lastIndexOf(':');
            obj.host_ip = host.slice(0, at);
            obj.published = note.rawKey !== undefined && String(note.rawKey) === host.slice(at + 1)
              ? note.rawKey : host.slice(at + 1);
          } else obj.published = nextKey;
        } else delete obj.published;
        if (mode) obj.protocol = mode;
        else delete obj.protocol;
        if (note.modeFlag) obj.mode = note.modeFlag;
      } else {
        if (nextKey !== undefined) obj.source = nextKey;
        else delete obj.source;
        if (nextValue !== undefined) obj.target = nextValue;
        else delete obj.target;
        if (flavor === 'device') {
          if (mode) obj.permissions = mode;
          else delete obj.permissions;
        }
      }
      out.push(obj);
      continue;
    }

    // 短语法：宿主机:容器[:mode]（端口协议用 /）
    let s = host && container ? `${host}:${container}` : (host || container);
    if (mode) s += flavor === 'port' ? `/${mode}` : `:${mode}`;
    out.push(s);
  }
  return out.length ? out : undefined;
}

/** 映射行标准化，用于比较是否被改动（含 mode 与长语法附加信息） */
export function normalizeMappings(rows) {
  return (rows || []).map((r) => ({
    key: String(r.key ?? '').trim(),
    value: String(r.value ?? '').trim(),
    mode: String(r.mode ?? '').trim(),
    long: !!r.long,
    note: r.note || {},
  }));
}

export function mappingsEqual(a, b) {
  return JSON.stringify(normalizeMappings(a)) === JSON.stringify(normalizeMappings(b));
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
