<script setup>
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const emit = defineEmits(['close', 'created']);

const form = ref({
  name: '',
  serviceName: '',
  image: 'nginx:latest',
  containerName: '',
  restart: 'unless-stopped',
  ports: [{ host: '', container: '', protocol: 'tcp' }],
  volumes: [{ source: '', target: '', readOnly: false }],
  environment: [{ key: '', value: '' }],
  env: '',
});

const submitting = ref(false);
const error = ref('');

const nameValid = computed(() => {
  const name = form.value.name.trim();
  return /^[a-z0-9][a-z0-9_-]*$/.test(name) && !['data', 'backup', 'node_modules'].includes(name);
});

function addPort() { form.value.ports.push({ host: '', container: '', protocol: 'tcp' }); }
function removePort(i) { form.value.ports.splice(i, 1); }
function addVolume() { form.value.volumes.push({ source: '', target: '', readOnly: false }); }
function removeVolume(i) { form.value.volumes.splice(i, 1); }
function addEnv() { form.value.environment.push({ key: '', value: '' }); }
function removeEnv(i) { form.value.environment.splice(i, 1); }

async function submit() {
  if (submitting.value) return;
  error.value = '';
  if (!nameValid.value) {
    error.value = '项目名须以小写字母或数字开头，只能包含小写字母、数字、下划线和短横线，且不能是保留目录名。';
    return;
  }
  submitting.value = true;
  try {
    const r = await api.createProject({
      name: form.value.name.trim(),
      serviceName: form.value.serviceName.trim(),
      image: form.value.image.trim(),
      containerName: form.value.containerName.trim(),
      restart: form.value.restart,
      ports: form.value.ports,
      volumes: form.value.volumes,
      environment: form.value.environment.map((e) => ({ key: e.key, value: e.value })),
      env: form.value.env,
    });
    emit('created', r.name);
  } catch (e) {
    error.value = e.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="true"
    title="新建项目"
    width="760px"
    class="project-dialog"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    @close="emit('close')"
  >
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" style="margin-bottom:14px" />

    <p class="dialog-intro">创建项目目录及 Compose 文件。创建后可继续在详情页编辑。</p>
    <el-form label-position="top" class="create-basics">
      <el-form-item label="项目名" required>
        <el-input v-model="form.name" aria-label="项目名" placeholder="目录名，例如 myapp" />
      </el-form-item>
      <el-form-item label="服务名">
        <el-input v-model="form.serviceName" aria-label="服务名" placeholder="默认与项目名相同" />
      </el-form-item>
      <el-form-item label="镜像">
        <el-input v-model="form.image" aria-label="镜像" placeholder="nginx:latest" />
      </el-form-item>
      <el-form-item label="容器名">
        <el-input v-model="form.containerName" aria-label="容器名" placeholder="选填" />
      </el-form-item>
      <el-form-item label="重启策略">
        <el-select v-model="form.restart" aria-label="重启策略" style="width:100%">
          <el-option label="unless-stopped" value="unless-stopped" />
          <el-option label="always" value="always" />
          <el-option label="on-failure" value="on-failure" />
          <el-option label="no" value="no" />
        </el-select>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">端口映射</el-divider>
    <div v-for="(p, i) in form.ports" :key="i" class="row-item">
      <el-input v-model="p.host" aria-label="宿主端口" placeholder="宿主端口" size="small" />
      <span class="row-sep">:</span>
      <el-input v-model="p.container" aria-label="容器端口" placeholder="容器端口" size="small" />
      <el-select v-model="p.protocol" aria-label="端口协议" size="small" style="width:90px">
        <el-option label="tcp" value="tcp" />
        <el-option label="udp" value="udp" />
      </el-select>
      <el-button type="danger" plain size="small" @click="removePort(i)">删除</el-button>
    </div>
    <el-button text type="primary" size="small" @click="addPort">+ 添加端口</el-button>

    <el-divider content-position="left">目录挂载</el-divider>
    <div v-for="(v, i) in form.volumes" :key="i" class="row-item">
      <el-input v-model="v.source" aria-label="宿主路径" placeholder="宿主路径" size="small" />
      <span class="row-sep">:</span>
      <el-input v-model="v.target" aria-label="容器路径" placeholder="容器路径" size="small" />
      <el-checkbox v-model="v.readOnly" label="只读" />
      <el-button type="danger" plain size="small" @click="removeVolume(i)">删除</el-button>
    </div>
    <el-button text type="primary" size="small" @click="addVolume">+ 添加挂载</el-button>

    <el-divider content-position="left">环境变量</el-divider>
    <div v-for="(e, i) in form.environment" :key="i" class="row-item">
      <el-input v-model="e.key" aria-label="环境变量名" placeholder="KEY" size="small" class="create-env-key" />
      <span class="row-sep">=</span>
      <el-input v-model="e.value" aria-label="环境变量值" placeholder="值" size="small" />
      <el-button type="danger" plain size="small" @click="removeEnv(i)">删除</el-button>
    </div>
    <el-button text type="primary" size="small" @click="addEnv">+ 添加变量</el-button>

    <el-divider content-position="left">.env 文件内容（可选）</el-divider>
    <el-input
      v-model="form.env" aria-label=".env 文件内容"
      type="textarea"
      :rows="4"
      class="code-editor short"
      spellcheck="false"
      placeholder="TMDB_API_KEY=xxx&#10;TZ=Asia/Shanghai"
    />

    <template #footer>
      <el-button  :disabled="submitting" @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!nameValid" @click="submit">
        创建项目
      </el-button>
    </template>
  </el-dialog>
</template>
