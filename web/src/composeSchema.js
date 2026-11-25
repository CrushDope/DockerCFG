/**
 * compose 字段元数据（唯一事实来源）。
 *
 * key   —— 写入 compose 文件的英文字段名
 * label —— 页面展示的中文名
 * type  —— 控件类型：input / select / switch / list / kv / struct / env
 *
 * 表单由这份 schema 驱动渲染，因此新增字段只需在这里加一行。
 */

/** 服务字段分组（对应右侧标签页） */
export const SERVICE_GROUPS = [
  { id: 'basic', label: '基础', desc: '镜像、容器名与运行策略' },
  { id: 'network', label: '网络', desc: '端口、容器网络与域名解析' },
  { id: 'storage', label: '存储', desc: '目录挂载、内存盘与设备映射' },
  { id: 'env', label: '环境变量', desc: '变量取值与 .env 引用' },
  { id: 'deps', label: '依赖与标签', desc: '服务依赖、标签与配置分组' },
  { id: 'build', label: '构建与资源', desc: '镜像构建与 CPU / 内存限制' },
  { id: 'health', label: '健康与日志', desc: '健康检查与日志驱动' },
  { id: 'system', label: '系统与安全', desc: '权限、能力与内核参数' },
];

/** 服务下的全部可编辑字段 */
export const SERVICE_FIELDS = [
  // ---------------- 基础 ----------------
  { key: 'container_name', label: '容器名称', type: 'input', group: 'basic', placeholder: '留空自动生成' },
  { key: 'image', label: '镜像', type: 'input', group: 'basic', placeholder: 'nginx:alpine' },
  {
    key: 'restart', label: '重启策略', type: 'select', group: 'basic',
    options: [
      { label: '总是重启', value: 'always' },
      { label: '停止后不重启', value: 'unless-stopped' },
      { label: '失败时重启', value: 'on-failure' },
      { label: '不重启', value: 'no' },
    ],
  },
  {
    key: 'pull_policy', label: '镜像拉取策略', type: 'select', group: 'basic',
    options: [
      { label: '总是拉取', value: 'always' },
      { label: '从不拉取', value: 'never' },
      { label: '本地没有才拉取', value: 'if_not_present' },
      { label: '缺失时拉取', value: 'missing' },
    ],
  },
  { key: 'platform', label: '平台架构', type: 'input', group: 'basic', placeholder: 'linux/amd64' },
  { key: 'working_dir', label: '工作目录', type: 'input', group: 'basic', placeholder: '/app' },
  { key: 'user', label: '运行用户', type: 'input', group: 'basic', placeholder: '1000:1000' },
  { key: 'hostname', label: '主机名', type: 'input', group: 'basic', placeholder: '可选' },
  { key: 'stop_grace_period', label: '停止宽限期', type: 'input', group: 'basic', placeholder: '30s' },
  { key: 'init', label: '使用初始化进程', type: 'switch', group: 'basic', help: '以 tini 作为 PID 1，负责回收僵尸进程' },
  { key: 'privileged', label: '特权模式', type: 'switch', group: 'basic', help: '给予容器几乎等同宿主机的权限' },

  // ---------------- 网络 ----------------
  { key: 'ports', label: '端口映射', type: 'list', group: 'network', placeholder: '8080:80', addText: '添加端口', help: '格式：宿主机端口:容器端口，可加 /tcp、/udp' },
  { key: 'expose', label: '暴露端口', type: 'list', group: 'network', placeholder: '80', addText: '添加端口' },
  { key: 'networks', label: '加入网络', type: 'kv', group: 'network', valueMode: 'json', keyPlaceholder: '网络名', valuePlaceholder: '留空即可', addText: '添加网络', help: '需先在「顶层配置」中声明同名网络' },
  {
    key: 'network_mode', label: '网络模式', type: 'select', group: 'network',
    options: [
      { label: '默认（bridge）', value: '' },
      { label: '宿主机网络', value: 'host' },
      { label: '独立网络命名空间', value: 'none' },
      { label: '沿用其他服务', value: 'service:' },
    ],
    placeholder: '未设置',
  },
  { key: 'dns', label: 'DNS 服务器', type: 'list', group: 'network', placeholder: '8.8.8.8', addText: '添加' },
  { key: 'extra_hosts', label: '额外主机名', type: 'list', group: 'network', placeholder: 'nas.local:192.168.1.10', addText: '添加' },

  // ---------------- 存储 ----------------
  { key: 'volumes', label: '目录挂载', type: 'list', group: 'storage', placeholder: './data:/data:ro', addText: '添加挂载', help: '格式：来源:目标[:ro]，相对路径相对 compose 文件所在目录' },
  { key: 'tmpfs', label: '内存挂载', type: 'list', group: 'storage', placeholder: '/tmp', addText: '添加' },
  { key: 'devices', label: '设备映射', type: 'list', group: 'storage', placeholder: '/dev/dri:/dev/dri', addText: '添加' },

  // ---------------- 环境变量 ----------------
  { key: 'env_file', label: '变量文件', type: 'list', group: 'env', placeholder: '.env', addText: '添加', help: '除项目级 .env 外，还可额外引入其他变量文件' },

  // ---------------- 依赖与标签 ----------------
  { key: 'depends_on', label: '依赖服务', type: 'kv', group: 'deps', valueMode: 'json', keyPlaceholder: '服务名', valuePlaceholder: '留空即可', addText: '添加依赖', help: '值可填 JSON，如 {"condition":"service_healthy"}' },
  { key: 'labels', label: '标签', type: 'kv', group: 'deps', valueMode: 'plain', keyPlaceholder: '标签名', valuePlaceholder: '标签值', addText: '添加标签' },
  { key: 'profiles', label: '配置分组', type: 'list', group: 'deps', placeholder: 'dev', addText: '添加', help: '仅在指定 profile 生效时启动该服务' },

  // ---------------- 构建与资源 ----------------
  { key: 'build', label: '构建配置', type: 'struct', group: 'build', struct: 'build' },
  { key: 'mem_limit', label: '内存上限', type: 'input', group: 'build', placeholder: '512m' },
  { key: 'cpus', label: 'CPU 配额', type: 'input', group: 'build', placeholder: '0.5' },
  { key: 'ulimits', label: '资源限制项', type: 'struct', group: 'build', struct: 'ulimits' },
  { key: 'deploy', label: '部署配置', type: 'struct', group: 'build', struct: 'deploy' },

  // ---------------- 健康与日志 ----------------
  { key: 'healthcheck', label: '健康检查', type: 'struct', group: 'health', struct: 'healthcheck' },
  { key: 'logging', label: '日志配置', type: 'struct', group: 'health', struct: 'logging' },

  // ---------------- 系统与安全 ----------------
  { key: 'cap_add', label: '额外权限', type: 'list', group: 'system', placeholder: 'NET_ADMIN', addText: '添加' },
  { key: 'cap_drop', label: '移除权限', type: 'list', group: 'system', placeholder: 'ALL', addText: '添加' },
  { key: 'security_opt', label: '安全选项', type: 'list', group: 'system', placeholder: 'no-new-privileges:true', addText: '添加' },
  { key: 'sysctls', label: '内核参数', type: 'kv', group: 'system', valueMode: 'plain', keyPlaceholder: '参数名', valuePlaceholder: '参数值', addText: '添加' },
];

/**
 * 复杂结构的子表单定义。
 * path —— 写入 compose 对象时的路径（点号分隔），缺省用 key
 */
export const STRUCT_DEFS = {
  build: {
    label: '构建配置',
    fields: [
      { key: 'context', label: '构建上下文', type: 'input', path: 'context', placeholder: '.', help: 'Dockerfile 所在目录' },
      { key: 'dockerfile', label: 'Dockerfile 路径', type: 'input', path: 'dockerfile', placeholder: 'Dockerfile' },
      { key: 'target', label: '目标阶段', type: 'input', path: 'target', placeholder: 'builder' },
      { key: 'args', label: '构建参数', type: 'kv', path: 'args', valueMode: 'plain', keyPlaceholder: '参数名', valuePlaceholder: '参数值' },
    ],
    // build 允许写成字符串路径，统一折成对象读取
    normalize: (v) => (typeof v === 'string' ? { context: v } : v && typeof v === 'object' ? v : {}),
  },

  healthcheck: {
    label: '健康检查',
    fields: [
      {
        key: 'test', label: '检测命令', type: 'input', path: 'test',
        placeholder: 'CMD-SHELL curl -f http://localhost || exit 1',
        help: '以 CMD、CMD-SHELL 或 NONE 开头',
        read: (o) => (Array.isArray(o.test) ? o.test.join(' ') : (o.test ?? '')),
        write: (o, text) => {
          const t = String(text || '').trim();
          if (!t) { delete o.test; return; }
          if (/^CMD-SHELL\s+/i.test(t) || /^NONE$/i.test(t)) o.test = t;
          else o.test = t.split(/\s+/);
        },
      },
      { key: 'interval', label: '检测间隔', type: 'input', path: 'interval', placeholder: '30s' },
      { key: 'timeout', label: '超时时间', type: 'input', path: 'timeout', placeholder: '10s' },
      { key: 'retries', label: '重试次数', type: 'input', path: 'retries', placeholder: '3' },
      { key: 'start_period', label: '启动宽限期', type: 'input', path: 'start_period', placeholder: '40s', help: '容器启动后的宽限时间，此期间失败不计入重试' },
    ],
    normalize: (v) => (v && typeof v === 'object' ? v : {}),
  },

  deploy: {
    label: '部署配置',
    fields: [
      { key: 'replicas', label: '副本数', type: 'input', path: 'replicas', placeholder: '1' },
      { key: 'limits_cpus', label: 'CPU 上限', type: 'input', path: 'resources.limits.cpus', placeholder: '0.5' },
      { key: 'limits_memory', label: '内存上限', type: 'input', path: 'resources.limits.memory', placeholder: '512m' },
      { key: 'res_cpus', label: 'CPU 预留', type: 'input', path: 'resources.reservations.cpus', placeholder: '0.1' },
      { key: 'res_memory', label: '内存预留', type: 'input', path: 'resources.reservations.memory', placeholder: '128m' },
    ],
    normalize: (v) => (v && typeof v === 'object' ? v : {}),
  },

  logging: {
    label: '日志配置',
    fields: [
      {
        key: 'driver', label: '日志驱动', type: 'select', path: 'driver',
        options: [
          { label: '本地 json 文件', value: 'json-file' },
          { label: '本地轮转文件', value: 'local' },
          { label: '系统日志', value: 'syslog' },
          { label: 'journald', value: 'journald' },
          { label: '关闭日志', value: 'none' },
        ],
      },
      { key: 'options', label: '驱动选项', type: 'kv', path: 'options', valueMode: 'plain', keyPlaceholder: '选项名', valuePlaceholder: '选项值', help: '如 max-size=10m、max-file=3' },
    ],
    normalize: (v) => (v && typeof v === 'object' ? v : {}),
  },

  ulimits: {
    label: '资源限制项',
    fields: [
      { key: 'nofile_soft', label: '文件句柄上限（软）', type: 'input', path: 'nofile.soft', placeholder: '1024' },
      { key: 'nofile_hard', label: '文件句柄上限（硬）', type: 'input', path: 'nofile.hard', placeholder: '2048' },
      { key: 'nproc_soft', label: '进程数上限（软）', type: 'input', path: 'nproc.soft', placeholder: '512' },
      { key: 'nproc_hard', label: '进程数上限（硬）', type: 'input', path: 'nproc.hard', placeholder: '1024' },
    ],
    normalize: (v) => (v && typeof v === 'object' ? v : {}),
  },
};

/** 顶层字段（services 之外） */
export const TOP_FIELDS = [
  { key: 'name', label: '项目名称', type: 'input', placeholder: '可选，用于标识 compose 项目' },
];

/** 顶层资源型字段（networks / volumes / configs / secrets） */
export const TOP_RESOURCE_DEFS = {
  networks: {
    label: '网络',
    desc: '自定义容器网络，服务在「网络」分组里引用同名网络',
    fields: [
      {
        key: 'driver', label: '驱动', type: 'select',
        options: [
          { label: '网桥', value: 'bridge' },
          { label: '覆盖网络', value: 'overlay' },
          { label: '主机网络', value: 'host' },
          { label: 'MACVLAN', value: 'macvlan' },
          { label: 'IPvLAN', value: 'ipvlan' },
        ],
      },
      { key: 'external', label: '使用外部网络', type: 'switch', help: '由 Docker 外部创建，此处只做引用' },
      { key: 'attachable', label: '允许手动连接', type: 'switch' },
      { key: 'labels', label: '标签', type: 'kv', valueMode: 'plain' },
    ],
  },
  volumes: {
    label: '存储卷',
    desc: '命名卷，服务在「存储」分组里引用同名卷',
    fields: [
      { key: 'driver', label: '驱动', type: 'select', options: [{ label: '本地', value: 'local' }] },
      { key: 'external', label: '使用外部卷', type: 'switch' },
      { key: 'labels', label: '标签', type: 'kv', valueMode: 'plain' },
    ],
  },
  configs: {
    label: '配置',
    desc: '配置文件对象，服务可用 configs 引用',
    fields: [
      { key: 'file', label: '来源文件', type: 'input', placeholder: './config.json' },
      { key: 'content', label: '内联内容', type: 'textarea', placeholder: '直接写入内容，与来源文件二选一' },
      { key: 'external', label: '使用外部配置', type: 'switch' },
    ],
  },
  secrets: {
    label: '密钥',
    desc: '密钥对象，服务可用 secrets 引用',
    fields: [
      { key: 'file', label: '来源文件', type: 'input', placeholder: './secret.txt' },
      { key: 'external', label: '使用外部密钥', type: 'switch' },
    ],
  },
};

/** 按分组取字段 */
export function fieldsOfGroup(groupId, fields = SERVICE_FIELDS) {
  return fields.filter((f) => f.group === groupId);
}
