/**
 * 端到端验证：模拟「打开表单编辑页 → 直接点保存」的真实链路。
 *
 * 流程：登录 → 拉取项目详情 → 用前端组包逻辑还原内容 → 调保存接口 → 再拉回来逐字段比对
 *
 * 运行：node web/e2e-save.test.mjs
 */
import { parse, stringify } from 'yaml';
import { loadServiceModel, buildCompose } from './src/composeBuild.js';
import { TOP_RESOURCE_DEFS } from './src/composeSchema.js';

const BASE = process.env.BASE || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || 'test123';
const PROJECT = process.env.PROJECT || 'legacy';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  check(name, x === y, `实际 ${x} ≠ 期望 ${y}`);
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

// 1) 登录
const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
if (login.status !== 200) {
  console.error('登录失败：', login.data);
  process.exit(1);
}
const cookie = login.headers.get('set-cookie').split(';')[0];
const H = { Cookie: cookie };
console.log('已登录\n');

// 2) 拉取项目
const before = await api(`/api/project/${PROJECT}`, { headers: H });
if (before.status !== 200) {
  console.error('拉取项目失败：', before.data);
  process.exit(1);
}
const detail = before.data;
const rawBefore = parse(detail.composeRaw);
// 与组件一致：自行解析原始 YAML，以保留字段顺序（后端返回的 map 已被字母排序）
const orderedDoc = parse(detail.composeRaw);
console.log(`项目 ${PROJECT}：${Object.keys(orderedDoc.services || {}).join(', ')}\n`);

// 3) 模拟前端：加载表单模型（什么都不改）
const services = Object.entries(orderedDoc.services || {}).map(([name, cfg]) => {
  const p = (detail.services || []).find((x) => x.name === name);
  return loadServiceModel(name, cfg, p ? p.environment || [] : []);
});

// 顶层资源：还原成编辑条目
const topResources = {};
const topOrigResources = {};
for (const key of Object.keys(TOP_RESOURCE_DEFS)) {
  const def = TOP_RESOURCE_DEFS[key];
  const v = orderedDoc[key];
  topOrigResources[key] = v;
  topResources[key] = !v
    ? []
    : Object.entries(v).map(([name, attrs]) => {
        const a = attrs && typeof attrs === 'object' ? attrs : {};
        const ed = {};
        for (const f of def.fields) {
          const raw = a[f.key];
          if (f.type === 'kv') ed[f.key] = raw && typeof raw === 'object'
            ? Object.entries(raw).map(([k, val]) => ({ key: k, value: String(val) }))
            : [];
          else if (f.type === 'switch') ed[f.key] = raw === true;
          else ed[f.key] = raw === undefined || raw === null ? '' : String(raw);
        }
        return { name, __attrs: ed };
      });
}

const topExtras = {};
for (const [k, v] of Object.entries(orderedDoc)) {
  if (k === 'services' || k === 'name' || TOP_RESOURCE_DEFS[k]) continue;
  topExtras[k] = v;
}

const { compose: built, dupes } = buildCompose({
  services,
  topExtras,
  topName: orderedDoc.name || '',
  topResources,
  topOrigResources,
  topResourceDefs: TOP_RESOURCE_DEFS,
});

console.log('=== 打开表单直接保存：字段保真检查 ===');
const appBefore = rawBefore.services.app;
const appAfter = built.services.app;

eq('镜像未变', appAfter.image, appBefore.image);
eq('容器名未变', appAfter.container_name, appBefore.container_name);
eq('端口数组未变', appAfter.ports, appBefore.ports);
eq('挂载数组未变', appAfter.volumes, appBefore.volumes);
eq('depends_on 仍是数组', appAfter.depends_on, appBefore.depends_on);
eq('networks 仍是数组', appAfter.networks, appBefore.networks);
eq('labels 仍是对象', appAfter.labels, appBefore.labels);
eq('healthcheck.test 仍是数组', appAfter.healthcheck.test, appBefore.healthcheck.test);
eq('healthcheck.interval 未变', appAfter.healthcheck.interval, appBefore.healthcheck.interval);
eq('deploy.resources 未变', appAfter.deploy.resources.limits.cpus, appBefore.deploy.resources.limits.cpus);
eq('logging.options 未变', appAfter.logging.options['max-size'], appBefore.logging.options['max-size']);
eq('environment 未被清空', Object.keys(appAfter.environment || {}).sort(), Object.keys(appBefore.environment || {}).sort());
eq('db 服务完整', built.services.db.image, rawBefore.services.db.image);
eq('顶层 networks 未变', built.networks, rawBefore.networks);
eq('顶层 volumes 未变', built.volumes, rawBefore.volumes);
eq('无重复服务名', dupes.length, 0);

// 4) 保存
const content = stringify(built, { lineWidth: 0, sortMapEntries: false });
const save = await api(`/api/project/${PROJECT}/compose`, { method: 'PUT', headers: H, body: JSON.stringify({ content }) });
check('保存接口返回 200', save.status === 200, JSON.stringify(save.data));
if (save.status !== 200) {
  console.error(save.data);
  process.exit(1);
}

// 5) 读回比对
const after = await api(`/api/project/${PROJECT}`, { headers: H });
const rawAfter = parse(after.data.composeRaw);
console.log('\n=== 保存后读回：整体结构比对 ===');
eq('services 键完全一致', Object.keys(rawAfter.services), Object.keys(rawBefore.services));
eq('app 服务逐字段一致', stable(rawAfter.services.app), stable(rawBefore.services.app));
eq('db 服务逐字段一致', stable(rawAfter.services.db), stable(rawBefore.services.db));
eq('顶层 networks 一致', stable(rawAfter.networks), stable(rawBefore.networks));
eq('顶层 volumes 一致', stable(rawAfter.volumes), stable(rawBefore.volumes));
eq('整体 compose 一致', stable(rawAfter), stable(rawBefore));

console.log('\n=== 字段顺序保持（用户手写顺序不应被打乱）===');
eq('app 字段顺序未变', Object.keys(rawAfter.services.app), Object.keys(rawBefore.services.app));
eq('顶层字段顺序未变', Object.keys(rawAfter), Object.keys(rawBefore));

console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : ''}\n`);
process.exitCode = fail ? 1 : 0;

// 深度比较（忽略键顺序）
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
