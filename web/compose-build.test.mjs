/**
 * compose 组包逻辑回归测试。
 *
 * 运行：node web/compose-build.test.mjs
 *
 * 覆盖两类场景：
 *  A. 保真 —— 打开表单什么都不改就保存，原文件内容必须逐字段不变
 *  B. 落盘 —— 改了某个字段，只有该字段变化，其余保持原样
 */
import { parse, stringify } from 'yaml';
import { loadServiceModel, buildCompose, buildTopResource, buildEnvironment } from './src/composeBuild.js';
import { TOP_RESOURCE_DEFS } from './src/composeSchema.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  → ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `实际 ${a} ≠ 期望 ${e}`);
}

// ---------- 测试数据 ----------
const LEGACY = `
name: legacy-stack
services:
  app:
    image: nginx:1.25
    container_name: legacy_app
    restart: always
    ports:
      - "8080:80"
      - "8443:443"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      TZ: Asia/Shanghai
      DEBUG: "false"
      TMDB_KEY: \${TMDB_KEY}
    depends_on:
      - db
    networks:
      - backend
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost"]
      interval: 30s
      retries: 3
    labels:
      maintainer: someone
    deploy:
      resources:
        limits:
          cpus: "0.5"
    logging:
      driver: json-file
      options:
        max-size: 10m
    mem_limit: 512m
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    networks:
      - backend
networks:
  backend:
    driver: bridge
volumes:
  pgdata:
`;

const doc = parse(LEGACY);
const svcRaw = doc.services;

// env 表单模型：后端解析后的结果
const envItems = [
  { key: 'TZ', value: 'Asia/Shanghai', isRef: false, hasDefault: false, default: '' },
  { key: 'DEBUG', value: 'false', isRef: false, hasDefault: false, default: '' },
  { key: 'TMDB_KEY', value: 'secret-from-env', isRef: true, hasDefault: false, default: '' },
];

console.log('\n=== A. 保真：不改任何东西再保存 ===');

{
  const svc = loadServiceModel('app', svcRaw.app, envItems);
  const out = buildServiceSafe(svc);
  eq('image 保持不变', out.image, 'nginx:1.25');
  eq('container_name 保持不变', out.container_name, 'legacy_app');
  eq('ports 保持数组且内容不变', out.ports, ['8080:80', '8443:443']);
  eq('volumes 保持不变', out.volumes, ['./html:/usr/share/nginx/html:ro']);
  eq('depends_on 保持数组形态', out.depends_on, ['db']);
  eq('networks 保持数组形态', out.networks, ['backend']);
  eq('labels 保持对象形态', out.labels, { maintainer: 'someone' });
  eq('healthcheck.test 保持数组形态', out.healthcheck.test, ['CMD', 'curl', '-f', 'http://localhost']);
  eq('healthcheck.interval 保持不变', out.healthcheck.interval, '30s');
  eq('deploy.resources 保持不变', out.deploy.resources.limits.cpus, '0.5');
  eq('logging.options 保持不变', out.logging.options['max-size'], '10m');
  eq('environment 未被清空', Object.keys(out.environment || {}).sort(), ['DEBUG', 'TMDB_KEY', 'TZ']);
  eq('environment 的 ${} 引用未被展开成明文', out.environment.TMDB_KEY, '${TMDB_KEY}');
  check('mem_limit 保留为字符串', out.mem_limit === '512m');
}

console.log('\n=== B. 落盘：改一个字段，其余不动 ===');

{
  const svc = loadServiceModel('app', svcRaw.app, envItems);
  svc.image = 'nginx:1.26';
  const out = buildServiceSafe(svc);
  eq('image 已更新', out.image, 'nginx:1.26');
  eq('其他字段未受影响（healthcheck）', out.healthcheck.interval, '30s');
  eq('其他字段未受影响（labels）', out.labels, { maintainer: 'someone' });
  eq('其他字段未受影响（environment）', Object.keys(out.environment).length, 3);
}

console.log('\n=== C. 结构化子表单：build / healthcheck / deploy ===');

{
  const svc = loadServiceModel('app', svcRaw.app, envItems);
  // 健康检查改成字符串形式
  svc.healthcheck.test = 'CMD-SHELL curl -f http://localhost || exit 1';
  const out = buildServiceSafe(svc);
  eq('CMD-SHELL 写成字符串', out.healthcheck.test, 'CMD-SHELL curl -f http://localhost || exit 1');

  // 资源限制改成对象
  svc.deploy = { ...svc.deploy, replicas: '2' };
  const out2 = buildServiceSafe(svc);
  eq('deploy.replicas 已写入', out2.deploy.replicas, '2');
  eq('deploy.resources 仍保留', out2.deploy.resources.limits.cpus, '0.5');
}

console.log('\n=== D. 列表与键值字段 ===');

{
  const svc = loadServiceModel('app', svcRaw.app, envItems);
  svc.ports.push({ key: '9090:90', value: '' });
  const out = buildServiceSafe(svc);
  eq('ports 追加成功', out.ports, ['8080:80', '8443:443', '9090:90']);

  const svc2 = loadServiceModel('app', svcRaw.app, envItems);
  svc2.networks = [{ key: 'backend', value: '' }, { key: 'frontend', value: '' }];
  const out2 = buildServiceSafe(svc2);
  eq('networks 改成对象形态', out2.networks, { backend: null, frontend: null });

  const svc3 = loadServiceModel('app', svcRaw.app, envItems);
  svc3.labels = [{ key: 'team', value: 'ops' }];
  const out3 = buildServiceSafe(svc3);
  eq('labels 键值对写入', out3.labels, { team: 'ops' });
}

console.log('\n=== E. 环境变量：引用型与内联型 ===');

{
  eq('引用型生成占位符', buildEnvironment(envItems).TMDB_KEY, '${TMDB_KEY}');
  eq('内联型生成字面量', buildEnvironment(envItems).TZ, 'Asia/Shanghai');
  eq('带默认值的引用', buildEnvironment([{ key: 'A', value: 'x', isRef: true, hasDefault: true, default: 'd' }]).A, '${A:-d}');

  const svc = loadServiceModel('app', svcRaw.app, envItems);
  svc.environment[2].value = 'changed';
  const out = buildServiceSafe(svc);
  eq('引用型改值后 compose 仍是占位符', out.environment.TMDB_KEY, '${TMDB_KEY}');
}

console.log('\n=== F. 顶层资源 ===');

{
  const entries = [{ name: 'backend', __attrs: { driver: 'bridge', external: false, attachable: false, labels: [] } }];
  const built = buildTopResource(entries, TOP_RESOURCE_DEFS.networks);
  eq('网络条目已组装', built, { backend: { driver: 'bridge' } });

  const svc2 = loadServiceModel('db', svcRaw.db, []);
  const { compose, dupes } = buildCompose({
    services: [svc2],
    topExtras: { version: '3.8' },
    topName: 'legacy-stack',
    topResources: { networks: entries, volumes: [], configs: [], secrets: [] },
    topOrigResources: { networks: { backend: { driver: 'bridge' } }, volumes: undefined, configs: undefined, secrets: undefined },
    topResourceDefs: TOP_RESOURCE_DEFS,
  });
  eq('未改动的顶层网络保持原样', compose.networks, { backend: { driver: 'bridge' } });
  eq('未识别的顶层字段保留', compose.version, '3.8');
  eq('项目名称保留', compose.name, 'legacy-stack');
  eq('无重复服务名', dupes.length, 0);
}

console.log('\n=== G. 序列化后可被 YAML 解析回来 ===');

{
  const svc = loadServiceModel('app', svcRaw.app, envItems);
  svc.image = 'nginx:1.26';
  const { compose } = buildCompose({
    services: [svc],
    topExtras: {},
    topName: '',
    topResources: { networks: [], volumes: [], configs: [], secrets: [] },
    topOrigResources: {},
    topResourceDefs: TOP_RESOURCE_DEFS,
  });
  const text = stringify(compose, { lineWidth: 0 });
  const back = parse(text);
  eq('往返后 image 一致', back.services.app.image, 'nginx:1.26');
  eq('往返后 healthcheck 仍为数组', back.services.app.healthcheck.test, ['CMD', 'curl', '-f', 'http://localhost']);
  eq('往返后 labels 仍为对象', back.services.app.labels, { maintainer: 'someone' });
  check('端口是字符串而非数字', typeof back.services.app.ports[0] === 'string', typeof back.services.app.ports[0]);
}

console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : ''}\n`);
process.exit(fail ? 1 : 0);

// 辅助：单独构建 service
function buildServiceSafe(svc) {
  const { compose } = buildCompose({
    services: [svc],
    topExtras: {},
    topName: '',
    topResources: { networks: [], volumes: [], configs: [], secrets: [] },
    topOrigResources: {},
    topResourceDefs: TOP_RESOURCE_DEFS,
  });
  return compose.services[svc.name];
}
