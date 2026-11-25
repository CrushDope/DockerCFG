import assert from 'node:assert/strict';
import test from 'node:test';
import { buildService, collectRefUpdates, envDirty, loadServiceModel } from './src/composeBuild.js';

const ref = { key: 'API_TOKEN', refKey: 'SHARED_TOKEN', isRef: true, value: 'old' };
const makeService = (name) => loadServiceModel(name, { environment: { API_TOKEN: '${SHARED_TOKEN}' } }, [ref]);

test('只改引用变量的值：同步正确的 .env 键，不改变 YAML', () => {
  const service = makeService('app');
  service.name = 'renamed';
  service.environment[0].value = 'new';
  assert.equal(envDirty(service), true);
  assert.deepEqual(collectRefUpdates([service, makeService('worker')]), [{ key: 'SHARED_TOKEN', value: 'new' }]);
  assert.deepEqual(buildService(service).environment, { API_TOKEN: '${SHARED_TOKEN}' });
});

test('新增服务可以提交引用变量，多个修改冲突时停止保存', () => {
  const service = loadServiceModel('newservice', {});
  service.environment.push({ ...ref, value: 'new' });
  const worker = makeService('worker');
  worker.environment[0].value = 'different';
  assert.throws(() => collectRefUpdates([service, worker]), /SHARED_TOKEN/);
  assert.equal(buildService(service).environment.API_TOKEN, '${SHARED_TOKEN}');
  assert.deepEqual(collectRefUpdates([service]), [{ key: 'SHARED_TOKEN', value: 'new' }]);
});
