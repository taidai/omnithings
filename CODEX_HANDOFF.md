## 2026-08-05 修复 1 号机前端功能不可见（v0.4.39）

- **根因**：v0.4.38 部署时，远程 /home/omnithings/frontend/dist 仍引用旧构建产物（index-BCQ9G83I.js、NodeTreePage-BP1XLU_w.js），导致前端版本号与后端一致，但新功能（告警分级、故障表、全局实体批量绑定等）未在界面呈现。
- **修复**：
  - 本地重新执行 
pm run build，生成新的构建产物（index-CR-rwAI2.js、NodeTreePage-XirERRw4.js）；
  - 使用 scripts/deploy_1号机.py --skip-build --skip-migrations 重新同步 rontend/dist 与 ackend/app，并强制重建 omnithings 容器；
  - 验证远程 index.html 已指向新的 JS hash。
- **版本**：升级到 **0.4.39**，commit 486e147 已 push 到 https://github.com/taidai/zizu.git。
- **部署验证**：
  - 1 号机 http://e606.hlszh.com:9000/api/v1/health 返回 ersion: 0.4.39；
  - pipeline RUNNING，MQTT 已连接，db_write_errors 为 0；
  - 远程 dist 产物时间戳与 hash 已与本地一致。
## 2026-08-05 告警分级与故障码转义

- 数据库：新增 init-db/migration_014_alarm_level_fault_map.sql
  - 新建 t_fault_maps（故障码映射表）
  - t_tags 增加 alarm_level（error1/error2/error3）和 fault_map_id
- 后端：
  - 新增 backend/app/api/fault_maps.py：故障码映射表 CRUD
  - 更新 backend/app/api/tags.py：支持 alarm_level / fault_map_id 的增删改查与批量更新
  - 新增 backend/app/services/tag_alarm_engine.py：根据点位的 alarm_level 与 fault_map 自动创建/恢复告警
  - 更新 backend/app/services/pipeline.py：在数据流中调用 tag_alarm_engine，并随规则一起重载告警配置
  - 更新 backend/app/main.py：注册 fault_maps_router
- 前端：
  - 新增 frontend/src/components/FaultMapManager.tsx：系统工具中管理故障码映射表
  - 更新 frontend/src/components/NodeTagPanel.tsx：批量勾选点位后可设置 error1/error2/error3 与绑定故障表
  - 更新 frontend/src/api/client.ts：新增 FaultMap API 与 Tag 字段
- 告警分组：告警中心继续按 error1/error2/error3 分组；tag 触发的告警 source_key 即为 error1/2/3，message 优先使用故障码映射描述。
- 版本：升级到 **0.4.35**。
- 构建：frontend npm run build 通过；后端 py_compile 通过。
- GitHub：main 已推送至 https://github.com/taidai/zizu.git（88cdd1e）。

## 2026-08-05 删除节点快照功能

- 删除后端：
  - backend/app/api/snapshots.py（整 router）
  - backend/app/services/telemetry_store.py 中的 batch_insert_snapshots
  - backend/app/services/pipeline.py 中的快照缓冲、_to_snapshot、节点状态缓存
  - backend/app/models/schemas.py 中的 NodeSnapshotRecord
  - backend/app/api/admin.py 中的 t_node_snapshot 清空白名单
  - backend/app/api/categories.py 中的 snapshot_enabled / retention_days
  - backend/app/main.py 中的 snapshots_router 注册
- 删除前端：
  - frontend/src/components/NodeSnapshotPanel.tsx
  - frontend/src/components/SnapshotTable.tsx
  - DataBrowser / AdminPanel / NodeTreePage 中的快照相关 UI 与 API 调用
  - client.ts 中的 Snapshot API 和 Category 中的快照字段
- 数据库：
  - 删除 init-db/004-node-snapshot.sql、migration_007_snapshot_retention_1day.sql
  - 新增 init-db/migration_013_drop_snapshots.sql：删除 t_node_snapshot 表及策略、清理 t_node_categories 快照字段
  - 更新 init-db/005-node-categories.sql，移除快照相关字段
- 版本：升级到 **0.4.34**。
- 构建：frontend npm run build 通过；后端 py_compile 通过。
- GitHub：main 已推送至 https://github.com/taidai/zizu.git（66db3b0）。

# ZiZu 会话交接

## 2026-08-05 全局实体：国家标准/国际标准内置实体

- 新增 init-db/migration_012_standard_entities.sql：
  - 为 t_entities 增加 is_system 字段；
  - 内置光伏（pv）、储能（ess）、充电桩（charger）三类共 34 个标准实体；
  - 参考 GB/T 19964、GB/T 36558、GB/T 18487.1、IEC 61850-7-420、IEC 61851。
- 后端 backend/app/api/entities.py：
  - 实体列表/详情返回 is_system；
  - 新增 POST /api/v1/entities/seed 用于重新初始化标准实体；
  - 系统实体禁止删除，禁止修改 entity_type / data_type / category。
- 前端：
  - 全局实体列表与详情页显示「系统」徽章并隐藏删除按钮；
  - 编辑系统实体时禁用核心元数据字段；
  - 节点管理-全局实体绑定列表显示「系统」徽章。
- 版本：升级到 0.4.33。
- 构建：frontend npm run build 通过。
- GitHub：main 已推送至 https://github.com/taidai/zizu.git（d6aeeb0）。

## 当前状态

- 本地版本：**0.4.35**（commit 88cdd1e）
- GitHub：`main` 已推送至 `https://github.com/taidai/zizu.git`
- 2 号机部署：`e606.hlszh.com:3724`（SSH 端口 3723，账号 `holo` / `holo123`）
  - Web：`http://e606.hlszh.com:3724`（实际服务端口 `9000`，FRP 转发）
  - 容器：`omnithings` 已重建，health 返回 `version: 0.4.30`
  - MQTT：已连接，订阅 `/neuron/#`

## 本次完成

### 1. 修复「打不开，加载不出来」
- **根因**：`AdminPanel` 中的 `DataBrowser` 组件在挂载时无条件自动查询 `t_telemetry` 全表最近 1 小时数据（无节点/点位过滤），数据量大时请求耗时过长，导致页面假死/白屏。
- **修复**：移除 `DataBrowser` 的自动加载 `useEffect`，改为仅在用户点击「刷新」或切换筛选条件后手动查询。
- **文件**：[`frontend/src/components/DataBrowser.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/components/DataBrowser.tsx)

### 2. 左侧导航「节点树」改为「节点管理」并优化图标/布局
- **修改**：[`frontend/src/App.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/App.tsx)
  - 侧边栏菜单「节点树」更名为「节点管理」；
  - 引入 `lucide-react` 的 `Network / Scale / Bell / Settings` 图标替换原有 Unicode 符号；
  - 导航按钮调整为更大的圆角（`rounded-xl`）、更大的字号（`text-sm`）和更宽松的间距（`py-2.5`）；
  - 图标添加 `shrink-0`，文字添加 `truncate`，避免收起/展开时布局抖动。
- 同步将 [`frontend/src/pages/NodeTreePage.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/pages/NodeTreePage.tsx) 左侧面板标题改为「节点管理」。

### 3. AdminPanel 增加 MQTT 北向主题配置界面
- **问题**：后端 `/api/v1/mqtt-config` 与 `config_store.py` 已具备运行时重订阅能力，但 `AdminPanel.tsx` 只引入了接口、没有表单，用户无法在界面上配置 Neuron MQTT 主题。
- **修复**：在 `AdminPanel` 中新增「MQTT 北向主题配置」卡片：输入框编辑订阅主题、显示生效主题、保存后后端立即重订阅。
- **文件**：[`frontend/src/components/AdminPanel.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/components/AdminPanel.tsx)

### 4. 版本升级到 0.4.30
- 使用 `python scripts/bump_version.py patch` 同步更新 `VERSION`、`backend/app/VERSION`、`frontend/package.json`、`backend/pyproject.toml`。
- 本地 commit：`3d71cb0 fix(admin): prevent DataBrowser from auto-loading heavy telemetry query on mount; bump v0.4.30`

### 5. 部署到 2 号机并推送到 GitHub
- 本地 `npm run build` 通过。
- 打包 `frontend/dist`、`VERSION` 为 zip，通过 `pscp` 上传到 `/tmp`。
- 远程解压并更新 `/home/zizu/frontend/dist` 与 `/home/zizu/VERSION`，同步 `/home/zizu/backend/app/VERSION`。
- `docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --force-recreate backend` 重建后端容器。
- Health 检查通过，返回 `version: 0.4.30`。
- `git push origin main` 成功。

## 已知问题 / 注意

1. **Docker 镜像标签仍为 `zizu:0.4.12`**：当前通过 volume 挂载最新代码运行，功能已生效；后续如需镜像标签一致，需要重新 build 并 tag 为 `0.4.30`。
2. **容器日志出现 `skipped: maximum number of running instances reached`**：F1/F2/F3 定时任务执行耗时较长导致 APScheduler 跳过重叠实例，目前不影响实时数据流，但需后续优化调度间隔或任务性能。
3. **部署脚本待整理**：建议后续把 2 号机部署流程固化到 `scripts/deploy-2.ps1` 或 `deploy2.sh`，避免路径/权限问题。

## 关键文件

- [`frontend/src/components/DataBrowser.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/components/DataBrowser.tsx)
- [`frontend/src/App.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/App.tsx)
- [`frontend/src/pages/NodeTreePage.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/pages/NodeTreePage.tsx)
- [`frontend/src/components/AdminPanel.tsx`](/C:/Users/chent/Documents/zizu-explore/frontend/src/components/AdminPanel.tsx)
- [`backend/app/api/admin.py`](/C:/Users/chent/Documents/zizu-explore/backend/app/api/admin.py)
- [`backend/app/services/config_store.py`](/C:/Users/chent/Documents/zizu-explore/backend/app/services/config_store.py)
- [`backend/app/services/mqtt_client.py`](/C:/Users/chent/Documents/zizu-explore/backend/app/services/mqtt_client.py)
- [`backend/app/services/pipeline.py`](/C:/Users/chent/Documents/zizu-explore/backend/app/services/pipeline.py)

## 下一步建议

1. 验证 AdminPanel / 系统工具页面现在是否能正常打开。
2. 验证左侧导航在展开/收起状态下的显示效果。
3. 验证 AdminPanel 中 MQTT 主题修改后，Neuron 实时数据是否按新主题流入。
4. 清理 2 号机 `/tmp` 中的历史部署 zip，避免占用空间。
5. 优化 APScheduler 任务重叠问题（增大间隔或拆分耗时任务）。
6. 如需要，统一 Docker 镜像 tag 并重新 build 镜像。
7. 继续完善节点管理、规则引擎、IPO 闭环等工业控制功能。

## 本次补充（2026-08-04）

### 清理 OmniThings 残留并部署
- 修复 `backend/app/core/__init__.py` 与 `.gitignore` 中的 OmniThings 残留
- commit: `3d71cb0 chore: rename remaining OmniThings references to ZiZu`
- 重新构建前端并部署到 2 号机 `/home/omnithings`
- Health: `http://e606.hlszh.com:3724/api/v1/health` 返回 `version: 0.4.30`
- 注意：2 号机 Web 端口为 3724，3723 为 SSH；远程目录/容器名仍为 omnithings

## 本次补充（2026-08-04 节点融合全局实体）

### 全局实体融合到节点管理
- 后端 `/entities` 接口新增 `node_id` 过滤参数
- 前端节点管理新增「全局实体」Tab
- 每个节点可查看已绑定全局实体及其实时值
- 支持在当前节点下将全局实体绑定到具体点位（物理/虚拟 + 品牌 + 优先级）
- 新增组件：`frontend/src/components/NodeEntityPanel.tsx`
- commit: `066182e feat(nodes): integrate global entities into node management`
- 已部署 2 号机，health 返回 `version: 0.4.30`

## 本次补充（2026-08-05 全局实体批量绑定）

### 批量绑定/解绑全局实体
- 后端新增接口：
  - GET /api/v1/entities/bindings — 按节点/实体查询绑定关系
  - POST /api/v1/entities/bindings/batch — 批量创建绑定（自动跳过重复）
  - DELETE /api/v1/entities/bindings/batch — 批量删除绑定
- 前端 NodeEntityPanel 重构：
  - 展示当前节点下所有实体-点位绑定关系（含实时值）
  - 支持单条绑定、批量解绑
  - 新增「批量绑定」弹窗，支持两种模式：
    - 同名自动匹配：选择点位后自动匹配同名/同显示名的全局实体
    - 手动多选绑定：多选实体与点位后按笛卡尔积批量创建绑定
- 关键文件：
  - backend/app/api/entities.py
  - frontend/src/api/client.ts
  - frontend/src/components/NodeEntityPanel.tsx
- 版本：升级到 0.4.31
- commit: cc29dd6 feat(entities): batch bind/unbind global entities per node
- 本地构建通过；GitHub push 因当前网络中断失败，待网络恢复后重试
 - 本地版本：**0.4.38**（commit b708e9d）
 - 容器：`omnithings` 已重建，health 返回 `version: 0.4.38`，pipeline RUNNING，db_write_errors 0
## 2026-08-05 部署 1 号机（v0.4.38）

- 修复 `pipeline.py` 引用的 `upsert_telemetry_latest` 在 `telemetry_store.py` 中缺失的问题。
- 在 `backend/app/services/telemetry_store.py` 中实现 `upsert_telemetry_latest()`：
  - 对同一批记录的重复 `(node_id, tag_id)` 按时间戳去重，保留最新值；
  - 使用 `INSERT ... ON CONFLICT (node_id, tag_id) DO UPDATE` 维护 `t_telemetry_latest` 缓存表。
- 新增 `scripts/deploy_1号机.py`：基于 `paramiko` 一键部署到 1 号机。
  - 本地 `npm run build` 生成 `frontend/dist`；
  - tar 打包 `backend/app`、`frontend/dist`、`VERSION`、`init-db`；
  - SFTP 上传到 `/tmp` 并 sudo 解压到 `/home/omnithings`；
  - 通过 stdin 方式在 `omnithings-tsdb` 容器中执行 migrations 011-014；
  - `docker compose ... up -d --force-recreate backend` 重建后端容器；
  - 支持 `--skip-build` 与 `--skip-migrations` 参数。
- 版本升级到 **0.4.38**，commit `b708e9d` 已 push 到 `https://github.com/taidai/zizu.git`。
- 1 号机 `http://e606.hlszh.com:9000/api/v1/health` 返回 `version: 0.4.38`。
  - pipeline 状态 RUNNING，MQTT 已连接，db_write_errors 为 0。
