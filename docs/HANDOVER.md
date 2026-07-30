# OmniThings 工程交接包

> 生成时间：2026-07-30
> 用途：让另一款 AI 软件（如 Codex/Cursor/Claude Code）或人类开发者能直接接手当前工程。

---

## 1. 项目定位

**OmniThings**（内部代号 Claw）是 OmniPower 工业物联网数据采集与入库平台。

- 当前阶段：**F0 验收通过，F3 已部署并端到端验证**
- 核心目标：通过 Neuron 工业协议网关采集设备数据，经 NanoMQ 总线，由 FastAPI 后端解析、归一化、写入 TimescaleDB，并提供前端管理界面。
- 线上环境：http://e606.hlszh.com:9000/

---

## 2. 仓库与代码位置

### 开发工作区
```
C:\Users\chent\Desktop\2026成果\easyway\Claw\
```

### GitHub 公开发布仓库（推荐用于外部 AI 接手）
- 仓库地址：https://github.com/taidai/omnithings
- 发布暂存目录：
  ```
  C:\Users\chent\Desktop\2026成果\omnithings-release\
  ```
- 该目录是独立 git 仓库，remote 指向 GitHub `taidai/omnithings`。
- 更新流程：在 `omnithings-release/` 内 `git add/commit/push origin main`。

### 重要：工作区不是独立 git 仓库
`C:\Users\chent\Desktop\2026成果\easyway\Claw\` 自身没有 `.git`，它挂在父目录 `C:\Users\chent\Desktop\2026成果\.git` 下。**不要直接在 Claw 目录执行 git 操作**，应使用 `omnithings-release/` 作为发布仓库。

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | FastAPI + Python 3.12 |
| 数据库 | PostgreSQL 16 + TimescaleDB 2.x |
| 消息总线 | NanoMQ（MQTT） |
| 工业网关 | Neuron 2.10.4（原生进程 @ :7000） |
| 部署 | Docker Compose，e606 为 ARM64 Ubuntu 裁剪内核 |

---

## 4. 项目结构

```
Claw/
├── backend/
│   ├── app/
│   │   ├── api/           # REST API 路由
│   │   │   ├── nodes.py   # 节点树 CRUD、YAML 导入导出
│   │   │   ├── tags.py    # 点位管理、Neuron 挂载导入
│   │   │   ├── neuron.py  # Neuron 代理层
│   │   │   ├── telemetry.py
│   │   │   ├── pipeline.py
│   │   │   └── ...
│   │   ├── services/      # 业务逻辑
│   │   │   ├── aggregator.py   # F3 聚合器
│   │   │   ├── neuron_client.py # Neuron API 封装
│   │   │   ├── parser.py
│   │   │   ├── normalizer.py
│   │   │   └── telemetry_store.py
│   │   ├── core/          # 配置、lifespan
│   │   └── main.py        # FastAPI 入口，挂载 scheduler
│   ├── Dockerfile         # 多阶段构建，Stage2 手写 pip 清单
│   └── pyproject.toml
├── frontend/
│   └── src/
│       ├── App.tsx        # Tab 切换主框架
│       ├── api/client.ts  # REST + WebSocket 客户端
│       └── components/    # 页面组件
│           ├── NodeTreeEditor.tsx  # F3 节点树
│           ├── TagsTable.tsx
│           ├── SnapshotTable.tsx
│           ├── NeuronStatusCard.tsx
│           └── AdminPanel.tsx
├── init-db/               # SQL 初始化脚本
├── docker-compose.yml     # 标准三服务编排
├── docker-compose.e606.yml # e606 裁剪内�� override
├── deploy.sh              # 部署脚本
├── .env.example           # 环境变量模板
└── docs/                  # 设计文档
```

---

## 5. 当前功能状态

| 功能域 | 状态 | 关键文件 |
|--------|------|----------|
| F0 采集点位管理+入库 | ✅ 已验收 | `backend/app/services/*`, `frontend/src/components/TagsTable.tsx` |
| F3 节点树（自定义节点） | ✅ 已部署 | `frontend/src/components/NodeTreeEditor.tsx`, `backend/app/api/nodes.py` |
| F3 挂载设备（Neuron 导入） | ✅ 已验证 | `backend/app/api/tags.py::import-neuron`, `backend/app/services/neuron_client.py` |
| F3 聚合器（SUM/AVG/MAX/MIN/COUNT/LAST） | ✅ 已验证 | `backend/app/services/aggregator.py`, `app/main.py` |
| F3 实时值展示 | ✅ 已部署 | WebSocket `/api/v1/ws/telemetry` |
| 部署到 e606 | ✅ 已固化 | `deploy.sh`, `docker-compose.e606.yml` |

---

## 6. 关键架构决策（不要改）

1. **无 React Router**：前端是单 `App.tsx` + `activeTab` 切换，页面在 `frontend/src/components/`。
2. **5 层节点树**：Site(L1) → Station(L2) → EnergyNode(L3) → Device(L4) → Tag(L5)。
3. **Neuron 挂载规则**：Device 层节点通过 `POST /api/v1/tags/import-neuron` 挂载 Neuron 节点/组/点位，生成 `tag_type='PHICAL'`、`source_path='{neuron_node}/{neuron_group}/{tag_name}'` 的 tag。
4. **F3 聚合器**：APScheduler AsyncIOScheduler 每 10s 扫描 `formula_type='aggregate'` 的启用 LOGICAL tag，把 sources 最新值做聚合，作为 `is_virtual=true / quality=192` 写入 `t_telemetry`。
5. **e606 部署铁律**：
   - 必须叠加 `docker-compose.e606.yml`
   - 必须 `network_mode: host` + `tmpfs: /dev/mqueue`
   - 禁止在 e606 现场 `docker build`（裁剪内核缺 `CONFIG_VETH`/`CONFIG_POSIX_MQUEUE`）
   - 当前 `omnithings:0.1.0` 是 commit 层，非 Dockerfile 重建，所以 `docker-compose.e606.yml` 设了 `backend.user: root`

---

## 7. 已知坑点与排雷

| 问题 | 原因 | 当前状态 |
|------|------|----------|
| Neuron 2.10.4 tag 端点 | 必须用 `/api/v2/tags`（复数），单数 `/api/v2/tag` 会 404 | 已修复 `neuron_client.py` |
| Neuron node 列表 | 必须带 `?type=1` | `get_nodes()` 已正确实现 |
| 镜像缺 `httpx` | Dockerfile 之前没写 | 已写入 Dockerfile，e606 当前 commit 层已含 |
| 镜像缺 `apscheduler`/`pyyaml` | Dockerfile 之前没写 | 已写入 Dockerfile，e606 当前 commit 层已含 |
| `t_nodes.node_type` NOT NULL | schema 允许 None，但数据库不允许 | 前端已改为空字符串 `''` 而非 `null` |
| `docker commit` 丢失 USER/CMD | 当前 e606 镜像是容器 commit 而来 | `docker-compose.e606.yml` 已显式设 `user: root` |
| Tags API 同步阻塞 | 使用 psycopg2 ThreadedConnectionPool | 426ms 可接受，后续改 asyncpg（非阻塞） |

---

## 8. 本地开发启动

```bash
cd C:/Users/chent/Desktop/2026成果/easyway/Claw

# 1. 启动基础设施（PG+TSDB+NanoMQ）
docker compose up -d timescaledb nanomq

# 2. 初始化数据库（首次）
# 见 init-db/*.sql，按序号执行

# 3. 安装 Python 依赖
python -m venv backend/.venv
backend/.venv/Scripts/pip install -r backend/pyproject.toml  # 或按 Dockerfile 清单

# 4. 启动后端
cd backend
..\.venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

# 5. 启动前端
cd frontend
npm install
npm run dev
```

---

## 9. 部署到 e606

```bash
cd C:/Users/chent/Desktop/2026成果/easyway/Claw
bash deploy.sh 0.1.0
```

当前 deploy.sh 会：
1. 同步代码到 `/home/omnithings`
2. 在 e606 用 `docker-compose.e606.yml` override 启动
3. 不现场 build 镜像

如果 Dockerfile 有变更（新增依赖），需要先在能正常 build 的机器上交叉编译 arm64 镜像，再 scp/Load 到 e606。当前本地 Docker Desktop/WSL2 不可用，所以依赖变更通过 `docker exec pip install` + `docker commit` 固化。

---

## 10. 常用验证命令

```bash
# Health
curl http://e606.hlszh.com:9000/api/v1/health

# 节点树
curl http://e606.hlszh.com:9000/api/v1/nodes
curl http://e606.hlszh.com:9000/api/v1/nodes/{root_id}/tree

# Neuron 代理
curl http://e606.hlszh.com:9000/api/v1/neuron/nodes
curl 'http://e606.hlszh.com:9000/api/v1/neuron/groups?node=tk_db'
curl 'http://e606.hlszh.com:9000/api/v1/neuron/tags?node=tk_db&group=data'

# 挂载设备
curl -X POST http://e606.hlszh.com:9000/api/v1/tags/import-neuron \
  -H 'Content-Type: application/json' \
  -d '{"node_id":"...","neuron_node":"tk_db","neuron_group":"data"}'

# 聚合器日志
docker logs omnithings --since 5m | grep -i aggregation
```

---

## 11. 下一步建议（可选）

1. **F1/F2 规划**：控制域、规则引擎、告警。
2. **性能优化**：Tags API 从 psycopg2 同步改为 asyncpg。
3. **重建镜像**：在能正常 build 的机器上按新 Dockerfile 构建 arm64 镜像，替换 e606 的 commit 层。
4. **测试覆盖**：当前 backend/tests/ 有 18 个单测，可扩展端到端测试。

---

## 12. 联系上下文

- 负责人：陈工 / 陈
- 业务背景：光储充 EMS，Neuron + Node-RED + NocoBase + TimescaleDB + HomeAssistant 全链路
- 主色调：#52c41a（科技绿）
- UI 风格：Neumorphism（拟物化）+ 亮色主题

---

_本交接包位于：C:\Users\chent\Desktop\2026成果\easyway\Claw\docs\HANDOVER.md 及发布仓库 docs/HANDOVER.md_
