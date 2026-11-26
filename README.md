# DockerCFG Manager

一个自托管的 docker-compose 管理面板，部署在 NAS 上，用于集中查看和编辑多个 compose 项目。

后端是 **Go 单文件静态二进制**，前端是 **Vue 3 + Element Plus + vue-router**，通过多阶段构建打包，运行镜像包含 Docker CLI 和 Compose 插件。

## 路由

| 路径 | 页面 |
|---|---|
| `/` | 项目列表（概览统计、搜索筛选、列表 / 卡片双视图） |
| `/project/:name` | 项目详情（可视化编辑 / YAML 源码 / .env / 容器） |

使用 history 模式，后端对非 `/api/` 路径已有 SPA 回退，直接打开 `/project/legacy` 这类深链接也能正常显示。

## 功能

- 自动扫描 compose 根目录下的所有项目（每个子目录 = 一个项目）
- 展示每个项目的容器运行状态（运行中 / 部分 / 停止 / 无容器）
- **三栏工作台式可视化编辑**：左侧服务栏、中间分组导航、右侧设置式表单，支持字段搜索与「仅显示已配置」筛选
- **表单化编辑 compose**：覆盖顶层字段与 service 的全部常用字段；端口映射、目录挂载、设备映射采用「宿主机 ↔ 容器」双列编辑，协议 / 权限单独选择，未改动的写法（含长语法对象）原样保留
- **环境变量与 .env 联动**：引用型变量（`${VAR}`）显示 `.env` 中的真实值，保存时写入 `.env`；字面量直接写入 compose
- 源码模式直接编辑 `docker-compose.yml`，保存前校验 YAML 格式
- 项目级操作：`up` / `down` / `restart` / `pull`
- 容器级操作：单个容器的启动 / 停止 / 重启
- 新建项目向导：填表自动生成目录与 compose 文件
- 密码登录保护，启动时拒绝空密码和示例密码
- 项目搜索、状态筛选及响应式界面；支持直接编辑 `.env` 源码

界面设计规范（设计令牌、布局骨架、组件规格、可访问性）见 [`web/DESIGN.md`](web/DESIGN.md)。

## 目录结构约定

面板把 `COMPOSE_ROOT` 下的**每个一级子目录当作一个项目**，在其中查找 `docker-compose.yml`、
`docker-compose.yaml`、`compose.yml`、`compose.yaml`；找不到时会再往下一层子目录查找。`.env` 从实际找到的 Compose 文件所在目录读取与保存。

```
/volume1/docker/              ← 映射到容器内的 /compose
├── chaseTV/
│   ├── docker-compose.yml
│   └── .env
└── gybridge/
    ├── docker-compose.yml
    └── .env
```

## 部署

### 1. 准备目录

把本项目放到 NAS 上，例如 `/volume1/docker-tools/dockercfg-manager/`。

### 2. 修改配置

编辑 `docker-compose.yml`：

- `APP_PASSWORD`：在启动命令的环境中设置强密码，或在管理面板的 `docker-compose.yml` 同目录创建只允许管理员读取的 `.env`，写入 `APP_PASSWORD=你的强密码`（Linux 上建议 `chmod 600 .env`）。
- `ports`：按需修改宿主端口
- `/volume1/docker:/compose`：把左边改成你的项目目录。若被管理项目使用 `./data` 等相对宿主机挂载，建议将该目录以**宿主机和容器内相同的绝对路径**挂载，并把 `COMPOSE_ROOT` 改为该路径，避免 Docker daemon 在宿主机上使用错误目录。

### 3. 启动

```bash
cd /volume1/docker-tools/dockercfg-manager
docker compose up -d --build
```

首次构建需要下载 Go 与 Node 依赖（几分钟）；之后重建会走缓存。

浏览器打开 `http://<NAS地址>:3001`，用设置的密码登录。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3001` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `COMPOSE_ROOT` | `/compose` | compose 项目根目录（容器内路径） |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket 路径 |
| `STATIC_DIR` | `/app/web` | 前端静态资源目录 |
| `APP_PASSWORD` | 无（必填） | 登录密码，不接受 `admin123` 或 `changeme` |

## 安全说明

⚠️ 这个容器持有相当高的权限：

- 挂载了 `docker.sock`，等价于拥有宿主机 Docker 的完全控制权
- 挂载了 compose 根目录，可读写所有 compose 文件

因此：

1. **不要暴露到公网**，只在内网使用；如需外网访问，务必通过反向代理 + HTTPS + 额外的认证层（VPN、Authelia 等）。
2. 登录会话保存在内存，容器重启后需要重新登录。
3. 密码和项目 `.env` 中可能包含敏感信息，不要提交到 Git 或同步到公开目录。

## 本地开发

```bash
# 后端（需要 Go 1.23+）
cd backend && APP_PASSWORD=请换成你的开发密码 go run .

# 前端（需要 Node 20.19+，建议使用 Node 22）
cd web && npm install && npm run dev
```

前端 dev 服务器的 `/api` 请求会代理到 `localhost:3001`。

本地开发时如果没有 docker.sock 或 compose 目录，需要设置环境变量指向可用路径，例如：

```bash
APP_PASSWORD=请换成你的开发密码 COMPOSE_ROOT=../test-compose go run .
```

后端在 Docker 不可用时仍可读取和编辑配置，容器状态显示为「未知」，不等同于「无容器」。

容器关联和项目操作以一级目录名为 Compose 项目名。面板会拒绝目录名不合规，或顶层 `name` / `.env` 中 `COMPOSE_PROJECT_NAME` 与目录名不一致的项目操作。如果已有项目曾通过 CLI 的 `-p` 使用不同名称，请继续用原部署方式操作。可视化编辑会重新生成 YAML；对于需要保留注释、锚点或特殊格式的结构性修改，使用 YAML 源码模式。

### 后端测试

```bash
cd backend && go test ./...
```

覆盖 `.env` 合并逻辑、环境变量引用解析、路径穿越防护等关键行为。

### 前端测试

```bash
cd web
npm run build                # 编译
node compose-build.test.mjs  # 组包保真（37 项）
node env-save.test.mjs       # .env 合并（2 项）
node e2e-save.test.mjs       # 加载—保存—读回（25 项，需后端运行）
node render-check.mjs        # 浏览器渲染与控制台错误（需后端运行）
node ui-save.test.mjs        # 界面改值→保存→落盘（7 项，需后端运行）
```
